const GUEST_KEY = "studydeck_guest";

export type GuestSession = {
  id: string;
  label: string;
};

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Current guest profile from this device, if any. */
export function getGuestSession(): GuestSession | null {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GuestSession;
    if (parsed?.id && typeof parsed.label === "string" && parsed.label.trim())
      return { id: parsed.id, label: parsed.label.trim() };
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Save the guest display name (required before continuing as guest).
 * Reuses the same anonymous id when updating the name on this device.
 */
export function saveGuestSession(displayName: string): GuestSession {
  const label = displayName.trim();
  if (!label) {
    throw new Error("Guest name is required");
  }
  let id = randomId();
  const existing = getGuestSession();
  if (existing) id = existing.id;
  const session: GuestSession = { id, label };
  localStorage.setItem(GUEST_KEY, JSON.stringify(session));
  return session;
}

export function clearGuestSession(): void {
  try {
    localStorage.removeItem(GUEST_KEY);
  } catch {
    /* ignore */
  }
}
