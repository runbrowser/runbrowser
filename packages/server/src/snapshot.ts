/**
 * CDP-based accessibility snapshot.
 * Ported from packages/core/src/aria-snapshot.ts — all Playwright dependencies removed.
 * Input: a sendCDP function. Output: snapshot text with @ref labels + ref→backendNodeId map.
 */

import type { Protocol } from './cdp-types.js'

export type SendCDP = (method: string, params?: unknown) => Promise<unknown>

// ============================================================================
// Types
// ============================================================================

export interface SnapshotRef {
  ref: string          // full ref (e.g. "submit-btn" or "e1")
  shortRef: string     // short ref shown to AI (e.g. "e1")
  role: string
  name: string
  backendNodeId?: number
  selector?: string    // CSS selector if available from stable test IDs
}

export interface SnapshotResult {
  snapshot: string
  refs: SnapshotRef[]
  /** Map from shortRef (e.g. "e1") to SnapshotRef — for interaction resolution */
  refMap: Map<string, SnapshotRef>
}

// ============================================================================
// Constants (mirrored from aria-snapshot.ts)
// ============================================================================

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'combobox', 'searchbox', 'checkbox', 'radio',
  'slider', 'spinbutton', 'switch', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'tab', 'treeitem', 'img', 'video', 'audio',
])

const LABEL_ROLES = new Set(['labeltext'])

const CONTEXT_ROLES = new Set([
  'navigation', 'main', 'contentinfo', 'banner', 'form',
  'section', 'region', 'list', 'listitem', 'table', 'rowgroup', 'row', 'cell',
])

const SKIP_WRAPPER_ROLES = new Set(['generic', 'group', 'none', 'presentation'])

const TEST_ID_ATTRS = [
  'data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-pw',
  'data-qa', 'data-e2e', 'data-automation-id',
]

// ============================================================================
// DOM Indexing (mirrored from aria-snapshot.ts)
// ============================================================================

type DomNodeInfo = {
  nodeId: number
  parentId?: number
  backendNodeId: number
  nodeName: string
  attributes: Map<string, string>
}

function toAttributeMap(attributes?: string[]): Map<string, string> {
  const result = new Map<string, string>()
  if (!attributes) return result
  for (let i = 0; i < attributes.length; i += 2) {
    const name = attributes[i]
    const value = attributes[i + 1]
    if (name) result.set(name, value ?? '')
  }
  return result
}

function getStableRefFromAttributes(attributes: Map<string, string>): { value: string; attr: string } | null {
  for (const attr of TEST_ID_ATTRS) {
    const value = attributes.get(attr)
    if (value) return { value, attr }
  }
  const id = attributes.get('id')
  if (id) return { value: id, attr: 'id' }
  return null
}

function buildDomIndex(nodes: Protocol.DOM.Node[]): {
  domByBackendId: Map<number, DomNodeInfo>
} {
  const domByBackendId = new Map<number, DomNodeInfo>()
  for (const node of nodes) {
    const info: DomNodeInfo = {
      nodeId: node.nodeId,
      parentId: node.parentId,
      backendNodeId: node.backendNodeId,
      nodeName: node.nodeName,
      attributes: toAttributeMap(node.attributes),
    }
    domByBackendId.set(node.backendNodeId, info)
  }
  return { domByBackendId }
}

// ============================================================================
// AX Tree Helpers (mirrored from aria-snapshot.ts)
// ============================================================================

function getAxValueString(value?: Protocol.Accessibility.AXValue): string {
  if (!value) return ''
  const raw = value.value
  if (typeof raw === 'string') return raw
  if (raw === undefined || raw === null) return ''
  return String(raw)
}

function getAxRole(node: Protocol.Accessibility.AXNode): string {
  return getAxValueString(node.role).toLowerCase()
}

function isTextRole(role: string): boolean {
  return role === 'statictext' || role === 'inlinetextbox'
}

function isSubstringOfAny(needle: string, haystack: Set<string>): boolean {
  for (const str of haystack) {
    if (str.includes(needle)) return true
  }
  return false
}

// ============================================================================
// Snapshot Node Types
// ============================================================================

type SnapshotNode = {
  role: string
  name: string
  baseLocator?: string
  ref?: string
  backendNodeId?: number
  indentOffset?: number
  ignored?: boolean
  children: SnapshotNode[]
}

type SnapshotLine = {
  text: string
  baseLocator?: string
  hasChildren?: boolean
  role?: string
  name?: string
  indent?: number
  ref?: string
}

// ============================================================================
// Tree Building (mirrored from aria-snapshot.ts)
// ============================================================================

function buildRawSnapshotTree(options: {
  nodeId: string
  axById: Map<string, Protocol.Accessibility.AXNode>
  isNodeInScope: (node: Protocol.Accessibility.AXNode) => boolean
}): SnapshotNode | null {
  const node = options.axById.get(options.nodeId)
  if (!node) return null

  const role = getAxRole(node)
  const name = getAxValueString(node.name).trim()
  const children = (node.childIds ?? [])
    .map((childId) => buildRawSnapshotTree({ nodeId: childId, axById: options.axById, isNodeInScope: options.isNodeInScope }))
    .filter((n): n is SnapshotNode => n !== null)

  const inScope = options.isNodeInScope(node) || children.length > 0
  if (!inScope) return null

  return {
    role,
    name,
    backendNodeId: node.backendDOMNodeId,
    ignored: node.ignored,
    children,
  }
}

function shiftIndent(nodes: SnapshotNode[], offset: number): SnapshotNode[] {
  return nodes.map((node) => ({ ...node, indentOffset: (node.indentOffset ?? 0) + offset }))
}

function escapeLocatorValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function buildLocatorFromStable(stable: { value: string; attr: string }): string {
  return `[${stable.attr}="${escapeLocatorValue(stable.value)}"]`
}

function buildBaseLocator({ role, name, stable }: { role: string; name: string; stable: { value: string; attr: string } | null }): string {
  if (stable) return buildLocatorFromStable(stable)
  const trimmedName = name.trim()
  if (trimmedName.length > 0) return `role=${role}[name="${escapeLocatorValue(trimmedName)}"]`
  return `role=${role}`
}

// ============================================================================
// Tree Filtering
// ============================================================================

function filterFullSnapshotTree(options: {
  node: SnapshotNode
  ancestorNames: string[]
  domByBackendId: Map<number, DomNodeInfo>
  createRefForNode: (o: { backendNodeId?: number; role: string; name: string }) => string | null
}): { nodes: SnapshotNode[]; names: Set<string> } {
  const { role, name } = options.node
  const hasName = name.length > 0
  const nextAncestors = hasName ? [...options.ancestorNames, name] : options.ancestorNames

  const childResults = options.node.children.map((child) =>
    filterFullSnapshotTree({ node: child, ancestorNames: nextAncestors, domByBackendId: options.domByBackendId, createRefForNode: options.createRefForNode })
  )
  const childNodes = childResults.flatMap((r) => r.nodes)
  const childNames = childResults.reduce((acc, r) => { r.names.forEach((n) => acc.add(n)); return acc }, new Set<string>())

  if (options.node.ignored) return { nodes: shiftIndent(childNodes, 1), names: childNames }

  if (isTextRole(role)) {
    if (!hasName) return { nodes: childNodes, names: childNames }
    const isRedundant = options.ancestorNames.some((a) => a.includes(name) || name.includes(a))
    if (isRedundant) return { nodes: childNodes, names: childNames }
    const names = new Set(childNames)
    names.add(name)
    return { nodes: [{ role: 'text', name, children: [] }], names }
  }

  const hasChildren = childNodes.length > 0
  const nameToUse = hasName && (childNames.has(name) || isSubstringOfAny(name, childNames)) ? '' : name
  const hasNameToUse = nameToUse.length > 0
  const isWrapper = SKIP_WRAPPER_ROLES.has(role)
  const isInteractive = INTERACTIVE_ROLES.has(role)
  const shouldInclude = isInteractive || hasNameToUse || hasChildren
  if (!shouldInclude) return { nodes: childNodes, names: childNames }
  if (isWrapper && !hasNameToUse) {
    if (!hasChildren) return { nodes: [], names: childNames }
    return { nodes: childNodes, names: childNames }
  }

  let baseLocator: string | undefined
  let ref: string | null = null
  if (isInteractive) {
    const domInfo = options.node.backendNodeId ? options.domByBackendId.get(options.node.backendNodeId) : undefined
    const stable = domInfo ? getStableRefFromAttributes(domInfo.attributes) : null
    baseLocator = buildBaseLocator({ role, name, stable })
    ref = options.createRefForNode({ backendNodeId: options.node.backendNodeId, role, name })
  }

  const nodeEntry: SnapshotNode = { role, name: nameToUse, baseLocator, ref: ref ?? undefined, backendNodeId: options.node.backendNodeId, children: childNodes }
  const names = new Set(childNames)
  if (hasNameToUse) names.add(nameToUse)
  return { nodes: [nodeEntry], names }
}

function filterInteractiveSnapshotTree(options: {
  node: SnapshotNode
  ancestorNames: string[]
  labelContext: boolean
  domByBackendId: Map<number, DomNodeInfo>
  createRefForNode: (o: { backendNodeId?: number; role: string; name: string }) => string | null
}): { nodes: SnapshotNode[]; names: Set<string> } {
  const { role, name } = options.node
  const hasName = name.length > 0
  const nextAncestors = hasName ? [...options.ancestorNames, name] : options.ancestorNames
  const isLabel = LABEL_ROLES.has(role)
  const nextLabelContext = options.labelContext || isLabel

  const childResults = options.node.children.map((child) =>
    filterInteractiveSnapshotTree({ node: child, ancestorNames: nextAncestors, labelContext: nextLabelContext, domByBackendId: options.domByBackendId, createRefForNode: options.createRefForNode })
  )
  const childNodes = childResults.flatMap((r) => r.nodes)
  const childNames = childResults.reduce((acc, r) => { r.names.forEach((n) => acc.add(n)); return acc }, new Set<string>())

  if (options.node.ignored) return { nodes: shiftIndent(childNodes, 1), names: childNames }

  if (isTextRole(role)) {
    if (!hasName || !options.labelContext) return { nodes: childNodes, names: childNames }
    const isRedundant = options.ancestorNames.some((a) => a.includes(name) || name.includes(a))
    if (isRedundant) return { nodes: childNodes, names: childNames }
    const names = new Set(childNames)
    names.add(name)
    return { nodes: [{ role: 'text', name, children: [] }], names }
  }

  const hasChildren = childNodes.length > 0
  const nameToUse = hasName && (childNames.has(name) || isSubstringOfAny(name, childNames)) ? '' : name
  const hasNameToUse = nameToUse.length > 0
  const isWrapper = SKIP_WRAPPER_ROLES.has(role)
  const isInteractive = INTERACTIVE_ROLES.has(role)
  const isContext = CONTEXT_ROLES.has(role)
  const shouldInclude = isInteractive || isLabel || isContext || hasChildren
  if (!shouldInclude) return { nodes: childNodes, names: childNames }
  if (!isInteractive && !isLabel && !isContext) {
    if (!hasChildren) return { nodes: [], names: childNames }
    return { nodes: childNodes, names: childNames }
  }
  if (isWrapper && !hasNameToUse) {
    if (!hasChildren) return { nodes: [], names: childNames }
    return { nodes: childNodes, names: childNames }
  }

  let baseLocator: string | undefined
  let ref: string | null = null
  if (isInteractive) {
    const domInfo = options.node.backendNodeId ? options.domByBackendId.get(options.node.backendNodeId) : undefined
    const stable = domInfo ? getStableRefFromAttributes(domInfo.attributes) : null
    baseLocator = buildBaseLocator({ role, name, stable })
    ref = options.createRefForNode({ backendNodeId: options.node.backendNodeId, role, name })
  }

  const nodeEntry: SnapshotNode = { role, name: nameToUse, baseLocator, ref: ref ?? undefined, backendNodeId: options.node.backendNodeId, children: childNodes }
  const names = new Set(childNames)
  if (hasNameToUse) names.add(nameToUse)
  return { nodes: [nodeEntry], names }
}

// ============================================================================
// Snapshot Rendering
// ============================================================================

function buildSnapshotLines(nodes: SnapshotNode[], shortRefMap: Map<string, string>, indent = 0): SnapshotLine[] {
  return nodes.flatMap((node) => {
    const nodeIndent = indent + (node.indentOffset ?? 0)
    const prefix = '  '.repeat(nodeIndent)
    let text: string
    if (node.role === 'text') {
      const escaped = node.name.replace(/"/g, '\\"')
      text = `${prefix}- text: "${escaped}"`
      return [{ text }, ...buildSnapshotLines(node.children, shortRefMap, nodeIndent + 1)]
    }
    let lineParts = `${prefix}- ${node.role}`
    if (node.name) {
      const escaped = node.name.replace(/"/g, '\\"')
      lineParts += ` "${escaped}"`
    }
    if (node.ref) {
      const shortRef = shortRefMap.get(node.ref) ?? node.ref
      lineParts += ` @${shortRef}`
    }
    if (node.baseLocator && !node.ref) {
      lineParts += ` ${node.baseLocator}`
    }
    const hasChildren = node.children.length > 0
    if (hasChildren) lineParts += ':'
    return [{ text: lineParts, ref: node.ref }, ...buildSnapshotLines(node.children, shortRefMap, nodeIndent + 1)]
  })
}

// ============================================================================
// Main Snapshot Function
// ============================================================================

export async function getSnapshot(
  sendCDP: SendCDP,
  options: { interactiveOnly?: boolean } = {},
): Promise<SnapshotResult> {
  await sendCDP('DOM.enable')
  await sendCDP('Accessibility.enable')

  const { nodes: domNodes } = (await sendCDP('DOM.getFlattenedDocument', { depth: -1, pierce: true })) as Protocol.DOM.GetFlattenedDocumentResponse
  const { nodes: axNodes } = (await sendCDP('Accessibility.getFullAXTree')) as Protocol.Accessibility.GetFullAXTreeResponse

  const { domByBackendId } = buildDomIndex(domNodes)

  const axById = new Map<string, Protocol.Accessibility.AXNode>()
  for (const node of axNodes) {
    axById.set(node.nodeId, node)
  }

  // Find root node
  const rootAxNode =
    axNodes.find((n) => getAxRole(n) === 'rootwebarea') ||
    axNodes.find((n) => getAxRole(n) === 'webarea') ||
    axNodes.find((n) => !n.parentId)

  const refCounts = new Map<string, number>()
  let fallbackCounter = 0
  const allRefs: Array<{ ref: string; role: string; name: string; backendNodeId?: number; selector?: string }> = []

  const createRefForNode = (opts: { backendNodeId?: number; role: string; name: string }): string | null => {
    if (!INTERACTIVE_ROLES.has(opts.role)) return null

    const domInfo = opts.backendNodeId ? domByBackendId.get(opts.backendNodeId) : undefined
    const stable = domInfo ? getStableRefFromAttributes(domInfo.attributes) : null
    let baseRef = stable?.value
    if (!baseRef) {
      fallbackCounter += 1
      baseRef = `e${fallbackCounter}`
    }

    const count = refCounts.get(baseRef) ?? 0
    refCounts.set(baseRef, count + 1)
    const ref = count === 0 ? baseRef : `${baseRef}-${count + 1}`

    let selector: string | undefined
    if (stable && count === 0) selector = buildLocatorFromStable(stable)

    allRefs.push({ ref, role: opts.role, name: opts.name, backendNodeId: opts.backendNodeId, selector })
    return ref
  }

  let snapshotNodes: SnapshotNode[] = []
  if (rootAxNode) {
    const rootRole = getAxRole(rootAxNode)
    const rawRoots =
      (rootRole === 'rootwebarea' || rootRole === 'webarea') && rootAxNode.childIds
        ? rootAxNode.childIds
            .map((id) => buildRawSnapshotTree({ nodeId: id, axById, isNodeInScope: () => true }))
            .filter((n): n is SnapshotNode => n !== null)
        : [buildRawSnapshotTree({ nodeId: rootAxNode.nodeId, axById, isNodeInScope: () => true })].filter(
            (n): n is SnapshotNode => n !== null,
          )

    snapshotNodes = rawRoots.flatMap((rawNode) => {
      if (options.interactiveOnly) {
        return filterInteractiveSnapshotTree({
          node: rawNode,
          ancestorNames: [],
          labelContext: false,
          domByBackendId,
          createRefForNode,
        }).nodes
      }
      return filterFullSnapshotTree({
        node: rawNode,
        ancestorNames: [],
        domByBackendId,
        createRefForNode,
      }).nodes
    })
  }

  // Build short ref map: ref → e1, e2, ... (based on allRefs order)
  const shortRefMap = new Map<string, string>()
  allRefs.forEach((entry, index) => {
    shortRefMap.set(entry.ref, `e${index + 1}`)
  })

  const lines = buildSnapshotLines(snapshotNodes, shortRefMap)
  const snapshot = lines.map((l) => l.text).join('\n')

  const refs: SnapshotRef[] = allRefs.map((entry) => ({
    ref: entry.ref,
    shortRef: shortRefMap.get(entry.ref) ?? entry.ref,
    role: entry.role,
    name: entry.name,
    backendNodeId: entry.backendNodeId,
    selector: entry.selector,
  }))

  const refMap = new Map<string, SnapshotRef>()
  for (const ref of refs) {
    refMap.set(ref.shortRef, ref)
    refMap.set(ref.ref, ref) // also index by full ref
  }

  return { snapshot, refs, refMap }
}
