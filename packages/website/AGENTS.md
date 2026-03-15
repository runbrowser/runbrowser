# Website

## Tailwind dark mode

Dark mode uses `prefers-color-scheme` media query, configured in `globals.css`:

```css
@custom-variant dark (@media (prefers-color-scheme: dark));
```

### `@variant dark` rules

1. **Must be nested inside a selector**, never at the top level:

```css
/* WRONG - silently produces no output */
@variant dark {
  .my-class {
    color: white;
  }
}

/* CORRECT - nest inside the selector */
.my-class {
  @variant dark {
    color: white;
  }
}

/* CORRECT - define variables inside :root */
:root {
  @variant dark {
    --my-var: white;
  }
}
```

2. **Only works in CSS files that are part of the Tailwind compilation chain.** Files must be imported via CSS `@import` from `globals.css` (which has `@import "tailwindcss"`). JS/TS `import "file.css"` in route files does NOT go through Tailwind — `@variant dark` will silently fail.

If you create a new CSS file that needs `@variant dark`, add it as a CSS `@import` in `globals.css`. Do NOT import it from a `.tsx` file.

## Images must not cause layout shift

Every `<img>` must have explicit `width` and `height` attributes matching the intrinsic pixel dimensions of the source file. Add `style={{ height: "auto" }}` to keep it responsive.

## No localStorage dark mode toggle

There is no JS-based `.dark` class toggle. The site follows the OS preference only via `prefers-color-scheme`.
