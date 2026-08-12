# termio browser: Agent Browser Runtime — System Design

> Status: **Future / Aspirational** — Foundation (direct CDP) is implemented.
> Credential Broker, Vision Engine, and Agent Identity are not yet implemented.
>
> A secure, extensible browser runtime for AI agents.
> CDP + Extension + Credential Broker + Vision Fallback.
>
> **What's done:** Direct CDP layer (Section 3.1), high-level CLI commands,
> session management, accessibility snapshots, screen recording.
> **What's not done:** Credential Broker, Autofill Engine, Vision Engine, Agent Identity.

---

## 1. Executive Summary

termio browser is evolving from a CDP bridge tool into a full **Agent Browser Runtime** — the infrastructure layer between AI agents and the web. This document proposes a system architecture that addresses the critical gaps identified in current browser agent systems:

1. **Credential Security** — Agents can log into websites without ever seeing passwords
2. **Intelligent Autofill** — Production-grade form detection and filling (not just `input.value =`)
3. **Vision + DOM Hybrid** — DOM-first automation with vision model fallback for complex UIs
4. **Agent Identity** — Deterministic authorization, audit trails, least-privilege access
5. **Direct CDP** — No Playwright overhead; lighter, faster, more controllable

### Why This Matters

Every browser agent project today (browser-use, stagehand, openclaw, operator prototypes) shares the same fundamental problems:

| Problem | Current State | Our Solution |
|---------|--------------|--------------|
| Credentials in agent memory | Agent holds passwords in plaintext | Credential Broker — agent never sees secrets |
| Autofill broken on modern sites | `page.fill()` fails on React/Vue SPAs | Extension-based autofill engine with event simulation |
| Playwright overhead | Extra runtime layer, circular CDP routing | Direct CDP through extension |
| No vision fallback | Fails on custom UI / shadow DOM / canvas | DOM-first + computer-use vision fallback |
| No audit trail | No record of what agent accessed | Full credential access audit logging |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AI AGENT                                       │
│  (Claude, GPT, custom LLM — sends high-level actions like "login github")  │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ HTTP / MCP / CLI
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RUNBROWSER RUNTIME                                  │
│                                                                             │
│  ┌──────────────┐  ┌──────────────────┐  ┌─────────────────────────────┐   │
│  │  CDP Executor │  │  Command Engine   │  │   Session Manager          │   │
│  │  (relay)      │  │  (click, fill,   │  │   (isolated state per      │   │
│  │              │  │   navigate, etc.) │  │    agent session)           │   │
│  └──────┬───────┘  └────────┬─────────┘  └─────────────────────────────┘   │
│         │                   │                                               │
│  ┌──────┴───────────────────┴──────────────────────────────────────────┐    │
│  │                    CREDENTIAL BROKER                                │    │
│  │  ┌──────────┐  ┌──────────────┐  ┌───────────┐  ┌──────────────┐  │    │
│  │  │ Policy   │  │ Approval     │  │ Audit     │  │ Encrypted    │  │    │
│  │  │ Engine   │  │ Flow         │  │ Logger    │  │ Channel      │  │    │
│  │  └──────────┘  └──────────────┘  └───────────┘  └──────────────┘  │    │
│  └─────────────────────────┬──────────────────────────────────────────┘    │
│                             │                                               │
│  ┌──────────────────────────┴──────────────────────────────────────────┐    │
│  │                    VISION ENGINE (fallback)                          │    │
│  │  Screenshot → LLM reasoning → element mapping → DOM action          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ WebSocket
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CHROME BROWSER                                      │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                    RUNBROWSER EXTENSION                                │  │
│  │                                                                       │  │
│  │  ┌─────────────────┐  ┌──────────────────────────────────────────┐   │  │
│  │  │ Background       │  │ Content Scripts                          │   │  │
│  │  │ (CDP bridge,     │  │                                          │   │  │
│  │  │  WS relay,       │  │  ┌──────────────┐  ┌─────────────────┐  │   │  │
│  │  │  tab management) │  │  │ DOM Sensor    │  │ Autofill Engine │  │   │  │
│  │  │                  │  │  │ (form detect, │  │ (field fill,    │  │   │  │
│  │  │                  │  │  │  semantic     │  │  event simulate,│  │   │  │
│  │  │                  │  │  │  extraction)  │  │  auto submit)   │  │   │  │
│  │  │                  │  │  └──────────────┘  └─────────────────┘  │   │  │
│  │  └─────────────────┘  └──────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │ Tab 1 (🟢)   │  │ Tab 2 (🟢)   │  │ Tab 3 (⚫)   │                      │
│  └──────────────┘  └──────────────┘  └──────────────┘                      │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │              VAULT EXTENSION (1Password / Bitwarden / KeePass)        │  │
│  │              (user's existing password manager — not ours)            │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Components

### 3.1 Direct CDP Layer (Already Implemented)

termio browser already has the foundation: a Chrome extension that bridges CDP commands over WebSocket.

```
Agent → CLI/MCP → Relay Server → Extension WebSocket → chrome.debugger → Tab
```

**Current capabilities** (from the refactoring plan):
- `navigate`, `click`, `fill`, `type`, `press`, `scroll`, `hover`
- `snapshot` (accessibility tree with `@ref` labels)
- `screenshot` (with accessibility annotations)
- `evaluate` (run JS in browser via `Runtime.evaluate`)
- `wait` (element, text, URL, network idle, JS condition)
- Session management (isolated state per agent)

**Key advantage over Playwright-based systems:**
- No Playwright runtime overhead
- No circular CDP routing
- Remote-friendly (WebSocket-native)
- Works with user's existing browser (logins, extensions, cookies)

### 3.2 Extension Content Script Layer (New)

The current extension only has a **background script** that bridges CDP. We need to add **content scripts** that run inside web pages for:

1. **DOM Sensor** — Intelligent page understanding
2. **Autofill Engine** — Framework-compatible form filling
3. **Semantic Extractor** — Structured page state for agents

This is the critical missing piece that separates termio browser from every other CDP-only solution.

#### 3.2.1 DOM Sensor

The DOM Sensor continuously monitors pages and provides structured information to the agent runtime.

```typescript
// Content script: dom-sensor.ts
interface PageState {
  forms: FormInfo[]
  buttons: ButtonInfo[]
  inputs: InputInfo[]
  links: LinkInfo[]
  loginDetected: boolean
  loginFormType: 'standard' | 'multi-step' | 'oauth' | 'unknown'
  currentStep: 'email' | 'password' | '2fa' | 'complete' | null
}

interface FormInfo {
  id: string
  type: 'login' | 'signup' | 'search' | 'checkout' | 'contact' | 'unknown'
  fields: FieldInfo[]
  submitButton: ButtonInfo | null
  action: string
  method: string
  inIframe: boolean
  inShadowDOM: boolean
}

interface FieldInfo {
  element: HTMLInputElement | HTMLTextAreaElement
  role: 'username' | 'password' | 'email' | 'phone' | 'otp' | 'search' | 'unknown'
  confidence: number  // 0-1, how confident we are in the classification
  label: string
  placeholder: string
  autocomplete: string
  isVisible: boolean
  isEnabled: boolean
  framework: 'react' | 'vue' | 'angular' | 'vanilla' | 'unknown'
}
```

**Form Detection Heuristics** (inspired by Bitwarden's open-source autofill engine):

```
Field Classification Priority:
1. autocomplete attribute    (highest confidence)
   - autocomplete="username"
   - autocomplete="current-password"
   - autocomplete="new-password"
   
2. input type attribute
   - type="password"         → password field
   - type="email"            → email/username field
   - type="tel"              → phone/2FA field

3. name/id attribute matching
   - /pass(word)?/i          → password
   - /user(name)?|login/i    → username
   - /email|e-?mail/i        → email
   - /otp|code|token|2fa/i   → 2FA code

4. label text analysis
   - <label>Password</label> → password
   - aria-label="Email"      → email

5. placeholder text
   - placeholder="Enter password"

6. DOM context
   - Sibling of password field → likely username
   - Inside form with action="/login" → login form

7. Visual layout (vision fallback)
   - Screenshot → LLM → field identification
```

#### 3.2.2 Autofill Engine

The autofill engine handles the complex reality of filling forms on modern websites.

```typescript
// Content script: autofill-engine.ts

class AutofillEngine {
  /**
   * Fill a field in a way that's compatible with React/Vue/Angular.
   * This is NOT just `input.value = password`.
   */
  async fillField(element: HTMLInputElement, value: string): Promise<void> {
    // Step 1: Focus the element
    element.focus()
    element.click()
    
    // Step 2: Clear existing value using native setter
    // React overrides the value setter, so we need the native one
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype, 'value'
    )!.set!
    
    nativeSetter.call(element, '')
    element.dispatchEvent(new Event('input', { bubbles: true }))
    
    // Step 3: Set new value using native setter
    nativeSetter.call(element, value)
    
    // Step 4: Dispatch events that frameworks listen to
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }))
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }))
    
    // Step 5: Blur to trigger validation
    element.dispatchEvent(new Event('blur', { bubbles: true }))
  }

  /**
   * Submit a form using multiple fallback strategies.
   */
  async submitForm(form: FormInfo): Promise<boolean> {
    // Strategy 1: Click the submit button
    if (form.submitButton) {
      form.submitButton.element.click()
      return true
    }
    
    // Strategy 2: Submit the form directly
    if (form.formElement) {
      form.formElement.submit()
      return true
    }
    
    // Strategy 3: Find any button inside/near the form
    const buttons = this.findNearbyButtons(form)
    for (const button of buttons) {
      if (this.isLoginButton(button)) {
        button.click()
        return true
      }
    }
    
    // Strategy 4: Simulate Enter key on password field
    const passwordField = form.fields.find(f => f.role === 'password')
    if (passwordField) {
      passwordField.element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      )
      return true
    }
    
    return false
  }
  
  /**
   * Handle multi-step login flows (Google, Microsoft, AWS, etc.)
   */
  async handleMultiStepLogin(credential: { username: string }): Promise<void> {
    // Step 1: Fill email/username
    const emailField = await this.waitForField('username')
    if (!emailField) return
    
    await this.fillField(emailField.element, credential.username)
    
    // Step 2: Click "Next" button
    const nextButton = this.findNextButton()
    if (nextButton) {
      nextButton.click()
    }
    
    // Step 3: Wait for password field to appear
    // (don't fill password — credential broker will handle it)
    await this.waitForField('password')
    
    // Signal to credential broker: ready for password
    this.signalReadyForPassword()
  }
}
```

#### 3.2.3 Semantic Extractor

Provides structured page understanding for the agent, beyond what accessibility snapshots offer.

```typescript
// Content script: semantic-extractor.ts

interface SemanticPageState {
  pageType: 'login' | 'dashboard' | 'search' | 'article' | 'checkout' | 'error' | 'unknown'
  loginState: 'logged-in' | 'logged-out' | 'login-page' | 'unknown'
  
  actions: SemanticAction[]   // What can the agent do on this page
  forms: SemanticForm[]       // Structured form data
  navigation: NavItem[]       // Navigation structure
  content: ContentBlock[]     // Main content blocks
  errors: ErrorInfo[]         // Any error messages on page
}

interface SemanticAction {
  type: 'login' | 'logout' | 'search' | 'submit' | 'navigate' | 'click'
  label: string
  ref: string              // @ref from accessibility snapshot
  confidence: number
}
```

---

### 3.3 Credential Broker (New — Core Innovation)

This is the **most important new component**. It implements the security model described by 1Password's AI security principles:

> **Agents can use credentials, but never see them.**

#### 3.3.1 Security Principles

| Principle | Implementation |
|-----------|----------------|
| **Secrets stay secret** | Credentials flow Vault → Extension → DOM. Never through agent. |
| **Authorization is deterministic** | Policy engine, not LLM, decides access. |
| **Raw credentials never enter LLM** | Agent receives `login_success` / `login_failed`, never passwords. |
| **Full audit trail** | Every credential access logged with context. |
| **Least privilege** | Scoped by domain, time, and action type. |

#### 3.3.2 Architecture

```
Agent                    termio browser Runtime              Browser
  │                            │                            │
  │  "login github"            │                            │
  ├───────────────────────────►│                            │
  │                            │                            │
  │                     ┌──────┴──────┐                     │
  │                     │ Policy      │                     │
  │                     │ Engine      │                     │
  │                     │             │                     │
  │                     │ Check:      │                     │
  │                     │ - domain    │                     │
  │                     │   allowed?  │                     │
  │                     │ - scope     │                     │
  │                     │   valid?    │                     │
  │                     │ - time      │                     │
  │                     │   window?   │                     │
  │                     └──────┬──────┘                     │
  │                            │                            │
  │                     ┌──────┴──────┐                     │
  │                     │ Approval    │                     │
  │                     │ Flow        │──── Human approves  │
  │                     │             │     (if required)    │
  │                     └──────┬──────┘                     │
  │                            │                            │
  │                            │  encrypted channel         │
  │                            ├───────────────────────────►│
  │                            │                     ┌──────┴──────┐
  │                            │                     │ Vault       │
  │                            │                     │ Extension   │
  │                            │                     │ (1Password/ │
  │                            │                     │  Bitwarden/ │
  │                            │                     │  KeePassXC) │
  │                            │                     └──────┬──────┘
  │                            │                            │
  │                            │                     ┌──────┴──────┐
  │                            │                     │ Autofill    │
  │                            │                     │ Engine      │
  │                            │                     │ (content    │
  │                            │                     │  script)    │
  │                            │                     │             │
  │                            │                     │ fill +      │
  │                            │                     │ submit in   │
  │                            │                     │ same JS     │
  │                            │                     │ execution   │
  │                            │                     └──────┬──────┘
  │                            │                            │
  │                            │  session cookie set        │
  │                            │◄───────────────────────────┤
  │                            │                            │
  │  { status: "login_success",│                            │
  │    domain: "github.com" }  │                            │
  │◄───────────────────────────┤                            │
  │                            │                            │
  │  (agent continues task     │                            │
  │   with authenticated       │                            │
  │   session — never saw      │                            │
  │   the password)            │                            │
```

#### 3.3.3 Credential Broker API

```typescript
// packages/relay/src/credential-broker.ts

interface CredentialBroker {
  /**
   * Request a login action. Agent receives success/failure, never credentials.
   * 
   * Flow:
   * 1. Policy engine checks if this domain is allowed
   * 2. If human approval required, show approval prompt
   * 3. Signal vault extension to retrieve credential
   * 4. Autofill engine fills + submits form
   * 5. Return result to agent
   */
  requestLogin(params: LoginRequest): Promise<LoginResult>
  
  /**
   * Request a form fill (e.g., checkout, registration).
   * Same security model as login — agent never sees the data.
   */
  requestFill(params: FillRequest): Promise<FillResult>
  
  /**
   * Check what credentials are available for a domain.
   * Returns metadata only (domain, username hint), never passwords.
   */
  listCredentials(domain: string): Promise<CredentialMetadata[]>
}

interface LoginRequest {
  domain: string            // "github.com"
  credentialHint?: string   // "work account" (optional)
  timeout?: number          // max wait time
}

interface LoginResult {
  status: 'success' | 'failed' | 'requires_2fa' | 'requires_approval' | 'no_credentials'
  domain: string
  username?: string         // which account was used (metadata only)
  error?: string
  sessionValid: boolean     // whether browser now has valid session
}

interface CredentialMetadata {
  id: string
  domain: string
  username: string          // "user@example.com"
  lastUsed: string
  // NO password field — never exposed
}
```

#### 3.3.4 Policy Engine

```typescript
// packages/relay/src/credential-policy.ts

interface CredentialPolicy {
  /** Domains this agent session is allowed to access */
  allowedDomains: string[]        // ["github.com", "*.amazonaws.com"]
  
  /** Domains that always require human approval */
  approvalRequired: string[]      // ["*.bank.com", "stripe.com"]
  
  /** Maximum number of login attempts per domain per session */
  maxLoginsPerDomain: number      // default: 3
  
  /** Session timeout — credentials expire after this duration */
  sessionTimeout: number          // default: 3600 (1 hour)
  
  /** Whether agent can request credentials for new (unseen) domains */
  allowNewDomains: boolean        // default: false
  
  /** Auto-approve domains (no human prompt needed) */
  autoApproveDomains: string[]    // ["github.com", "slack.com"]
}
```

#### 3.3.5 Audit Logger

```typescript
// packages/relay/src/credential-audit.ts

interface CredentialAuditEntry {
  timestamp: string
  sessionId: string
  agentId: string
  action: 'login_request' | 'login_success' | 'login_failed' | 'credential_list' | 'approval_granted' | 'approval_denied'
  domain: string
  username?: string
  policyDecision: 'auto_approved' | 'human_approved' | 'denied' | 'blocked'
  metadata: Record<string, unknown>
}

// Audit log is written to ~/.runbrowser/credential-audit.jsonl
// Format: one JSON object per line, append-only
```

#### 3.3.6 Vault Integration Adapters

termio browser doesn't build its own vault. It integrates with existing password managers.

```typescript
// packages/relay/src/vault-adapters/

interface VaultAdapter {
  name: string                              // "1password" | "bitwarden" | "keepassxc"
  
  /** List credentials for a domain (metadata only) */
  listCredentials(domain: string): Promise<CredentialMetadata[]>
  
  /** 
   * Request autofill for a credential.
   * The adapter communicates with the vault extension to fill the form.
   * The credential value NEVER passes through termio browser runtime.
   */
  requestAutofill(credentialId: string, tabId: number): Promise<AutofillResult>
  
  /** Check if the vault extension is installed and unlocked */
  isAvailable(): Promise<boolean>
}

// Adapter implementations:
// - NativeAutofillAdapter: Triggers the existing vault extension's autofill
// - DirectHTTPAdapter:     For sites with known API login endpoints (bypasses DOM entirely)
// - SessionInjectionAdapter: For sites supporting cookie/token-based auth
```

**Three autofill strategies** (from most secure to most compatible):

| Strategy | Password in DOM? | Compatibility | Security |
|----------|-----------------|---------------|----------|
| **Direct HTTP login** | ❌ Never | Low (needs API endpoint) | ★★★★★ |
| **Session injection** | ❌ Never | Medium (needs cookie structure) | ★★★★★ |
| **Extension autofill + immediate submit** | ⚡ Briefly | High (works on most sites) | ★★★★ |

```
Strategy selection:
1. If site has known API login → Direct HTTP
2. If site supports OAuth/token → Session injection  
3. Otherwise → Extension autofill + immediate submit
```

---

### 3.4 Vision Engine (New — Fallback Layer)

When DOM-based automation fails (custom UI, shadow DOM, canvas, unknown layouts), the vision engine provides a fallback.

```
DOM Automation (primary, fast, reliable)
         │
         │ fails?
         ▼
Vision Engine (fallback, slower, more capable)
         │
         │ screenshot → LLM → element identification → DOM mapping
         ▼
Action Execution
```

#### 3.4.1 Architecture

```typescript
// packages/relay/src/vision-engine.ts

interface VisionEngine {
  /**
   * When DOM-based field detection fails, use vision to find elements.
   * 
   * Flow:
   * 1. Take screenshot
   * 2. Send to LLM with prompt: "Identify the login form fields"
   * 3. LLM returns bounding boxes
   * 4. Map bounding boxes to DOM elements via document.elementFromPoint()
   * 5. Return DOM elements for autofill engine
   */
  detectFormFields(tabId: number): Promise<FieldInfo[]>
  
  /**
   * When autofill fails, use vision to verify the state.
   * 
   * Flow:
   * 1. Take screenshot after autofill attempt
   * 2. Ask LLM: "Was the form filled successfully?"
   * 3. If not, retry with different strategy
   */
  verifyAutofill(tabId: number): Promise<VerificationResult>
  
  /**
   * Identify page type and state from screenshot.
   */
  classifyPage(tabId: number): Promise<PageClassification>
}
```

#### 3.4.2 Vision ↔ DOM Bridge

```typescript
// Map vision coordinates to DOM elements
async function visionToDOM(
  tabId: number, 
  boundingBox: { x: number, y: number, width: number, height: number }
): Promise<Element | null> {
  const centerX = boundingBox.x + boundingBox.width / 2
  const centerY = boundingBox.y + boundingBox.height / 2
  
  // Execute in browser context
  return await cdpEvaluate(tabId, `
    document.elementFromPoint(${centerX}, ${centerY})
  `)
}
```

#### 3.4.3 Hybrid Strategy

```
┌────────────────────────────────────────────────────┐
│                    Action Request                    │
│                  (e.g., "login github")              │
└──────────────────────┬─────────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │ DOM Sensor     │
              │ detect form    │ ─── success ──→ Autofill Engine → Submit
              └────────┬───────┘
                       │ fail
                       ▼
              ┌────────────────┐
              │ Accessibility  │
              │ Snapshot       │ ─── success ──→ Ref-based interaction
              └────────┬───────┘
                       │ fail  
                       ▼
              ┌────────────────┐
              │ Vision Engine  │
              │ (screenshot +  │ ─── success ──→ Vision-guided DOM action
              │  LLM)          │
              └────────┬───────┘
                       │ fail
                       ▼
              ┌────────────────┐
              │ Return error   │
              │ with context   │
              └────────────────┘
```

Expected success rates with hybrid approach:

| Site Type | DOM Only | + Accessibility | + Vision | Combined |
|-----------|----------|----------------|----------|----------|
| Standard HTML | 95% | 97% | 98% | ~99% |
| React/Vue SPA | 85% | 90% | 93% | ~95% |
| Multi-step login | 70% | 80% | 88% | ~90% |
| Shadow DOM / iframe | 60% | 75% | 90% | ~92% |
| Custom/Canvas UI | 20% | 30% | 85% | ~85% |

---

## 4. Data Flow: Complete Login Sequence

Here is the full sequence for an agent logging into a website:

```
Agent                    Runtime                    Extension                  Vault Ext        Website
  │                        │                          │                          │                │
  │ login("github.com")   │                          │                          │                │
  ├───────────────────────►│                          │                          │                │
  │                        │                          │                          │                │
  │                 ┌──────┤ Policy check:            │                          │                │
  │                 │      │ github.com allowed? ✓    │                          │                │
  │                 │      │ auto-approve? ✓          │                          │                │
  │                 └──────┤                          │                          │                │
  │                        │                          │                          │                │
  │                        │ navigate github.com/login│                          │                │
  │                        ├─────────────────────────►│                          │                │
  │                        │                          │──CDP──Page.navigate─────────────────────►│
  │                        │                          │◄──────────────────────────────────────────┤
  │                        │                          │                          │                │
  │                        │ DOM sensor: scan page    │                          │                │
  │                        ├─────────────────────────►│                          │                │
  │                        │                          │ content script scans DOM │                │
  │                        │◄─────────────────────────┤                          │                │
  │                        │ { loginForm: detected,   │                          │                │
  │                        │   fields: [email, pass], │                          │                │
  │                        │   type: 'standard' }     │                          │                │
  │                        │                          │                          │                │
  │                        │ request credential       │                          │                │
  │                        ├──────────────────────────┼─────────────────────────►│                │
  │                        │                          │                          │ vault lookup   │
  │                        │                          │                          │ decrypt        │
  │                        │                          │◄─────────────────────────┤                │
  │                        │                          │ credential (encrypted,   │                │
  │                        │                          │ only in extension memory)│                │
  │                        │                          │                          │                │
  │                        │ autofill + submit        │                          │                │
  │                        ├─────────────────────────►│                          │                │
  │                        │                          │ content script:          │                │
  │                        │                          │  1. fill email           │                │
  │                        │                          │  2. dispatch events      │                │
  │                        │                          │  3. fill password        │                │
  │                        │                          │  4. dispatch events      │                │
  │                        │                          │  5. click submit         │                │
  │                        │                          │  (all in same JS turn)   │                │
  │                        │                          │────────────POST /login──────────────────►│
  │                        │                          │◄─────────────────Set-Cookie──────────────┤
  │                        │                          │                          │                │
  │                        │ audit log entry          │                          │                │
  │                        │ credential cleared       │                          │                │
  │                        │◄─────────────────────────┤                          │                │
  │                        │                          │                          │                │
  │ { status: "success",  │                          │                          │                │
  │   domain: "github.com",                          │                          │                │
  │   username: "user@..." }                         │                          │                │
  │◄───────────────────────┤                          │                          │                │
  │                        │                          │                          │                │
  │ (agent continues with  │                          │                          │                │
  │  authenticated session)│                          │                          │                │
```

**Key security property:** The agent never sees the password. The credential flows:
```
Vault Extension → (encrypted) → Content Script → DOM → HTTP POST → Website
```

The termio browser runtime (relay server) never handles the raw credential either.

---

## 5. MCP / CLI Interface

### 5.1 New MCP Tools

Building on the existing termio browser CLI/MCP tools, add credential and vision tools:

```
# Existing tools (already implemented or in refactoring plan)
navigate, click, fill, type, press, scroll, hover,
snapshot, screenshot, evaluate, get_url, get_title,
back, forward, reload, wait, reset

# New: Credential tools
login <domain>              # Secure login via credential broker
login_status                # Check if currently logged in
credentials_available       # List available credentials (metadata only)

# New: Page understanding tools  
page_state                  # Semantic page state (forms, actions, login status)
detect_forms                # Detect and classify forms on page
vision_query <question>     # Ask vision model about page content

# New: Advanced autofill
autofill <form_ref>         # Fill a detected form with appropriate data
```

### 5.2 Agent Workflow Example

```bash
# Agent wants to check GitHub notifications

# 1. Navigate to GitHub
termio-browser navigate https://github.com -s 1

# 2. Check page state
termio-browser page-state -s 1
# → { loginState: "logged-out", pageType: "login", forms: [...] }

# 3. Request login (agent never sees password)
termio-browser login github.com -s 1
# → { status: "success", username: "user@example.com" }

# 4. Continue with authenticated session
termio-browser navigate https://github.com/notifications -s 1
termio-browser snapshot -s 1
# → accessibility tree of notifications page
```

### 5.3 MCP Tool Definitions

```typescript
// packages/mcp/src/server.ts — new tools

{
  name: 'login',
  description: `Securely log into a website using stored credentials. 
The agent never sees the password — credentials are handled by the 
credential broker and filled by the browser extension.
Returns login status (success/failed/requires_2fa).`,
  inputSchema: {
    type: 'object',
    properties: {
      domain: { type: 'string', description: 'Website domain (e.g., "github.com")' },
      credentialHint: { type: 'string', description: 'Optional hint to select account (e.g., "work")' },
    },
    required: ['domain'],
  },
}

{
  name: 'page_state',
  description: `Get semantic understanding of the current page.
Returns page type, login state, detected forms, available actions.
Use this before deciding what to do on a page.`,
  inputSchema: {
    type: 'object',
    properties: {},
  },
}
```

---

## 6. Security Model

### 6.1 Threat Model

| Threat | Attack Vector | Mitigation |
|--------|--------------|------------|
| **Prompt injection steals credentials** | Malicious page content tricks LLM into extracting password | Agent never has password in context |
| **Agent memory leak** | Password persists in LLM context/logs | Credentials only exist in extension memory, cleared after use |
| **Malicious page reads DOM** | `document.querySelector('input').value` during autofill | Fill + submit in same JS execution; minimal DOM exposure window |
| **CDP reads password from DOM** | `Runtime.evaluate` reads input value | Extension submits before agent can query; timing protection |
| **Over-permissioned agent** | Agent accesses banking credentials when only GitHub allowed | Policy engine with domain allowlists |
| **Hidden form credential theft** | Invisible form steals autofilled password | Content script validates form visibility + action URL + origin |
| **Replay attack** | Captured session tokens reused | Session-bound credentials with time limits |

### 6.2 Timing Protection

The critical security window is between autofill and form submission. During this time, the password exists in the DOM and could theoretically be read by CDP.

**Mitigation strategies (defense in depth):**

```
1. Single JS execution turn
   - Fill all fields + click submit in one synchronous block
   - No await/async between fill and submit
   - CDP Runtime.evaluate can't interrupt a synchronous execution

2. Minimal exposure window  
   - Content script fills → submits → clears fields
   - Total DOM exposure time: < 50ms

3. Origin validation
   - Content script verifies form action URL matches expected domain
   - Blocks hidden form attacks

4. CDP command filtering (optional, configurable)
   - During autofill, temporarily block Runtime.evaluate from agent
   - Re-enable after submit completes
```

### 6.3 Trust Boundaries

```
┌─────────────────────────────────────────────────┐
│ UNTRUSTED: Agent / LLM                          │
│ - Can send commands                             │
│ - Can observe page state                        │
│ - Can see screenshots                           │  
│ - CANNOT see raw credentials                    │
│ - CANNOT bypass policy engine                   │
└────────────────────┬────────────────────────────┘
                     │ termio browser API (filtered)
                     ▼
┌─────────────────────────────────────────────────┐
│ TRUSTED: termio browser Runtime                     │
│ - Policy engine                                 │
│ - Audit logger                                  │
│ - Credential broker (orchestration only)        │
│ - DOES NOT handle raw credentials               │
└────────────────────┬────────────────────────────┘
                     │ WebSocket (authenticated)
                     ▼
┌─────────────────────────────────────────────────┐
│ TRUSTED: Browser Extension                      │
│ - CDP bridge                                    │
│ - Content scripts (DOM sensor, autofill)        │
│ - Communicates with vault extension             │
│ - Handles raw credentials (transiently)         │
└────────────────────┬────────────────────────────┘
                     │ Extension messaging
                     ▼
┌─────────────────────────────────────────────────┐
│ TRUSTED: Vault Extension (1Password/Bitwarden)  │
│ - Encrypted credential storage                  │
│ - Decryption                                    │
│ - Zero-knowledge architecture                   │
└─────────────────────────────────────────────────┘
```

---

## 7. Implementation Plan

### Phase 1: Foundation (Week 1-2)

**Goal:** Complete the CDP refactoring and add content script infrastructure.

| Task | Description | Effort |
|------|-------------|--------|
| 1.1 | Complete CDP executor (from refactoring plan Phase 1) | 3 days |
| 1.2 | Add content script injection to extension manifest | 1 day |
| 1.3 | Implement basic DOM Sensor (form detection) | 3 days |
| 1.4 | Implement basic Autofill Engine (React-compatible fill) | 3 days |
| 1.5 | Add content script ↔ background script messaging | 1 day |

**Deliverable:** Extension can detect login forms and fill them via content script.

### Phase 2: Credential Broker (Week 3-4)

**Goal:** Implement the credential broker with policy engine.

| Task | Description | Effort |
|------|-------------|--------|
| 2.1 | Implement Credential Broker API | 2 days |
| 2.2 | Implement Policy Engine | 2 days |
| 2.3 | Implement Audit Logger | 1 day |
| 2.4 | Implement Bitwarden vault adapter (via CLI) | 3 days |
| 2.5 | Implement `login` MCP/CLI tool | 2 days |
| 2.6 | Human approval flow (system notification) | 2 days |

**Deliverable:** Agent can `login github.com` and get authenticated without seeing password.

### Phase 3: Autofill Engine Hardening (Week 5-6)

**Goal:** Make autofill work on real-world sites.

| Task | Description | Effort |
|------|-------------|--------|
| 3.1 | Multi-step login handler (Google, Microsoft) | 3 days |
| 3.2 | iframe form detection and filling | 2 days |
| 3.3 | Shadow DOM support | 2 days |
| 3.4 | Auto-submit strategy engine | 2 days |
| 3.5 | Test against top 50 websites | 3 days |

**Deliverable:** 90%+ autofill success rate on top websites.

### Phase 4: Vision Engine (Week 7-8)

**Goal:** Add vision fallback for complex UIs.

| Task | Description | Effort |
|------|-------------|--------|
| 4.1 | Screenshot → LLM field detection | 3 days |
| 4.2 | Vision → DOM element mapping | 2 days |
| 4.3 | Hybrid strategy (DOM first, vision fallback) | 2 days |
| 4.4 | `page_state` and `vision_query` tools | 2 days |
| 4.5 | Autofill verification via vision | 1 day |

**Deliverable:** 95%+ combined success rate with vision fallback.

### Phase 5: Production Hardening (Week 9-10)

| Task | Description | Effort |
|------|-------------|--------|
| 5.1 | 1Password vault adapter (via Connect API) | 3 days |
| 5.2 | KeePassXC vault adapter (via native messaging) | 2 days |
| 5.3 | Session management and cleanup | 2 days |
| 5.4 | Comprehensive E2E tests | 3 days |
| 5.5 | Documentation and examples | 2 days |

---

## 8. File Structure

```
packages/
├── extension/
│   ├── src/
│   │   ├── background.ts              # Existing: CDP bridge, WS relay
│   │   ├── content/                    # NEW: Content scripts
│   │   │   ├── dom-sensor.ts           #   Form detection, field classification
│   │   │   ├── autofill-engine.ts      #   React-compatible form filling
│   │   │   ├── semantic-extractor.ts   #   Structured page understanding
│   │   │   ├── submit-engine.ts        #   Multi-strategy form submission
│   │   │   └── vault-bridge.ts         #   Communication with vault extensions
│   │   ├── types.ts
│   │   └── recording.ts
│   └── manifest.json                   # Updated: add content_scripts
│
├── relay/
│   ├── src/
│   │   ├── server.ts                   # Existing: HTTP/WS server
│   │   ├── cdp-executor.ts             # From refactoring plan
│   │   ├── cdp-executor-manager.ts     # From refactoring plan
│   │   ├── commands.ts                 # From refactoring plan
│   │   ├── snapshot.ts                 # From refactoring plan
│   │   ├── screenshot.ts              # From refactoring plan
│   │   ├── credential-broker.ts        # NEW: Credential broker orchestration
│   │   ├── credential-policy.ts        # NEW: Policy engine
│   │   ├── credential-audit.ts         # NEW: Audit logging
│   │   ├── vision-engine.ts            # NEW: Vision model integration
│   │   └── vault-adapters/             # NEW: Vault integrations
│   │       ├── adapter.ts              #   Base adapter interface
│   │       ├── bitwarden.ts            #   Bitwarden CLI adapter
│   │       ├── onepassword.ts          #   1Password Connect adapter
│   │       └── keepassxc.ts            #   KeePassXC native messaging adapter
│   └── package.json
│
├── mcp/
│   └── src/
│       └── server.ts                   # Updated: add credential + vision tools
│
├── cli/
│   └── src/
│       └── cli.ts                      # Updated: add login, page-state commands
│
└── core/
    └── src/
        └── ...                         # Refactored per existing plan
```

---

## 9. Configuration

```jsonc
// ~/.runbrowser/config.json
{
  // Existing config
  "host": "127.0.0.1",
  "port": 8790,
  "token": null,
  
  // NEW: Credential broker config
  "credentials": {
    // Which vault adapter to use
    "vault": "bitwarden",           // "bitwarden" | "1password" | "keepassxc" | "none"
    
    // Policy defaults
    "policy": {
      "allowedDomains": ["*"],      // ["github.com", "*.google.com"] for strict mode
      "approvalRequired": ["*.bank.com", "stripe.com"],
      "autoApproveDomains": [],
      "maxLoginsPerDomain": 5,
      "sessionTimeout": 3600
    },
    
    // Audit
    "auditLog": true,
    "auditLogPath": "~/.runbrowser/credential-audit.jsonl"
  },
  
  // NEW: Vision engine config
  "vision": {
    "enabled": true,
    "provider": "anthropic",        // "anthropic" | "openai" | "local"
    "model": "claude-sonnet-4-20250514",
    "fallbackOnly": true            // Only use vision when DOM detection fails
  }
}
```

---

## 10. Comparison with Existing Systems

| Capability | termio browser (proposed) | Playwright MCP | browser-use | Browserbase + 1Password |
|-----------|----------------------|----------------|-------------|-------------------------|
| Browser | User's existing | New instance | New instance | Cloud browser |
| CDP layer | Direct (no Playwright) | Through Playwright | Through Playwright | Through Browserbase |
| Credential security | Broker (agent never sees) | Agent holds password | Agent holds password | Broker (same model) |
| Autofill engine | Extension content script | `page.fill()` | `page.fill()` | 1Password extension |
| Vision fallback | Built-in hybrid | None | Screenshot-based | None |
| Login state | Already logged in | Fresh | Fresh | Fresh |
| Bot detection | Low risk (user browser) | High risk | High risk | Medium risk |
| Extensions | User's existing | None | None | Pre-configured |
| Cost | Free (local) | Free (local) | Free (local) | $$ (cloud) |
| Self-hostable | ✓ | ✓ | ✓ | ✗ |

---

## 11. Key Design Decisions

### Why Extension Content Scripts (not just CDP)?

CDP `Runtime.evaluate` can execute JS in the page, but:

1. **Persistent monitoring** — Content scripts can use `MutationObserver` to watch for DOM changes. CDP requires polling.
2. **Isolated world** — Content scripts run in an isolated JS context. Page JS cannot access content script variables (security).
3. **Vault communication** — Content scripts can communicate with other extensions (vault) via `chrome.runtime.sendMessage`. CDP cannot.
4. **Synchronous fill+submit** — Content scripts can fill and submit in a single synchronous execution, minimizing password DOM exposure.

### Why Support Multiple Vault Adapters?

Users already have a preferred password manager. Forcing a specific vault creates friction. By supporting Bitwarden (open source), 1Password (enterprise), and KeePassXC (local-only), we cover the vast majority of users.

### Why Vision as Fallback Only?

Vision-based automation is:
- **Slower** (screenshot + LLM inference = 1-5 seconds vs. 50ms for DOM)
- **Expensive** (LLM API tokens)
- **Less reliable** for precise input filling

DOM-first with vision fallback gives the best balance of speed, cost, and reliability.

### Why Not Build Our Own Vault?

Building a secure credential vault is extremely complex (encryption, key derivation, sync, backup, compliance). Password managers have spent years perfecting this. We integrate with them instead of competing.

---

## 12. Future Directions

### Agent OAuth / Capability Tokens

Instead of username/password, websites could issue **agent capability tokens**:

```
Agent → Website: "I am agent X, acting on behalf of user Y"
Website → Agent: "Here is a scoped token for read-only access to notifications"
```

This eliminates passwords entirely. termio browser could be an early implementer of this pattern.

### Agent Identity Standard (Web Bot Auth)

Browserbase + Cloudflare's Web Bot Auth proposes a standard for agent identity. termio browser could adopt this:

```
Agent → Website: "Here is my Web Bot Auth identity token"
Website: Verify identity, grant appropriate access
```

### Multi-Agent Coordination

Multiple agents sharing a browser with different credential scopes:

```
Agent A: Can access github.com, slack.com
Agent B: Can access docs.google.com
Agent C: Can access all (admin)
```

Each agent gets its own termio browser session with its own policy.

### Credential Learning

Over time, the autofill engine learns which strategies work for which sites:

```jsonc
// ~/.runbrowser/site-strategies.json
{
  "accounts.google.com": {
    "loginType": "multi-step",
    "steps": ["email", "next", "password", "submit"],
    "submitStrategy": "button-click",
    "successIndicator": "url-change:/myaccount"
  }
}
```

---

## 13. Summary

termio browser's evolution into an Agent Browser Runtime addresses the three biggest problems in browser agent infrastructure:

1. **Security** — The Credential Broker ensures agents can authenticate without ever seeing passwords, protecting against prompt injection, memory leaks, and credential theft.

2. **Reliability** — The Extension Content Script layer (DOM Sensor + Autofill Engine) with Vision fallback achieves 95%+ success rates on real-world websites, far beyond what `page.fill()` can do.

3. **Architecture** — Direct CDP without Playwright overhead, working with the user's existing browser (with existing logins, extensions, and cookies), provides the lightest and most natural agent-browser interaction model.

The key insight is that **the browser extension is the critical security boundary**. It sits between the untrusted agent and the trusted vault, handling credentials transiently and submitting forms before the agent can observe them. This is the same architectural pattern that 1Password and Browserbase are building toward, but termio browser makes it open, local-first, and vault-agnostic.
