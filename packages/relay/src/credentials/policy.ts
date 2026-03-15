/**
 * Credential policy engine.
 *
 * Deterministic authorization — the LLM does NOT decide access.
 * Domain allowlists, approval requirements, rate limits.
 */

import type { CredentialPolicy, PolicyDecision } from './types.js'

const DEFAULT_POLICY: CredentialPolicy = {
  allowedDomains: ['*'],
  approvalRequired: [],
  autoApproveDomains: [],
  maxLoginsPerDomain: 5,
  sessionTimeout: 3600,
}

export class PolicyEngine {
  private policy: CredentialPolicy
  /** Track login attempts: sessionId → domain → count */
  private loginCounts = new Map<string, Map<string, number>>()

  constructor(policy: Partial<CredentialPolicy> = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy }
  }

  evaluate(params: {
    sessionId: string
    domain: string
    action: 'login' | 'list_credentials'
  }): PolicyDecision {
    const { sessionId, domain, action } = params

    // 1. Check domain allowlist
    if (!this.isDomainAllowed(domain)) {
      return {
        allowed: false,
        denied: true,
        reason: `Domain "${domain}" is not in the allowed list`,
        requiresApproval: false,
      }
    }

    // 2. Check rate limit (login only)
    if (action === 'login') {
      const count = this.getLoginCount(sessionId, domain)
      if (count >= this.policy.maxLoginsPerDomain) {
        return {
          allowed: false,
          denied: true,
          reason: `Rate limit exceeded: ${count}/${this.policy.maxLoginsPerDomain} login attempts for "${domain}"`,
          requiresApproval: false,
        }
      }
    }

    // 3. Check if approval is required
    const needsApproval = this.requiresApproval(domain)
    const isAutoApproved = this.isAutoApproved(domain)

    if (needsApproval && !isAutoApproved) {
      return {
        allowed: false,
        denied: false,
        reason: `Domain "${domain}" requires human approval`,
        requiresApproval: true,
      }
    }

    return {
      allowed: true,
      denied: false,
      requiresApproval: false,
    }
  }

  /** Record a login attempt for rate limiting */
  recordLoginAttempt(sessionId: string, domain: string): void {
    if (!this.loginCounts.has(sessionId)) {
      this.loginCounts.set(sessionId, new Map())
    }
    const sessionCounts = this.loginCounts.get(sessionId)!
    const current = sessionCounts.get(domain) || 0
    sessionCounts.set(domain, current + 1)
  }

  /** Clear rate limits for a session (on session delete) */
  clearSession(sessionId: string): void {
    this.loginCounts.delete(sessionId)
  }

  /** Get current policy (for display) */
  getPolicy(): CredentialPolicy {
    return { ...this.policy }
  }

  /** Update policy at runtime */
  updatePolicy(updates: Partial<CredentialPolicy>): void {
    this.policy = { ...this.policy, ...updates }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private isDomainAllowed(domain: string): boolean {
    if (this.policy.allowedDomains.includes('*')) return true
    return this.policy.allowedDomains.some((pattern) => this.matchDomain(pattern, domain))
  }

  private requiresApproval(domain: string): boolean {
    return this.policy.approvalRequired.some((pattern) => this.matchDomain(pattern, domain))
  }

  private isAutoApproved(domain: string): boolean {
    return this.policy.autoApproveDomains.some((pattern) => this.matchDomain(pattern, domain))
  }

  private getLoginCount(sessionId: string, domain: string): number {
    return this.loginCounts.get(sessionId)?.get(domain) || 0
  }

  /** Match a domain pattern against a domain. Supports wildcard prefix (*.example.com) */
  private matchDomain(pattern: string, domain: string): boolean {
    if (pattern === domain) return true
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(1) // ".example.com"
      return domain.endsWith(suffix) || domain === pattern.slice(2)
    }
    return false
  }
}
