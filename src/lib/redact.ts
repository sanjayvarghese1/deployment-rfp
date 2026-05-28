import crypto from "crypto";

// Conservative PII redaction utilities.
// Intentionally minimal and safe — replace obvious patterns with placeholders.

export function redactPII(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input);

  // Emails
  s = s.replace(/([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, "[REDACTED_EMAIL]");

  // Credit-card-like numbers (very permissive): groups of 13-19 digits with optional separators
  s = s.replace(/(?:\b\d[ -]*?){13,19}\b/g, "[REDACTED_CC]");

  // US SSN patterns
  s = s.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_SSN]");
  s = s.replace(/\b\d{9}\b/g, "[REDACTED_SSN]");

  // Phone numbers (basic)
  s = s.replace(/\b\+?\d{1,3}[\s-]?\(?\d{1,4}\)?[\s-]?\d{1,4}[\s-]?\d{1,9}\b/g, "[REDACTED_PHONE]");

  return s;
}

export function fingerprint(input: string | null | undefined): string {
  const s = input ? String(input) : "";
  return crypto.createHash("sha256").update(s).digest("hex");
}

export default { redactPII, fingerprint };
