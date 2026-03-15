# RFC: Site Command System — Architecture Design

> Add site commands to RunBrowser: TypeScript plugins that turn any website into a CLI command.

## Status

- **Authors:** RunBrowser Team
- **Date:** 2026-03-15
- **Status:** Draft

---

## 1. Motivation

RunBrowser controls browsers. But agents often need **structured data** from websites — trending repos, hot posts, search results. Today they must: navigate → snapshot → parse text → extract data. This is slow, fragile, and wastes tokens.

Site commands let users write `.ts` files that encapsulate this: `runbrowser github trending --limit 5` returns clean JSON. Like OpenCLI, but built on RunBrowser's existing relay infrastructure.

---

## 2. Design Principles

1. **One language: TypeScript** — No YAML. Commands are `.ts` files with full IDE support.
2. **Relay executes commands** — The relay server (Node.js) loads and runs site commands via jiti. The CLI is just an HTTP client.
3. **Two MCP tools** — `skill` (discover) and `run` (execute). Simple interface for agents.
4. **One binary, two modes** — `runbrowser <command>` (CLI) and `runbrowser serve` (relay daemon). Same npm package.
5. **Node.js everywhere** — No Rust, no Bun compile. `npm install -g` is the distribution model. Binary distribution is a future optimization.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    USER / AI AGENT                       │
│                                                         │
│   CLI (Node.js)              MCP Server (Node.js)       │
│   ┌─────────────────┐       ┌─────────────────────┐    │
│   │ • Arg parsing    │       │ • skill tool         │    │
│   │ • HTTP client    │       │ • run tool           │    │
│   │ • --help gen     │       │ • navigate tool      │    │
│   │ • Output format  │       │ • snapshot tool      │    │
│   │   (table/json/   │       │ • click tool         │    │
│   │    csv/md)        │       │ • ... (existing)     │    │
│   └────────┬────────┘       └──────────┬──────────┘    │
│            │ HTTP                       │ HTTP          │
│            └───────────┬───────────────┘               │
│                        ▼                                │
│   ┌────────────────────────────────────────────────┐    │
│   │       Relay Server (Node.js, background)        │    │
│   │       Started by: runbrowser serve              │    │
│   │       Auto-started by CLI on first use          │    │
│   │                                                 │    │
│   │  ┌─────────────┐  ┌──────────────────────────┐ │    │
│   │  │ Existing API │  │ Site Command Engine (NEW)│ │    │
│   │  │ /api/navigate│  │                          │ │    │
│   │  │ /api/snapshot│  │ • jiti loads .ts files   │ │    │
│   │  │ /api/click   │  │ • Command registry      │ │    │
│   │  │ /api/evaluate│  │ • GET /api/commands      │ │    │
│   │  │ /api/session │  │ • POST /api/command/run  │ │    │
│   │  │ /api/...     │  │ • GET /api/command/meta  │ │    │
│   │  └─────────────┘  └──────────────────────────┘ │    │
│   │                                                 │    │
│   │  ┌─────────────────────────────────────────┐    │    │
│   │  │ CDP ↔ Extension ↔ Chrome                │    │    │
│   │  └─────────────────────────────────────────┘    │    │
│   └────────────────────────────────────────────────┘    │
│                        ▲ WebSocket                      │
│                        │                                │
│   ┌────────────────────┴───────────────────────────┐    │
│   │          Chrome + RunBrowser Extension          │    │
│   └────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Process Model

```
runbrowser serve              ← Relay daemon (long-running, background)
  ├── WebSocket ↔ Extension   (persistent connection)
  ├── HTTP API :19988         (serves CLI and MCP)
  ├── Session state           (persists across CLI calls)
  └── Site command executor   (jiti + command registry)

runbrowser navigate <url>     ← CLI (short-lived, exits after result)
  └── HTTP POST → relay → result → stdout → exit

runbrowser github trending    ← CLI (short-lived)
  └── HTTP POST /api/command/run → relay executes .ts → result → stdout → exit
```

### Installation

```bash
npm install -g @jiweiyuan/runbrowser    # CLI + server, one package
```

---

## 4. Relay Server: New Endpoints

Three new endpoints on the existing Hono relay server:

```
GET  /api/commands                    → list all registered site commands
GET  /api/command/meta/:site/:name    → command metadata (for --help)
POST /api/command/run                 → execute a site command
```

#### `GET /api/commands`

Returns all registered site commands. Used by:
- Rust CLI for `--help` and dynamic subcommand discovery
- MCP `skill` tool

```json
{
  "commands": [
    {
      "site": "github",
      "name": "trending",
      "description": "GitHub trending repositories",
      "args": {
        "limit": { "type": "number", "default": 20, "description": "Number of items" },
        "language": { "type": "string", "description": "Filter by language" }
      },
      "columns": ["rank", "name", "description", "stars", "language"]
    }
  ]
}
```

#### `GET /api/command/meta/:site/:name`

Returns metadata for a single command. Used by CLI for per-command `--help`.

```json
{
  "site": "github",
  "name": "trending",
  "description": "GitHub trending repositories",
  "args": {
    "limit": { "type": "number", "default": 20, "description": "Number of items" },
    "language": { "type": "string", "description": "Filter by language" }
  },
  "columns": ["rank", "name", "description", "stars", "language"],
  "schema": {
    "rank": "Position in trending list",
    "name": "Repository full name (owner/repo)",
    "stars": "Stars gained in time period",
    "language": "Primary programming language"
  }
}
```

#### `POST /api/command/run`

Executes a site command. Returns structured data (array of objects).

Request:
```json
{
  "sessionId": "1",
  "site": "github",
  "name": "trending",
  "args": { "limit": 5 }
}
```

Response:
```json
{
  "data": [
    { "rank": 1, "name": "denoland/deno", "stars": "5.2k", "language": "Rust" },
    { "rank": 2, "name": "tauri-apps/tauri", "stars": "3.8k", "language": "Rust" }
  ],
  "columns": ["rank", "name", "stars", "language"]
}
```

### 4.2 Background Server Self-Spawn

When the Rust CLI runs `runbrowser navigate https://example.com`, the relay must be running. Today's Node.js CLI calls `ensureRelayServer()` which spawns `node start.js` as a detached process.

The Rust CLI will:

1. Check if relay is running: `GET http://127.0.0.1:19988/version`
2. If not, spawn it: `runbrowser-server` (installed via `npm install -g @jiweiyuan/runbrowser-server`)
3. Wait for it to be ready (poll `/version`)

```rust
fn ensure_relay_server() -> Result<()> {
    // Check if already running
    if let Ok(version) = check_relay_version().await {
        return Ok(());
    }

    // Try to spawn the relay server
    let child = Command::new("runbrowser-server")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;

    // Detach the child process
    std::mem::forget(child);

    // Wait for server to be ready
    for _ in 0..25 {
        tokio::time::sleep(Duration::from_millis(200)).await;
        if check_relay_version().await.is_ok() {
            return Ok(());
        }
    }

    Err(anyhow!("Failed to start relay server within 5s"))
}
```

---

## 5. Site Commands: TypeScript Only

### 5.1 Command Definition

```typescript
// ~/.runbrowser/commands/github/trending.ts
import { command } from '@jiweiyuan/commands'

export default command({
  site: 'github',
  name: 'trending',
  description: 'GitHub trending repositories',

  args: {
    limit:    { type: 'number', default: 20, description: 'Number of items' },
    language: { type: 'string', description: 'Filter by language' },
    since:    { type: 'string', default: 'daily', description: 'Time range',
                choices: ['daily', 'weekly', 'monthly'] },
  },

  columns: ['rank', 'name', 'description', 'stars', 'language'],

  schema: {
    rank: 'Position in trending list',
    name: 'Repository full name (owner/repo)',
    stars: 'Stars gained in time period',
    language: 'Primary programming language',
  },

  async run(browser, args) {
    await browser.navigate('https://github.com/trending')

    const data = await browser.evaluate(`
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
  },
})
```

### 5.2 The `command()` Function

Exported from `@jiweiyuan/commands` (part of `@jiweiyuan/runbrowser-server`).

```typescript
// packages/server/src/commands/api.ts

export interface CommandArgs {
  [name: string]: {
    type: 'string' | 'number' | 'boolean'
    default?: any
    description?: string
    required?: boolean
    choices?: string[]
  }
}

export interface BrowserAPI {
  navigate(url: string): Promise<{ url: string; title: string }>
  evaluate(code: string): Promise<any>
  click(ref: string): Promise<void>
  snapshot(): Promise<{ snapshot: string }>
  screenshot(): Promise<{ data: string; mimeType: string }>
  fill(ref: string, value: string): Promise<void>
  type(text: string): Promise<void>
  press(key: string): Promise<void>
  scroll(direction: 'up' | 'down', amount?: number): Promise<void>
  hover(ref: string): Promise<void>
  waitFor(options: { text?: string; url?: string; ms?: number; fn?: string; timeout?: number }): Promise<void>
  getUrl(): Promise<{ url: string }>
  getTitle(): Promise<{ title: string }>
  back(): Promise<void>
  forward(): Promise<void>
  reload(): Promise<void>
}

export interface CommandDefinition<A extends CommandArgs = CommandArgs> {
  site: string
  name: string
  description: string
  args?: A
  columns?: string[]
  schema?: Record<string, string>
  browser?: boolean  // default: true. Set false for public API commands.
  run: (browser: BrowserAPI, args: ResolvedArgs<A>) => Promise<any[]>
}

export function command<A extends CommandArgs>(def: CommandDefinition<A>): CommandDefinition<A> {
  return def
}

// Type helper: resolve arg types from definition
type ResolvedArgs<A extends CommandArgs> = {
  [K in keyof A]: A[K]['type'] extends 'number' ? number
    : A[K]['type'] extends 'boolean' ? boolean
    : string
}
```

### 5.3 Command Loading (Relay Server Side)

The relay server loads commands on startup using [jiti](https://github.com/unjs/jiti):

```typescript
// packages/server/src/commands/loader.ts

import { createJiti } from 'jiti'
import * as commandApi from './api.js'

const VIRTUAL_MODULES = {
  '@jiweiyuan/commands': commandApi,
}

const COMMAND_DIRS = [
  // Built-in commands (shipped with package)
  path.join(getPackageDir(), 'commands'),
  // User global commands
  path.join(os.homedir(), '.runbrowser', 'commands'),
  // Project-local commands
  path.join(process.cwd(), '.runbrowser', 'commands'),
]

export async function loadCommands(): Promise<Map<string, CommandDefinition>> {
  const registry = new Map<string, CommandDefinition>()

  for (const dir of COMMAND_DIRS) {
    if (!fs.existsSync(dir)) continue

    for (const site of fs.readdirSync(dir)) {
      const siteDir = path.join(dir, site)
      if (!fs.statSync(siteDir).isDirectory()) continue

      for (const file of fs.readdirSync(siteDir)) {
        if (!file.endsWith('.ts') && !file.endsWith('.js')) continue

        const filePath = path.join(siteDir, file)
        try {
          const jiti = createJiti(import.meta.url, {
            moduleCache: false,
            alias: { '@jiweiyuan/commands': path.resolve(__dirname, './api.js') },
          })
          const mod = await jiti.import(filePath, { default: true })
          const cmd = mod as CommandDefinition
          registry.set(`${cmd.site}/${cmd.name}`, cmd)
        } catch (err) {
          console.error(`Failed to load command ${filePath}: ${err}`)
        }
      }
    }
  }

  return registry
}
```

### 5.4 Command Execution (Relay Server Side)

```typescript
// packages/server/src/commands/executor.ts

export async function executeCommand(
  cmd: CommandDefinition,
  sessionId: string,
  args: Record<string, any>,
  executorManager: CDPExecutorManager,
): Promise<{ data: any[]; columns: string[] }> {

  // Resolve args with defaults
  const resolvedArgs: Record<string, any> = {}
  if (cmd.args) {
    for (const [name, def] of Object.entries(cmd.args)) {
      resolvedArgs[name] = args[name] ?? def.default
    }
  }

  // Create BrowserAPI wrapper around CDPExecutor
  const executor = executorManager.getExecutor(sessionId)
  const browser = createBrowserAPI(executor)

  // Execute the command's run function
  const data = await cmd.run(browser, resolvedArgs)

  return {
    data: Array.isArray(data) ? data : [data],
    columns: cmd.columns ?? (data.length > 0 ? Object.keys(data[0]) : []),
  }
}

function createBrowserAPI(executor: CDPExecutor): BrowserAPI {
  return {
    async navigate(url) { return executor.navigate(url) },
    async evaluate(code) { return executor.evaluate(code) },
    async click(ref) { return executor.click(ref) },
    async snapshot() { return executor.snapshot() },
    async screenshot() { return executor.captureScreenshot() },
    async fill(ref, value) { return executor.fill(ref, value) },
    async type(text) { return executor.type(text) },
    async press(key) { return executor.press(key) },
    async scroll(dir, amount) { return executor.scroll(dir, amount) },
    async hover(ref) { return executor.hover(ref) },
    async waitFor(opts) { return executor.waitFor(opts) },
    async getUrl() { return executor.getUrl() },
    async getTitle() { return executor.getTitle() },
    async back() { return executor.back() },
    async forward() { return executor.forward() },
    async reload() { return executor.reload() },
  }
}
```

---

## 6. CLI: Site Command Integration

The existing Node.js CLI (hand-written arg parser, no yargs) dispatches site commands to the relay server via HTTP.

### 6.1 Dispatch Flow

```typescript
// packages/cli/src/cli.ts

// 1. Try built-in command (navigate, click, snapshot, etc.)
const builtin = getBuiltinCommand(args.command)
if (builtin) {
  await builtin.execute(args, resolveSession)
  return
}

// 2. Try site command: `runbrowser <site> <name>`
if (args.command && args.subcommand) {
  const client = createClient(args)
  await client.ensureServer()

  if (args.help) {
    const meta = await client.getCommandMeta(args.command, args.subcommand)
    printCommandHelp(metaToCommandDef(meta))
    return
  }

  const { sessionId } = await resolveSession(args)
  const result = await client.runCommand(sessionId, args.command, args.subcommand, flagsToArgs(args))

  // Format output
  const format = args.format || (args.json ? 'json' : 'table')
  console.log(formatTable(result.data, result.columns, format))
  return
}
```

### 6.2 RelayApiClient Additions

```typescript
// packages/server/src/api-client.ts — new methods

async listCommands(): Promise<CommandMeta[]> {
  const resp = await fetch(`${this.getBaseUrl()}/api/commands`)
  const data = await resp.json()
  return data.commands
}

async getCommandMeta(site: string, name: string): Promise<CommandMeta> {
  return this.post('/api/command/meta', { site, name })
}

async runCommand(sessionId: string, site: string, name: string, args: Record<string, any>): Promise<CommandResult> {
  return this.post('/api/command/run', { sessionId, site, name, args })
}
```

---

## 7. MCP Integration

Two new tools, translating to CLI/relay semantics:

```typescript
// packages/mcp/src/server.ts

server.tool(
  'skill',
  'Show available site commands and their usage. Call this first to discover what commands are available.',
  {},
  toolHandler(async () => {
    const sid = await ensureSession()
    const commands = await getClient().listCommands()

    const lines = commands.map(cmd => {
      const argStr = cmd.args
        ? Object.entries(cmd.args).map(([name, def]) =>
            def.required ? ` <${name}>` : ` [--${name}]`
          ).join('')
        : ''
      return `runbrowser ${cmd.site} ${cmd.name}${argStr}  # ${cmd.description}`
    })

    return {
      content: [{ type: 'text', text: lines.join('\n') }],
    }
  }),
)

server.tool(
  'run',
  'Run a site command to fetch structured data from a website. Use the skill tool first to discover available commands.',
  {
    site: z.string().describe('Site name (e.g. github, bilibili)'),
    command: z.string().describe('Command name (e.g. trending, hot)'),
    args: z.record(z.any()).optional().describe('Command arguments as key-value pairs'),
  },
  toolHandler(async ({ site, command, args }) => {
    const sid = await ensureSession()
    const result = await getClient().runCommand(sid, site, command, args ?? {})
    return {
      content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
    }
  }),
)
```

---

## 8. Distribution

### 8.1 What Gets Published

| Package | Registry | Contents |
|---------|----------|----------|
| `@jiweiyuan/runbrowser` | npm | CLI + server (one package) |
| `@jiweiyuan/runbrowser-mcp` | npm | MCP server (thin wrapper, calls relay API) |
| `@jiweiyuan/runbrowser-server` | npm | Relay server (also used standalone) |

### 8.2 Installation

```bash
npm install -g @jiweiyuan/runbrowser
```

One command. CLI + server. Done.

### 8.3 Future: Binary Distribution

When the product matures, compile with Bun for zero-dependency installation:

```bash
curl -fsSL https://runbrowser.com/install.sh | sh
# or
brew install runbrowser
```

This is a future optimization, not a priority now.

---

## 9. Command Discovery: Full Flow

```
$ runbrowser --help

runbrowser v1.0.0 — Control your running Chrome browser

Usage: runbrowser <command> [options]

Navigation:
  navigate (open, goto)    Navigate to a URL
  back                     Go back in history
  ...

Interaction:
  click <ref>              Click an element
  fill <ref> <value>       Fill an input
  ...

Site Commands:                              ← fetched from relay
  github trending          GitHub trending repos
  bilibili hot             Bilibili 热门视频
  hackernews top           Hacker News top stories

Global Options:
  -s, --session <string>   Session ID
  ...

$ runbrowser github trending --help         ← metadata from relay

Usage: runbrowser github trending [options]

GitHub trending repositories

Options:
  --limit <number>         Number of items (default: 20)
  --language <string>      Filter by language
  --since <string>         Time range (default: daily) [daily, weekly, monthly]

Returns:
  rank       Position in trending list
  name       Repository full name (owner/repo)
  stars      Stars gained in time period
  language   Primary programming language

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

## 10. Implementation Plan

### Phase 1: Command Engine on Relay Server

Add site command infrastructure to the existing relay server.

| Task | Description |
|------|-------------|
| 1.1 | Add `jiti` dependency to server package |
| 1.2 | Implement `command()` API and `BrowserAPI` interface (`packages/server/src/commands/api.ts`) |
| 1.3 | Implement jiti-based command loader (`packages/server/src/commands/loader.ts`) |
| 1.4 | Implement command executor wrapping CDPExecutor (`packages/server/src/commands/executor.ts`) |
| 1.5 | Add `/api/commands`, `/api/command/meta`, `/api/command/run` Hono routes |

**Deliverable:** Relay server can load `.ts` commands and serve them via HTTP API.

### Phase 2: CLI Integration

Wire the CLI to dispatch site commands to the relay.

| Task | Description |
|------|-------------|
| 2.1 | Add `listCommands()`, `getCommandMeta()`, `runCommand()` to `RelayApiClient` |
| 2.2 | Add site command dispatch in CLI (`args.command` + `args.subcommand` → relay API) |
| 2.3 | Generate `--help` from relay command metadata |
| 2.4 | Include site commands in main `--help` output |
| 2.5 | Output formatting for site command results (table/json/csv/md) |

**Deliverable:** `runbrowser github trending --limit 5` works end-to-end.

### Phase 3: MCP Integration

Add two MCP tools for agent access.

| Task | Description |
|------|-------------|
| 3.1 | Add `skill` MCP tool (lists commands from relay) |
| 3.2 | Add `run` MCP tool (executes command via relay) |

**Deliverable:** AI agent can discover and execute site commands via MCP.

### Phase 4: Example Commands

Ship built-in commands to prove the system works.

| Task | Description |
|------|-------------|
| 4.1 | `hackernews/top.ts` — public API, no browser needed |
| 4.2 | `github/trending.ts` — browser, DOM scraping |
| 4.3 | `v2ex/hot.ts` — public API |

**Deliverable:** Three working example commands users can reference.

### Phase 5 (Future): Extension Flags + Binary Distribution

| Task | Description |
|------|-------------|
| 5.1 | Extension flag registration API on relay |
| 5.2 | Two-phase flag resolution in CLI |
| 5.3 | Bun compile for binary distribution |

---

## 11. Key Decisions

### Why Node.js, not Rust?

The relay server must be Node.js (jiti, WebSocket, npm ecosystem). The CLI is a thin HTTP client — the bottleneck is always the browser (100ms-5s), not the CLI (20ms). Maintaining two languages for 15ms startup improvement is not worth it.

### Why TypeScript-only for site commands (no YAML)?

YAML site commands are YAML wrappers around embedded JS strings — the worst of both worlds. TypeScript gives full IDE support, type checking, and debugging.

### Why two MCP tools (skill + run) instead of one per site command?

47 MCP tools overwhelm agents. Two generic tools (`skill` to discover, `run` to execute) are simpler and scale to any number of site commands.

### Why execute commands on the relay, not the CLI?

1. The relay already has the CDP connection — no extra round-trip.
2. jiti lives on the relay — the CLI stays dependency-light.
3. Future Rust/Bun CLI can call the same API without change.
4. The relay is always running — no cold start for command loading.

### Why `npm install -g`, not binary?

Users are developers. They have Node.js. Binary distribution (Bun compile) is a future optimization when the product matures.

---

## 12. Success Criteria

1. `runbrowser github trending --limit 5` returns data in <2 seconds (excluding browser time)
2. `runbrowser --help` shows site commands fetched from relay
3. `runbrowser github trending --help` shows args/columns from command metadata
4. User can create a new site command by dropping a `.ts` file into `~/.runbrowser/commands/`
5. MCP agent can discover and execute site commands via `skill` + `run`
6. Output supports `--json` (agent-friendly) and `table` (human-friendly)
