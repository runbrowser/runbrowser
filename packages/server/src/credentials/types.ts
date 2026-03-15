/**
 * Credential Broker — shared types.
 *
 * Core principle: agents can USE credentials but never SEE them.
 * Raw passwords never appear in agent context, logs, or LLM memory.
 */

// ============================================================================
// Login flow
// ============================================================================

export interface LoginRequest {
  /** RunBrowser session ID */
  sessionId: string
  /** Target domain (e.g. "github.com") */
  domain: string
  /** Optional hint to select a specific account (e.g. "work", "personal") */
  credentialHint?: string
  /** Max wait time in ms (default: 30000) */
  timeout?: number
}

export type LoginStatus =
  | 'success'
  | 'failed'
  | 'requires_2fa'
  | 'requires_approval'
  | 'no_credentials'
  | 'denied'
  | 'not_configured'

export interface LoginResult {
  status: LoginStatus
  /** Which account was used (metadata only — never the password) */
  username?: string
  domain?: string
  error?: string
}

// ============================================================================
// Credential metadata (never contains secrets)
// ============================================================================

export interface CredentialMetadata {
  id: string
  domain: string
  username: string
  /** Display label (e.g. "Work GitHub") */
  label?: string
  lastUsed?: string
  // NO password field — never exposed to agent
}

/** Internal-only: raw credential for autofill. NEVER sent to agent. */
export interface CredentialSecret {
  id: string
  username: string
  password: string
  /** OTP/TOTP secret if available */
  totp?: string
}

// ============================================================================
// Form detection
// ============================================================================

export type FieldRole =
  | 'username'
  | 'password'
  | 'email'
  | 'phone'
  | 'otp'
  | 'search'
  | 'new-password'
  | 'unknown'

export type FormType =
  | 'login'
  | 'signup'
  | 'search'
  | 'checkout'
  | 'contact'
  | 'two-factor'
  | 'unknown'

export interface DetectedField {
  /** CSS selector to target this field */
  selector: string
  /** CDP backendNodeId if available */
  backendNodeId?: number
  role: FieldRole
  /** Confidence score 0-1 */
  confidence: number
  /** Field label text */
  label: string
  /** Current value (empty string if empty) */
  currentValue: string
  /** Whether the field is visible */
  isVisible: boolean
  /** Whether the field is enabled */
  isEnabled: boolean
}

export interface DetectedForm {
  type: FormType
  /** Confidence that this is the correct form classification */
  confidence: number
  fields: DetectedField[]
  /** Submit button selector, if found */
  submitSelector: string | null
  /** Form action URL */
  action: string
}

export interface FormDetectionResult {
  /** Whether a login-like form was detected */
  detected: boolean
  forms: DetectedForm[]
  /** The best login form candidate */
  loginForm: DetectedForm | null
  /** Current page URL */
  pageUrl: string
}

// ============================================================================
// Autofill
// ============================================================================

export interface AutofillResult {
  success: boolean
  /** Whether the form was submitted */
  submitted: boolean
  error?: string
}

// ============================================================================
// Policy
// ============================================================================

export interface CredentialPolicy {
  /** Domains this agent is allowed to access. ["*"] = all. */
  allowedDomains: string[]
  /** Domains that always require human approval before login */
  approvalRequired: string[]
  /** Domains that auto-approve without human prompt */
  autoApproveDomains: string[]
  /** Max login attempts per domain per session */
  maxLoginsPerDomain: number
  /** Session timeout in seconds */
  sessionTimeout: number
}

export interface PolicyDecision {
  allowed: boolean
  denied: boolean
  reason?: string
  requiresApproval: boolean
}

// ============================================================================
// Audit
// ============================================================================

export type AuditAction =
  | 'login_request'
  | 'login_success'
  | 'login_failed'
  | 'login_denied'
  | 'credential_list'
  | 'form_detected'
  | 'autofill_attempt'
  | 'autofill_success'
  | 'autofill_failed'

export interface AuditEntry {
  timestamp: string
  sessionId: string
  action: AuditAction
  domain: string
  username?: string
  policyDecision?: string
  reason?: string
  metadata?: Record<string, unknown>
}

// ============================================================================
// Config
// ============================================================================

export interface CredentialConfig {
  /** Which vault adapter to use */
  vault: 'bitwarden' | 'json-file' | 'none'
  /** Path for json-file vault adapter */
  vaultPath?: string
  /** Policy defaults */
  policy?: Partial<CredentialPolicy>
  /** Enable audit logging */
  auditLog?: boolean
  /** Custom audit log path */
  auditLogPath?: string
}
