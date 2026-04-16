export type PasswordCheck = { id: string; pass: boolean; label: string };

export function getPasswordChecks(password: string): PasswordCheck[] {
  return [
    { id: "len", pass: password.length >= 10, label: "At least 10 characters" },
    { id: "upper", pass: /[A-Z]/.test(password), label: "One uppercase letter" },
    { id: "lower", pass: /[a-z]/.test(password), label: "One lowercase letter" },
    { id: "digit", pass: /\d/.test(password), label: "One number" },
    {
      id: "special",
      pass: /[^A-Za-z0-9\s]/.test(password),
      label: "One symbol (!@#$…)",
    },
  ];
}

export function passwordMeetsPolicy(password: string): boolean {
  return getPasswordChecks(password).every((c) => c.pass);
}

export function phoneDigits(input: string): string {
  return input.replace(/\D/g, "");
}

/** E.164-style length: 10–15 digits after stripping formatting */
export function isValidPhoneDigits(digits: string): boolean {
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Loose E.164 for Supabase phone sign-up: 10 digits → +1…;
 * otherwise prefix + (caller should ensure 11–15 digit international forms).
 */
export function toE164Loose(digits: string): string | null {
  if (!isValidPhoneDigits(digits)) return null;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  const t = email.trim();
  if (t.length < 3 || t.length > 254) return false;
  return EMAIL_RE.test(t);
}

const NAME_RE = /^[\p{L}][\p{L}\s'.-]{0,59}$/u;

export function isValidFirstName(name: string): boolean {
  const t = name.trim();
  if (t.length < 1 || t.length > 60) return false;
  return NAME_RE.test(t);
}

/** Same rules as first name */
export function isValidLastName(name: string): boolean {
  return isValidFirstName(name);
}

export function hasSignupContact(email: string, phoneRaw: string): boolean {
  const e = email.trim();
  const d = phoneDigits(phoneRaw);
  return isValidEmail(e) || isValidPhoneDigits(d);
}

export function firstNameHint(): string {
  return "Letters, spaces, apostrophes, and hyphens (1–60 characters).";
}

export function contactFieldsHint(): string {
  return "Provide at least one: a valid email or a mobile number (10–15 digits). Both is fine.";
}
