# Styles API Reference

The `getStylesForLocator` function inspects CSS styles applied to an element, similar to browser DevTools "Styles" panel.

## Quick Start

```js
const cdp = await getCDPSession({ page: state.page })
const styles = await getStylesForLocator({
  locator: state.page.locator('.my-button'),
  cdp,
})
console.log(formatStylesAsText(styles))
```

## Function Signature

```ts
getStylesForLocator({
  locator: Locator,
  cdp: ICDPSession,
  includeUserAgentStyles?: boolean,
}): Promise<StylesResult>
```

### Parameters

- `locator` - Playwright Locator pointing to the element to inspect
- `cdp` - A CDP session (from `getCDPSession({ page })`)
- `includeUserAgentStyles` - Include browser default styles (default: false)

### Return Value

```ts
interface StylesResult {
  element: string
  inlineStyle: Record<string, string> | null
  rules: StyleRule[]
}

interface StyleRule {
  selector: string
  source: { url: string; line: number; column: number } | null
  origin: 'regular' | 'user-agent' | 'injected' | 'inspector'
  declarations: Record<string, string>
  inheritedFrom: string | null
}
```

## Examples

```js
// Get styles for a button
const styles = await getStylesForLocator({
  locator: state.page.getByRole('button', { name: 'Submit' }),
  cdp: await getCDPSession({ page: state.page }),
})

// Check inline styles
if (styles.inlineStyle) {
  console.log('Inline:', styles.inlineStyle)
}

// Find where a CSS property is defined
const bgRule = styles.rules.find((r) => 'background-color' in r.declarations)
if (bgRule?.source) {
  console.log(`background-color at ${bgRule.source.url}:${bgRule.source.line}`)
}

// Check inherited styles
const inherited = styles.rules.filter((r) => r.inheritedFrom)
inherited.forEach((r) => {
  console.log(`Inherited from ${r.inheritedFrom}: ${r.selector}`)
})
```

## Formatting

Use `formatStylesAsText(styles)` for a human-readable output that shows all matched rules with their selectors, declarations, and source locations.
