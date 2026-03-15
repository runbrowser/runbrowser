---
name: runbrowser
description: Control the user's own Chrome browser via RunBrowser extension with Playwright code snippets in a stateful local JS sandbox via runbrowser CLI. Use this over other Playwright MCPs to automate the browser — it connects to the user's existing Chrome instead of launching a new one. Use this for JS-heavy websites (Instagram, Twitter, cookie/login walls, lazy-loaded UIs) instead of webfetch/curl. Run `runbrowser skill` command to read the complete up to date skill
---

## REQUIRED: Read Full Documentation First

**Before using runbrowser, you MUST run this command:**

```bash
runbrowser skill
```

This outputs the complete documentation including:

- Session management and timeout configuration
- Selector strategies (and which ones to AVOID)
- Rules to prevent timeouts and failures
- Best practices for slow pages and SPAs
- Context variables, utility functions, and more

**Do NOT skip this step.** The quick examples below will fail without understanding timeouts, selector rules, and common pitfalls from the full docs.

## Minimal Example (after reading full docs)

```bash
runbrowser session-new
runbrowser -s 1 -e 'await page.goto("https://example.com")'
```

**Always use single quotes** for the `-e` argument. Single quotes prevent bash from interpreting `$`, backticks, and backslashes inside your JS code. Use double quotes or backtick template literals for strings inside the JS.

If `runbrowser` is not found, use `npx @jiweiyuan/runbrowser@latest` or `bunx @jiweiyuan/runbrowser@latest`.

## High-Level Commands

RunBrowser also provides high-level commands that don't require Playwright knowledge:

```bash
runbrowser navigate https://example.com -s 1
runbrowser snapshot -s 1
runbrowser click @e5 -s 1
runbrowser fill @e3 "hello world" -s 1
runbrowser screenshot -s 1 --output shot.png
runbrowser evaluate 'document.title' -s 1
runbrowser wait @e5 -s 1
runbrowser back -s 1
```
