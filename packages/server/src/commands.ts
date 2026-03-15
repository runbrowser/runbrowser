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

async function scrollIntoView(sendCDP: SendCDP, backendNodeId: number): Promise<void> {
  try {
    await sendCDP('DOM.scrollIntoViewIfNeeded', { backendNodeId })
  } catch {
    try {
      const { object } = (await sendCDP('DOM.resolveNode', { backendNodeId })) as any
      if (object?.objectId) {
        await sendCDP('Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: 'function() { this.scrollIntoView({ block: "center", behavior: "instant" }); }',
        })
      }
    } catch {}
  }
}

/**
 * Visual feedback: flash a border glow on the page when a command runs,
 * and highlight the target element with a pulse effect.
 */
async function flashPageBorder(sendCDP: SendCDP): Promise<void> {
  await sendCDP('Runtime.evaluate', {
    expression: `(function() {
      if (document.__runbrowser_border) return;
      const el = document.createElement('div');
      el.id = '__runbrowser_border';
      document.__runbrowser_border = el;
      Object.assign(el.style, {
        position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
        pointerEvents: 'none', zIndex: '2147483647',
        border: '2px solid #22c55e',
        boxShadow: 'inset 0 0 12px rgba(34,197,94,0.3)',
        opacity: '1',
        transition: 'opacity 0.4s ease-out',
      });
      document.documentElement.appendChild(el);
      setTimeout(() => { el.style.opacity = '0'; }, 600);
      setTimeout(() => { el.remove(); document.__runbrowser_border = null; }, 1000);
    })()`,
    returnByValue: true,
  }).catch(() => {})
}

async function highlightElement(sendCDP: SendCDP, backendNodeId: number): Promise<void> {
  try {
    const { object } = (await sendCDP('DOM.resolveNode', { backendNodeId })) as any
    if (!object?.objectId) return
    await sendCDP('Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function() {
        const el = this;
        const orig = el.style.outline;
        const origTransition = el.style.transition;
        el.style.transition = 'outline 0.15s ease-out, outline-offset 0.15s ease-out';
        el.style.outline = '2px solid #22c55e';
        el.style.outlineOffset = '2px';
        setTimeout(() => {
          el.style.outline = orig;
          el.style.outlineOffset = '';
          el.style.transition = origTransition;
        }, 1000);
      }`,
    })
  } catch {}
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

  await scrollIntoView(sendCDP, resolved.backendNodeId)

  const box = await getElementBox(sendCDP, resolved.backendNodeId)
  if (!box) {
    throw new Error(`Could not get bounding box for ref "${ref}" (backendNodeId: ${resolved.backendNodeId})`)
  }

  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  // Visual feedback
  await flashPageBorder(sendCDP)
  await highlightElement(sendCDP, resolved.backendNodeId)

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

  await scrollIntoView(sendCDP, resolved.backendNodeId)

  const box = await getElementBox(sendCDP, resolved.backendNodeId)
  if (!box) {
    throw new Error(`Could not get bounding box for ref "${ref}"`)
  }

  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  // Visual feedback
  await flashPageBorder(sendCDP)
  await highlightElement(sendCDP, resolved.backendNodeId)

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
  const scrollX = direction === 'left' ? -amount : direction === 'right' ? amount : 0
  const scrollY = direction === 'up' ? -amount : direction === 'down' ? amount : 0
  await flashPageBorder(sendCDP)
  await sendCDP('Runtime.evaluate', {
    expression: `window.scrollBy(${scrollX}, ${scrollY})`,
    returnByValue: true,
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

  // Scroll element into view first so it has a valid bounding box
  await scrollIntoView(sendCDP, resolved.backendNodeId)

  const box = await getElementBox(sendCDP, resolved.backendNodeId)
  if (!box) {
    throw new Error(`Could not get bounding box for ref "${ref}"`)
  }

  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  await flashPageBorder(sendCDP)
  await highlightElement(sendCDP, resolved.backendNodeId)
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
  // Resolve to a JS object, get innerText
  const obj = (await sendCDP('DOM.resolveNode', { backendNodeId: resolved.backendNodeId })) as any
  const objectId = obj?.object?.objectId
  if (!objectId) {
    // Fallback to outerHTML
    const html = (await sendCDP('DOM.getOuterHTML', { backendNodeId: resolved.backendNodeId })) as any
    return html?.outerHTML || ''
  }
  const result = (await sendCDP('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function() { return this.innerText || this.textContent || "" }',
    returnByValue: true,
  })) as any
  return result?.result?.value || ''
}

export async function getHtml(
  sendCDP: SendCDP,
  ref: string,
  refMap: Map<string, SnapshotRef>,
): Promise<string> {
  const resolved = resolveRef(ref, refMap)
  if (!resolved?.backendNodeId) {
    throw new Error(`Ref "${ref}" not found in last snapshot`)
  }
  const result = (await sendCDP('DOM.getOuterHTML', { backendNodeId: resolved.backendNodeId })) as any
  return result?.outerHTML || ''
}

export async function getValue(
  sendCDP: SendCDP,
  ref: string,
  refMap: Map<string, SnapshotRef>,
): Promise<string> {
  const resolved = resolveRef(ref, refMap)
  if (!resolved?.backendNodeId) {
    throw new Error(`Ref "${ref}" not found in last snapshot`)
  }
  const obj = (await sendCDP('DOM.resolveNode', { backendNodeId: resolved.backendNodeId })) as any
  const objectId = obj?.object?.objectId
  if (!objectId) throw new Error(`Cannot resolve ref "${ref}"`)
  const result = (await sendCDP('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function() { return this.value ?? "" }',
    returnByValue: true,
  })) as any
  return result?.result?.value ?? ''
}

export async function getAttribute(
  sendCDP: SendCDP,
  ref: string,
  attr: string,
  refMap: Map<string, SnapshotRef>,
): Promise<string | null> {
  const resolved = resolveRef(ref, refMap)
  if (!resolved?.backendNodeId) {
    throw new Error(`Ref "${ref}" not found in last snapshot`)
  }
  const obj = (await sendCDP('DOM.resolveNode', { backendNodeId: resolved.backendNodeId })) as any
  const objectId = obj?.object?.objectId
  if (!objectId) throw new Error(`Cannot resolve ref "${ref}"`)
  const result = (await sendCDP('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: `function() { return this.getAttribute(${JSON.stringify(attr)}) }`,
    returnByValue: true,
  })) as any
  return result?.result?.value ?? null
}

export async function isVisible(
  sendCDP: SendCDP,
  ref: string,
  refMap: Map<string, SnapshotRef>,
): Promise<boolean> {
  const resolved = resolveRef(ref, refMap)
  if (!resolved?.backendNodeId) {
    throw new Error(`Ref "${ref}" not found in last snapshot`)
  }
  const box = await getElementBox(sendCDP, resolved.backendNodeId)
  return box != null && box.width > 0 && box.height > 0
}

export async function isChecked(
  sendCDP: SendCDP,
  ref: string,
  refMap: Map<string, SnapshotRef>,
): Promise<boolean> {
  const resolved = resolveRef(ref, refMap)
  if (!resolved?.backendNodeId) {
    throw new Error(`Ref "${ref}" not found in last snapshot`)
  }
  const obj = (await sendCDP('DOM.resolveNode', { backendNodeId: resolved.backendNodeId })) as any
  const objectId = obj?.object?.objectId
  if (!objectId) throw new Error(`Cannot resolve ref "${ref}"`)
  const result = (await sendCDP('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function() { return !!this.checked }',
    returnByValue: true,
  })) as any
  return !!result?.result?.value
}

export async function selectOption(
  sendCDP: SendCDP,
  ref: string,
  value: string,
  refMap: Map<string, SnapshotRef>,
): Promise<void> {
  const resolved = resolveRef(ref, refMap)
  if (!resolved?.backendNodeId) {
    throw new Error(`Ref "${ref}" not found in last snapshot`)
  }
  const obj = (await sendCDP('DOM.resolveNode', { backendNodeId: resolved.backendNodeId })) as any
  const objectId = obj?.object?.objectId
  if (!objectId) throw new Error(`Cannot resolve ref "${ref}"`)
  await sendCDP('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: `function() {
      this.value = ${JSON.stringify(value)};
      this.dispatchEvent(new Event('input', { bubbles: true }));
      this.dispatchEvent(new Event('change', { bubbles: true }));
    }`,
    returnByValue: true,
  })
}

export async function waitFor(
  sendCDP: SendCDP,
  options: { ref?: string; text?: string; url?: string; ms?: number; load?: string; fn?: string },
  refMap: Map<string, SnapshotRef>,
  timeout: number = 10000,
): Promise<void> {
  // Simple sleep
  if (options.ms) {
    await new Promise((resolve) => setTimeout(resolve, options.ms))
    return
  }

  const deadline = Date.now() + timeout
  const poll = async (check: () => Promise<boolean>) => {
    while (Date.now() < deadline) {
      if (await check()) return
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error(`Wait timed out after ${timeout}ms`)
  }

  if (options.ref) {
    const resolved = resolveRef(options.ref, refMap)
    if (!resolved?.backendNodeId) {
      throw new Error(`Ref "${options.ref}" not found in last snapshot`)
    }
    await poll(async () => {
      const box = await getElementBox(sendCDP, resolved.backendNodeId!)
      return box != null && box.width > 0 && box.height > 0
    })
    return
  }

  if (options.text) {
    const searchText = options.text
    await poll(async () => {
      const result = (await sendCDP('Runtime.evaluate', {
        expression: `document.body?.innerText?.includes(${JSON.stringify(searchText)}) ?? false`,
        returnByValue: true,
      })) as any
      return !!result?.result?.value
    })
    return
  }

  if (options.url) {
    const urlPattern = options.url
    await poll(async () => {
      const result = (await sendCDP('Runtime.evaluate', {
        expression: 'window.location.href',
        returnByValue: true,
      })) as any
      const currentUrl = result?.result?.value || ''
      // Support glob patterns: ** = anything
      const regex = new RegExp('^' + urlPattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$')
      return regex.test(currentUrl)
    })
    return
  }

  if (options.load) {
    if (options.load === 'domcontentloaded' || options.load === 'load') {
      await poll(async () => {
        const result = (await sendCDP('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        })) as any
        const state = result?.result?.value || ''
        if (options.load === 'domcontentloaded') return state === 'interactive' || state === 'complete'
        return state === 'complete'
      })
    } else if (options.load === 'networkidle') {
      // Simple heuristic: wait for document complete + short idle period
      await new Promise((resolve) => setTimeout(resolve, 1000))
      await poll(async () => {
        const result = (await sendCDP('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        })) as any
        return result?.result?.value === 'complete'
      })
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    return
  }

  if (options.fn) {
    const expression = options.fn
    await poll(async () => {
      const result = (await sendCDP('Runtime.evaluate', {
        expression,
        returnByValue: true,
      })) as any
      if (result?.exceptionDetails) {
        throw new Error(`wait --fn error: ${result.exceptionDetails.text || result.exceptionDetails.exception?.description || 'evaluation failed'}`)
      }
      return !!result?.result?.value
    })
    return
  }

  throw new Error('wait requires one of: <ref>, --text, --url, --load, --fn, or <ms>')
}

export async function viewport(
  sendCDP: SendCDP,
  width: number,
  height: number,
): Promise<void> {
  await sendCDP('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  })
}

// ============================================================================
// Raw CDP passthrough
// ============================================================================

export async function rawCDP(
  sendCDP: SendCDP,
  method: string,
  params?: unknown,
): Promise<unknown> {
  return sendCDP(method, params)
}
