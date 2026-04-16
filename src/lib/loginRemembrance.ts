const REMEMBERED_EMAIL_KEY = "studydeck_remembered_login_email";

export function getRememberedLoginEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(REMEMBERED_EMAIL_KEY);
    const t = v?.trim();
    return t ? t : null;
  } catch {
    return null;
  }
}

export function setRememberedLoginEmail(email: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const t = email?.trim();
    if (t) localStorage.setItem(REMEMBERED_EMAIL_KEY, t);
    else localStorage.removeItem(REMEMBERED_EMAIL_KEY);
  } catch {
    /* ignore */
  }
}
