/**
 * CDP-based form detector.
 *
 * Detects login, signup, and other forms by analyzing DOM attributes.
 * Uses Runtime.evaluate to run detection heuristics in the page context.
 *
 * Classification priority (highest → lowest confidence):
 * 1. autocomplete attribute (e.g. autocomplete="current-password")
 * 2. input type attribute (e.g. type="password")
 * 3. name/id attribute pattern matching
 * 4. label/placeholder text analysis
 * 5. DOM context (sibling of password field → likely username)
 */

import type { SendCDP } from '../commands.js'
import type { FormDetectionResult, DetectedForm, DetectedField } from './types.js'

/**
 * Browser-side form detection script.
 * Injected via Runtime.evaluate — runs in the page context.
 * Returns serializable data (no DOM references).
 */
const FORM_DETECTION_SCRIPT = `
(function detectForms() {
  const FIELD_PATTERNS = {
    username: {
      autocomplete: ['username'],
      type: ['text', 'email'],
      nameId: /user(name)?|login|acct|account/i,
      label: /user(name)?|login|account|sign.?in/i,
    },
    email: {
      autocomplete: ['email'],
      type: ['email'],
      nameId: /e-?mail/i,
      label: /e-?mail/i,
    },
    password: {
      autocomplete: ['current-password', 'password'],
      type: ['password'],
      nameId: /pass(word)?|pwd/i,
      label: /pass(word)?/i,
    },
    'new-password': {
      autocomplete: ['new-password'],
      type: ['password'],
      nameId: /new.?pass|confirm.?pass|repeat.?pass/i,
      label: /new password|confirm|repeat/i,
    },
    otp: {
      autocomplete: ['one-time-code'],
      type: ['text', 'number', 'tel'],
      nameId: /otp|code|token|2fa|mfa|verify|verification/i,
      label: /code|verification|2fa|otp|one.?time/i,
    },
    phone: {
      autocomplete: ['tel'],
      type: ['tel'],
      nameId: /phone|mobile|tel/i,
      label: /phone|mobile/i,
    },
  };

  function classifyField(input) {
    const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase().trim();
    const type = (input.type || 'text').toLowerCase();
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const nameId = name + ' ' + id;
    const placeholder = (input.placeholder || '').toLowerCase();
    const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
    
    // Find associated label
    let labelText = '';
    if (input.id) {
      const label = document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
      if (label) labelText = label.textContent.toLowerCase().trim();
    }
    if (!labelText && input.closest('label')) {
      labelText = input.closest('label').textContent.toLowerCase().trim();
    }
    const allLabelText = [labelText, placeholder, ariaLabel].join(' ');

    let bestRole = 'unknown';
    let bestConfidence = 0;

    for (const [role, patterns] of Object.entries(FIELD_PATTERNS)) {
      let confidence = 0;

      // Autocomplete match (highest priority)
      if (patterns.autocomplete.includes(autocomplete)) {
        confidence = 0.95;
      }
      // Type match
      else if (role === 'password' && type === 'password') {
        confidence = 0.9;
      }
      else if (patterns.type.includes(type) && patterns.nameId.test(nameId)) {
        confidence = 0.8;
      }
      // Name/ID pattern match
      else if (patterns.nameId.test(nameId)) {
        confidence = 0.7;
      }
      // Label/placeholder match
      else if (patterns.label.test(allLabelText)) {
        confidence = 0.6;
      }

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestRole = role;
      }
    }

    // Special case: text input next to a password field is likely username
    if (bestRole === 'unknown' && type === 'text') {
      const form = input.closest('form');
      if (form && form.querySelector('input[type="password"]')) {
        const inputs = Array.from(form.querySelectorAll('input:not([type="hidden"]):not([type="submit"])'));
        const passwordIndex = inputs.findIndex(i => i.type === 'password');
        const myIndex = inputs.indexOf(input);
        if (myIndex >= 0 && myIndex < passwordIndex) {
          bestRole = 'username';
          bestConfidence = 0.5;
        }
      }
    }

    const rect = input.getBoundingClientRect();
    const style = window.getComputedStyle(input);
    const isVisible = rect.width > 0 && rect.height > 0 &&
      style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';

    // Build a stable selector
    let selector = '';
    if (input.id) selector = '#' + CSS.escape(input.id);
    else if (input.name) selector = input.tagName.toLowerCase() + '[name="' + CSS.escape(input.name) + '"]';
    else {
      const parent = input.closest('form') || input.parentElement;
      if (parent) {
        const siblings = Array.from(parent.querySelectorAll(input.tagName));
        const idx = siblings.indexOf(input);
        selector = input.tagName.toLowerCase() + ':nth-of-type(' + (idx + 1) + ')';
      } else {
        selector = input.tagName.toLowerCase();
      }
    }

    return {
      selector,
      role: bestRole,
      confidence: bestConfidence,
      label: labelText || placeholder || ariaLabel || name || '',
      currentValue: input.value || '',
      isVisible,
      isEnabled: !input.disabled && !input.readOnly,
    };
  }

  function classifyForm(form, fields) {
    const hasPassword = fields.some(f => f.role === 'password');
    const hasNewPassword = fields.some(f => f.role === 'new-password');
    const hasUsername = fields.some(f => f.role === 'username' || f.role === 'email');
    const hasOtp = fields.some(f => f.role === 'otp');

    let type = 'unknown';
    let confidence = 0.3;

    if (hasOtp && !hasPassword) {
      type = 'two-factor';
      confidence = 0.8;
    } else if (hasPassword && hasUsername && !hasNewPassword) {
      type = 'login';
      confidence = 0.85;
    } else if (hasNewPassword || (hasPassword && fields.filter(f => f.role === 'password').length >= 2)) {
      type = 'signup';
      confidence = 0.7;
    } else if (hasPassword) {
      type = 'login';
      confidence = 0.6;
    }

    // Boost confidence from form action/method
    const action = (form.action || '').toLowerCase();
    if (/login|signin|auth|session/i.test(action)) {
      if (type === 'login') confidence = Math.min(confidence + 0.1, 1);
    }
    if (/register|signup|join|create/i.test(action)) {
      if (type === 'signup') confidence = Math.min(confidence + 0.1, 1);
    }

    // Find submit button
    let submitSelector = null;
    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]')
      || form.querySelector('button:not([type="button"]):not([type="reset"])')
      || form.querySelector('[role="button"]');
    if (submitBtn) {
      if (submitBtn.id) submitSelector = '#' + CSS.escape(submitBtn.id);
      else if (submitBtn.name) submitSelector = submitBtn.tagName.toLowerCase() + '[name="' + CSS.escape(submitBtn.name) + '"]';
      else submitSelector = null; // Will use form.submit() fallback
    }

    return {
      type,
      confidence,
      fields,
      submitSelector,
      action: form.action || '',
    };
  }

  // Detect forms
  const forms = document.querySelectorAll('form');
  const results = [];

  for (const form of forms) {
    const inputs = form.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])');
    if (inputs.length === 0) continue;

    const fields = Array.from(inputs).map(classifyField).filter(f => f.isVisible);
    if (fields.length === 0) continue;

    results.push(classifyForm(form, fields));
  }

  // Also check for standalone inputs not in a form (SPA login pages)
  if (results.length === 0) {
    const allInputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])');
    const standaloneFields = Array.from(allInputs)
      .filter(input => !input.closest('form'))
      .map(classifyField)
      .filter(f => f.isVisible);

    if (standaloneFields.some(f => f.role === 'password')) {
      // Find the nearest button as submit
      const passwordInput = Array.from(allInputs).find(i => i.type === 'password');
      let submitSelector = null;
      if (passwordInput) {
        const container = passwordInput.closest('div, section, main, [role="main"]') || document.body;
        const btn = container.querySelector('button[type="submit"]')
          || container.querySelector('button:not([type="button"]):not([type="reset"])')
          || container.querySelector('[role="button"]');
        if (btn && btn.id) submitSelector = '#' + CSS.escape(btn.id);
      }

      results.push({
        type: standaloneFields.some(f => f.role === 'password') ? 'login' : 'unknown',
        confidence: 0.5,
        fields: standaloneFields,
        submitSelector,
        action: '',
      });
    }
  }

  // Find the best login form
  const loginForms = results.filter(f => f.type === 'login' || f.type === 'two-factor');
  const bestLogin = loginForms.sort((a, b) => b.confidence - a.confidence)[0] || null;

  return {
    detected: loginForms.length > 0,
    forms: results,
    loginForm: bestLogin,
    pageUrl: window.location.href,
  };
})()
`

/**
 * Detect forms on the current page using CDP.
 */
export async function detectForms(sendCDP: SendCDP): Promise<FormDetectionResult> {
  try {
    const result = (await sendCDP('Runtime.evaluate', {
      expression: FORM_DETECTION_SCRIPT,
      returnByValue: true,
      timeout: 5000,
    })) as any

    if (result?.exceptionDetails) {
      return {
        detected: false,
        forms: [],
        loginForm: null,
        pageUrl: '',
      }
    }

    const value = result?.result?.value
    if (!value) {
      return {
        detected: false,
        forms: [],
        loginForm: null,
        pageUrl: '',
      }
    }

    return value as FormDetectionResult
  } catch {
    return {
      detected: false,
      forms: [],
      loginForm: null,
      pageUrl: '',
    }
  }
}
