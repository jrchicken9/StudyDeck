/**
 * Human-friendly copy for Supabase Auth sign-in failures.
 * Maps GoTrue `code` when present, then common `message` substrings.
 */
export function mapLoginAuthError(
  message: string | null | undefined,
  code?: string | null | undefined,
  _status?: number | null | undefined,
): string {
  const c = String(code || "")
    .toLowerCase()
    .trim();
  const m = String(message || "")
    .toLowerCase()
    .trim();

  if (
    c === "email_not_confirmed" ||
    m.includes("email not confirmed") ||
    c === "provider_email_needs_verification"
  ) {
    return "Confirm your email before signing in. Check your inbox for the confirmation link from us.";
  }

  if (c === "phone_not_confirmed" || m.includes("phone not confirmed")) {
    return "Confirm your phone number before signing in. Complete SMS verification when your project has phone auth enabled.";
  }

  if (c === "user_not_found" || c === "identity_not_found") {
    return "No account exists for that email. Check the spelling or create an account.";
  }

  if (c === "user_banned" || m.includes("banned")) {
    return "This account can’t sign in right now. Contact support if you think this is a mistake.";
  }

  if (
    c === "over_request_rate_limit" ||
    m.includes("rate limit") ||
    m.includes("too many requests")
  ) {
    return "Too many sign-in attempts. Wait a minute and try again.";
  }

  if (
    c === "invalid_credentials" ||
    m.includes("invalid login credentials") ||
    m.includes("invalid credentials")
  ) {
    return "Wrong password, or that email isn’t registered. Double-check both, or create an account.";
  }

  if (c === "email_address_invalid" || c === "validation_failed") {
    return "That email address doesn’t look valid. Fix any typos and try again.";
  }

  if (m.includes("fetch") || m.includes("network") || m.includes("failed to load")) {
    return "We couldn’t reach the server. Check your connection and try again.";
  }

  if (message && message.trim().length > 0) {
    return message.trim();
  }

  return "Something went wrong while signing in. Please try again.";
}
