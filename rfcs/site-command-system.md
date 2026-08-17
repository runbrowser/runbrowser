# RFC: Site Command System

> Status: **Partially Implemented** (2026-03-15)
>
> Core infrastructure is in place. Loader, executor, CLI dispatch, and API routes work.
> Remaining: `@jiweiyuan/commands` helper package, built-in example commands, MCP `skill` discovery enhancement.

---

## 1. Motivation

RunBrowser controls browsers. But agents often need **structured data** from websites — trending repos, hot posts, search results. Today they must: navigate → snapshot → parse text → extract data. This is slow, fragile, and wastes tokens.

Site commands let users write `.ts` files that encapsulate this: `runbrowser github trending --limit 5` returns clean JSON.

---

## 2. Design Principles

1. **One language: TypeScript** — No YAML. Commands are `.ts` files with full IDE support.
2. **Relay executes commands** — The relay server loads and runs site commands via jiti. The CLI is just an HTTP client.
3. **Two MCP tools** — `skill` (discover) and `run` (execute). Simple interface for agents.
4. **Node.js everywhere** — No Rust, no Bun compile. `npm install -g` is the distribution model.

---

## 3. Architecture (Implemented)

```
┌─────────────────────────────────────────────────────────┐
│                    USER / AI AGENT                       │
│                                                         │
│   CLI (Node.js)              MCP Server (Node.js)       │
│   ┌─────────────────┐       ┌─────────────────────┐    │
│   │ • Hand-written   │       │ • skill tool         │    │
│   │   arg parser     │       │ • run tool           │    │
│   │ • HTTP client    │       │   (dispatches to     │    │
│   │ • --help gen     │       │    relay API)        │    │
│   │ • Output format  │       │                      │    │
│   │   (table/json/   │       │                      │    │
│   │    csv/md/yaml)  │       │                      │    │
│   └────────┬────────┘       └──────────┬──────────┘    │
│            │ HTTP                       │ HTTP          │
│            └───────────┬───────────────┘               │
│                        ▼                                │
│   ┌────────────────────────────────────────────────┐    │
│   │       Relay Server (Node.js, port 8790)        │    │
│   │       Auto-started by CLI on first use          │    │
│   │                                                 │    │
│   │  ┌─────────────┐  ┌──────────────────────────┐ │    │
│   │  │ Existing API │  │ Site Command Engine       │ │    │
│   │  │ /api/navigate│  │                          │ │    │
│   │  │ /api/snapshot│  │ • jiti loads .ts files   │ │    │
│   │  │ /api/click   │  │ • GET /api/commands      │ │    │
│   │  │ /api/evaluate│  │ • POST /api/command/run  │ │    │
│   │  │ /api/...     │  │                          │ │    │
│   │  └─────────────┘  └──────────────────────────┘ │    │
│   │                                                 │    │
│   │  CDPExecutor → Extension → chrome.debugger      │    │
│   └────────────────────────────────────────────────┘    │
│                        ▲ WebSocket                      │
│   ┌────────────────────┴───────────────────────────┐    │
│   │          Chrome + runbrowser Extension          │    │
│   └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Process Model

```
runbrowser serve              ← Relay daemon (long-running, auto-started)
  ├── WebSocket ↔ Extension   (persistent connection)
  ├── HTTP API :8790         (serves CLI and MCP)
  ├── CDPExecutor sessions    (persists across CLI calls)
  └── Site command executor   (jiti + command registry)

runbrowser navigate <url>     ← CLI (short-lived, exits after result)
  └── HTTP POST → relay → result → stdout → exit

runbrowser github trending    ← CLI (short-lived)
  └── HTTP POST /api/command/run → relay executes .ts → result → stdout → exit
```

---

## 4. Current Implementation

### 4.1 Command Definition Format

Site commands are `.ts` or `.js` files in `~/.runbrowser/commands/<site>/<name>.ts`:

```typescript
// ~/.runbrowser/commands/github/trending.ts

export const description = 'GitHub trending repositories'

export const args = {
  limit: { type: 'number', default: 20, description: 'Number of items' },
  language: { type: 'string', description: 'Filter by language' },
}

export const columns = ['rank', 'name', 'description', 'stars', 'language']

export async function run(ctx, args) {
  await ctx.navigate('https://github.com/trending')

  const data = await ctx.evaluate(`
    [...document.querySelectorAll('article.Box-row')].map(el => ({
      name: el.querySelector('h2 a')?.textContent?.trim().replace(/\\s+/g, ''),
      description: el.querySelector('p')?.textContent?.trim() || '',
      stars: el.querySelector('.octicon-star')?.parentElement?.textContent?.trim() || '0',
      language: el.querySelector('[itemprop="programmingLanguage"]')?.textContent?.trim() || '',
    }))
  `)

  return data
    .filter(item => !args.language || item.language.toLowerCase() === args.language.toLowerCase())
    .slice(0, args.limit)
    .map((item, i) => ({ rank: i + 1, ...item }))
}
```

### 4.2 Command Loader (`custom-commands.ts`)

The relay server loads commands on demand using [jiti](https://github.com/unjs/jiti):

```typescript
// Scans ~/.runbrowser/commands/<site>/<name>.ts
const COMMANDS_DIR = path.join(RUNBROWSER_DIR, 'commands')

// List all available commands (for --help, /api/commands)
function listCustomCommands(): CommandDef[]

// Load and execute a specific command
function loadCommand(site: string, name: string): CommandModule | null
```

### 4.3 Command Context

The `run()` function receives a `CommandContext` with browser access:

```typescript
interface CommandContext {
  navigate: (url: string) => Promise<void>
  evaluate: (code: string) => Promise<any>
  wait: (ms: number) => Promise<void>
}
```

### 4.4 API Routes (`routes/api-custom-commands.ts`)

```
GET  /api/commands                    → list all registered site commands
POST /api/command/run                 → execute a site command
     { sessionId, site, name, args }  → { data, columns }
```

### 4.5 CLI Dispatch (`cli.ts`)

When no built-in command matches:

```typescript
// command = "github", subcommand = "trending"
if (args.subcommand) {
  const result = await client.runCommand(sessionId, site, name, commandArgs)
  console.log(formatTable(result.data, result.columns, format))
}
```

### 4.6 MCP Integration

The `run` MCP tool handles site commands as a fallback:

```typescript
// run({ command: "github trending --limit 5" })
// → dispatches to client.runCommand(sid, "github", "trending", { limit: 5 })
```

---

## 5. Command Management & Discovery: Full Flow

```
$ runbrowser commands list
Available command packages:

  reddit
  youtube
  x ✓ installed
  hackernews
  producthunt

Run runbrowser commands install <package> to install.

$ runbrowser commands install github
Installing github...
✓ Installed github/
  → ~/.runbrowser/commands/github/trending.ts

$ runbrowser github trending --limit 3

RANK  NAME                 STARS   LANGUAGE
---   ----                 -----   --------
1     denoland/deno        5.2k    Rust
2     tauri-apps/tauri     3.8k    Rust
3     nickel-org/nickel    2.1k    Rust

$ runbrowser github trending --limit 3 --json

[
  { "rank": 1, "name": "denoland/deno", "stars": "5.2k", "language": "Rust" },
  { "rank": 2, "name": "tauri-apps/tauri", "stars": "3.8k", "language": "Rust" },
  { "rank": 3, "name": "nickel-org/nickel", "stars": "2.1k", "language": "Rust" }
]
```

---

## 6. Remaining Work

### 6.1 `@jiweiyuan/commands` Helper Package (Not Yet)

The RFC originally proposed a `command()` helper function for type-safe command definitions. Current implementation uses plain exports (`export const description`, `export async function run`). The helper would add:

- Type-safe argument resolution
- IDE autocompletion for `BrowserAPI`
- Schema validation

### 6.2 Built-In Example Commands (Not Yet)

No example commands ship with the package yet. Planned:
- `hackernews/top.ts` — public API, no browser needed
- `github/trending.ts` — browser + DOM scraping

### 6.3 Enhanced `skill` Discovery (Partial)

The MCP `skill` tool appends available site commands to the documentation. The `--help` output does not yet fetch site commands from the relay.

### 6.4 Richer CommandContext (Partial)

The `CommandContext` only exposes `navigate`, `evaluate`, `wait`. Could be expanded to include `click`, `fill`, `snapshot`, `screenshot` etc.

---

## 7. Key Decisions

### Why Node.js CLI, not Rust?

The relay server must be Node.js (jiti, WebSocket, npm ecosystem). The CLI is a thin HTTP client — the bottleneck is always the browser (100ms–5s), not the CLI (~20ms). Maintaining two languages for 15ms startup improvement is not worth it.

### Why TypeScript-only for site commands (no YAML)?

YAML site commands are YAML wrappers around embedded JS strings — the worst of both worlds. TypeScript gives full IDE support, type checking, and debugging.

### Why two MCP tools (skill + run) instead of one per command?

Many MCP tools overwhelm agents. Two generic tools (`skill` to discover, `run` to execute) are simpler and scale to any number of commands.

### Why execute commands on the relay, not the CLI?

1. The relay already has the CDP connection — no extra round-trip.
2. jiti lives on the relay — the CLI stays dependency-light.
3. The relay is always running — no cold start for command loading.
