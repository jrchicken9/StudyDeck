export type PasswordCheck = { id: string; pass: boolean; label: string };

export function getPasswordChecks(password: string): PasswordCheck[] {
  return [
    { id: "len", pass: password.length >= 8, label: "8+" },
    { id: "upper", pass: /[A-Z]/.test(password), label: "Uppercase" },
    { id: "lower", pass: /[a-z]/.test(password), label: "Lowercase" },
    { id: "digit", pass: /\d/.test(password), label: "Number" },
    {
      id: "special",
      pass: /[^A-Za-z0-9\s]/.test(password),
      label: "Symbol",
    },
  ];
}

export type PasswordStrength = {
  score: number;
  total: number;
  /** Empty until the user types. */
  label: "" | "Weak" | "Moderate" | "Strong";
  meterClass: "" | "password-meter--weak" | "password-meter--good" | "password-meter--strong";
  /** Moderate or stronger. The checklist is guidance; full marks are not required. */
  acceptable: boolean;
};

/**
 * Visual strength uses the checklist. A password can be created once it is
 * moderate: at least 8 characters and 3 of the 5 checks (length, case, number, symbol).
 */
export function passwordStrength(password: string): PasswordStrength {
  const checks = getPasswordChecks(password);
  const score = checks.filter((c) => c.pass).length;
  const total = checks.length;
  if (password.length === 0) {
    return { score: 0, total, label: "", meterClass: "", acceptable: false };
  }
  const acceptable = password.length >= 8 && score >= 3;
  if (score >= total) {
    return {
      score,
      total,
      label: "Strong",
      meterClass: "password-meter--strong",
      acceptable,
    };
  }
  if (acceptable) {
    return {
      score,
      total,
      label: "Moderate",
      meterClass: "password-meter--good",
      acceptable,
    };
  }
  return {
    score,
    total,
    label: "Weak",
    meterClass: "password-meter--weak",
    acceptable: false,
  };
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
