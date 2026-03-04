/**
 * High-level browser commands via CDP.
 * Each function takes a sendCDP function and performs a browser action.
 */

import type { SnapshotRef } from './snapshot.js'

export type SendCDP = (method: string, params?: unknown) => Promise<unknown>

// ============================================================================
// Navigation
// ============================================================================

export async function navigate(sendCDP: SendCDP, url: string): Promise<{ url: string; title: string }> {
  await sendCDP('Page.enable')
  await sendCDP('Page.navigate', { url })
  // Wait a moment for the page to load
  await new Promise((resolve) => setTimeout(resolve, 500))
  const titleResult = (await sendCDP('Runtime.evaluate', {
    expression: 'document.title',
    returnByValue: true,
  })) as any
  const urlResult = (await sendCDP('Runtime.evaluate', {
    expression: 'window.location.href',
    returnByValue: true,
  })) as any
  return {
    url: urlResult?.result?.value || url,
    title: titleResult?.result?.value || '',
  }
}

export async function goBack(sendCDP: SendCDP): Promise<void> {
  await sendCDP('Runtime.evaluate', { expression: 'history.back()', returnByValue: true })
  await new Promise((resolve) => setTimeout(resolve, 500))
}

export async function goForward(sendCDP: SendCDP): Promise<void> {
  await sendCDP('Runtime.evaluate', { expression: 'history.forward()', returnByValue: true })
  await new Promise((resolve) => setTimeout(resolve, 500))
}

export async function reload(sendCDP: SendCDP): Promise<void> {
  await sendCDP('Page.reload')
  await new Promise((resolve) => setTimeout(resolve, 500))
}

// ============================================================================
// Element Interaction
// ============================================================================

export async function getElementBox(
  sendCDP: SendCDP,
  backendNodeId: number,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  try {
    const result = (await sendCDP('DOM.getBoxModel', { backendNodeId })) as any
    const quad = result?.model?.border
    if (!quad || quad.length < 8) return null
    const xs = [quad[0], quad[2], quad[4], quad[6]]
    const ys = [quad[1], quad[3], quad[5], quad[7]]
    const left = Math.min(...xs)
    const right = Math.max(...xs)
    const top = Math.min(...ys)
    const bottom = Math.max(...ys)
    return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
  } catch {
    return null
  }
}

export function resolveRef(refString: string, refMap: Map<string, SnapshotRef>): SnapshotRef | null {
  // Support "@e1" notation or plain "e1"
  const key = refString.startsWith('@') ? refString.slice(1) : refString
  return refMap.get(key) ?? null
}

export async function click(
  sendCDP: SendCDP,
  ref: string,
  refMap: Map<string, SnapshotRef>,
): Promise<void> {
  const resolved = resolveRef(ref, refMap)
  if (!resolved?.backendNodeId) {
    throw new Error(`Ref "${ref}" not found in last snapshot. Call snapshot() first.`)
  }

  const box = await getElementBox(sendCDP, resolved.backendNodeId)
  if (!box) {
    throw new Error(`Could not get bounding box for ref "${ref}" (backendNodeId: ${resolved.backendNodeId})`)
  }

  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  // First scroll element into view
  await sendCDP('Runtime.evaluate', {
    expression: `document.querySelector('[data-testid]') || (function() {
      try {
        const node = __runbrowser_resolveNode && __runbrowser_resolveNode(${resolved.backendNodeId});
        if (node) node.scrollIntoView({ block: 'center', behavior: 'instant' });
      } catch(e) {}
    })()`,
    returnByValue: true,
  }).catch(() => {})

  await sendCDP('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await sendCDP('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

export async function fill(
  sendCDP: SendCDP,
  ref: string,
  value: string,
  refMap: Map<string, SnapshotRef>,
): Promise<void> {
  const resolved = resolveRef(ref, refMap)
  if (!resolved?.backendNodeId) {
    throw new Error(`Ref "${ref}" not found in last snapshot. Call snapshot() first.`)
  }

  const box = await getElementBox(sendCDP, resolved.backendNodeId)
  if (!box) {
    throw new Error(`Could not get bounding box for ref "${ref}"`)
  }

  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  // Click to focus
  await sendCDP('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await sendCDP('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })

  // Select all existing text and clear it
  await sendCDP('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', modifiers: 2 }) // Ctrl+A
  await sendCDP('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', modifiers: 2 })

  // Insert new text
  await sendCDP('Input.insertText', { text: value })
}

export async function type(sendCDP: SendCDP, text: string): Promise<void> {
  await sendCDP('Input.insertText', { text })
}

export async function press(sendCDP: SendCDP, key: string): Promise<void> {
  // Map common key names to CDP format
  const keyMap: Record<string, string> = {
    Enter: 'Return',
    Return: 'Return',
    Tab: 'Tab',
    Escape: 'Escape',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    Home: 'Home',
    End: 'End',
    PageUp: 'Prior',
    PageDown: 'Next',
    Space: ' ',
  }
  const cdpKey = keyMap[key] ?? key
  await sendCDP('Input.dispatchKeyEvent', { type: 'keyDown', key: cdpKey })
  await sendCDP('Input.dispatchKeyEvent', { type: 'keyUp', key: cdpKey })
}

export async function scroll(
  sendCDP: SendCDP,
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number = 300,
): Promise<void> {
  const deltaX = direction === 'left' ? -amount : direction === 'right' ? amount : 0
  const deltaY = direction === 'up' ? -amount : direction === 'down' ? amount : 0
  await sendCDP('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: 400,
    y: 300,
    deltaX,
    deltaY,
  })
}

export async function hover(
  sendCDP: SendCDP,
  ref: string,
  refMap: Map<string, SnapshotRef>,
): Promise<void> {
  const resolved = resolveRef(ref, refMap)
  if (!resolved?.backendNodeId) {
    throw new Error(`Ref "${ref}" not found in last snapshot. Call snapshot() first.`)
  }

  const box = await getElementBox(sendCDP, resolved.backendNodeId)
  if (!box) {
    throw new Error(`Could not get bounding box for ref "${ref}"`)
  }

  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  await sendCDP('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
}

// ============================================================================
// Page Info
// ============================================================================

export async function getUrl(sendCDP: SendCDP): Promise<string> {
  const result = (await sendCDP('Runtime.evaluate', {
    expression: 'window.location.href',
    returnByValue: true,
  })) as any
  return result?.result?.value || ''
}

export async function getTitle(sendCDP: SendCDP): Promise<string> {
  const result = (await sendCDP('Runtime.evaluate', {
    expression: 'document.title',
    returnByValue: true,
  })) as any
  return result?.result?.value || ''
}

export async function getText(
  sendCDP: SendCDP,
  ref: string,
  refMap: Map<string, SnapshotRef>,
): Promise<string> {
  const resolved = resolveRef(ref, refMap)
  if (!resolved?.backendNodeId) {
    throw new Error(`Ref "${ref}" not found in last snapshot`)
  }
  // Use DOM.getOuterHTML or Runtime.evaluate with the node
  const result = (await sendCDP('DOM.getOuterHTML', { backendNodeId: resolved.backendNodeId })) as any
  return result?.outerHTML || ''
}
