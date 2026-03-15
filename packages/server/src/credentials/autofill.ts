/**
 * CDP-based autofill engine.
 *
 * Fills form fields using React/Vue/Angular-compatible techniques:
 * - Uses native value setter to bypass framework proxies
 * - Dispatches proper event sequence (input, change, blur)
 * - Handles multi-step login flows
 *
 * V1: Credential passes through server → CDP → DOM (minimal exposure)
 * V2: Credential flows Vault → Extension → Content Script → DOM (zero exposure)
 */

import type { SendCDP } from '../commands.js'
import type { DetectedForm, AutofillResult, CredentialSecret } from './types.js'

/**
 * Browser-side autofill script.
 * Uses native value setter for React/Vue compatibility.
 *
 * ⚠️  SECURITY: The credential is in the script text — this is V1.
 * In V2, the content script handles this and the credential never
 * passes through Runtime.evaluate.
 */
function buildAutofillScript(params: {
  fields: Array<{ selector: string; value: string }>
  submitSelector: string | null
}): string {
  const fieldsJson = JSON.stringify(params.fields)
  const submitSelector = params.submitSelector ? JSON.stringify(params.submitSelector) : 'null'

  return `
(function autofill() {
  const fields = ${fieldsJson};
  const submitSelector = ${submitSelector};
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  const textAreaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;

  let filledCount = 0;

  for (const field of fields) {
    const el = document.querySelector(field.selector);
    if (!el) continue;

    // Focus
    el.focus();
    el.click();

    // Set value using native setter (bypasses React/Vue proxies)
    const setter = el.tagName === 'TEXTAREA' ? textAreaSetter : nativeSetter;
    if (setter) {
      setter.call(el, field.value);
    } else {
      el.value = field.value;
    }

    // Dispatch events that frameworks listen to
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));

    filledCount++;
  }

  // Submit
  let submitted = false;
  if (submitSelector) {
    const btn = document.querySelector(submitSelector);
    if (btn) {
      btn.click();
      submitted = true;
    }
  }

  if (!submitted) {
    // Try to find and click any submit button
    const passwordField = fields.find(f => f.selector.includes('password') || f.selector.includes('pass'));
    if (passwordField) {
      const el = document.querySelector(passwordField.selector);
      if (el) {
        const form = el.closest('form');
        if (form) {
          const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]')
            || form.querySelector('button:not([type="button"]):not([type="reset"])');
          if (submitBtn) {
            submitBtn.click();
            submitted = true;
          } else {
            form.submit();
            submitted = true;
          }
        }
      }
    }
  }

  if (!submitted) {
    // Last resort: press Enter on the last filled field
    const lastField = fields[fields.length - 1];
    if (lastField) {
      const el = document.querySelector(lastField.selector);
      if (el) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
        submitted = true;
      }
    }
  }

  return { success: filledCount > 0, submitted, filledCount };
})()
`
}

/**
 * Fill a detected login form with credentials.
 *
 * ⚠️  SECURITY NOTE (V1):
 * The credential passes through Runtime.evaluate in this version.
 * The script is executed atomically — fill + submit in one evaluation.
 * The credential is NOT stored in any session state or logged.
 */
export async function autofillLoginForm(
  sendCDP: SendCDP,
  form: DetectedForm,
  credential: CredentialSecret,
): Promise<AutofillResult> {
  try {
    // Build field→value mapping
    const fieldsToFill: Array<{ selector: string; value: string }> = []

    for (const field of form.fields) {
      if (!field.isVisible || !field.isEnabled) continue

      switch (field.role) {
        case 'username':
        case 'email':
          fieldsToFill.push({ selector: field.selector, value: credential.username })
          break
        case 'password':
          fieldsToFill.push({ selector: field.selector, value: credential.password })
          break
        // OTP, phone, etc. — skip for now
      }
    }

    if (fieldsToFill.length === 0) {
      return { success: false, submitted: false, error: 'No fillable fields found' }
    }

    // Execute autofill script
    const script = buildAutofillScript({
      fields: fieldsToFill,
      submitSelector: form.submitSelector,
    })

    const result = (await sendCDP('Runtime.evaluate', {
      expression: script,
      returnByValue: true,
      timeout: 10000,
    })) as any

    if (result?.exceptionDetails) {
      return {
        success: false,
        submitted: false,
        error: result.exceptionDetails.exception?.description || 'Autofill script error',
      }
    }

    const value = result?.result?.value
    if (!value) {
      return { success: false, submitted: false, error: 'No result from autofill script' }
    }

    return {
      success: value.success ?? false,
      submitted: value.submitted ?? false,
    }
  } catch (error: any) {
    return {
      success: false,
      submitted: false,
      error: `Autofill error: ${error.message}`,
    }
  }
}

/**
 * Fill only the username/email field (for multi-step logins).
 */
export async function autofillUsernameOnly(
  sendCDP: SendCDP,
  form: DetectedForm,
  username: string,
): Promise<AutofillResult> {
  const usernameField = form.fields.find(
    (f) => (f.role === 'username' || f.role === 'email') && f.isVisible && f.isEnabled,
  )

  if (!usernameField) {
    return { success: false, submitted: false, error: 'No username field found' }
  }

  // Find "Next" button (common in multi-step flows)
  const script = buildAutofillScript({
    fields: [{ selector: usernameField.selector, value: username }],
    submitSelector: form.submitSelector,
  })

  const result = (await sendCDP('Runtime.evaluate', {
    expression: script,
    returnByValue: true,
    timeout: 10000,
  })) as any

  const value = result?.result?.value
  return {
    success: value?.success ?? false,
    submitted: value?.submitted ?? false,
  }
}
