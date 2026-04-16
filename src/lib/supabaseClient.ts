import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * When `"1"`, Supabase auth reads/writes the session in sessionStorage for this tab
 * (cleared when the tab closes). Otherwise the session uses localStorage.
 * Set immediately before sign-in; cleared on sign-out.
 */
export const AUTH_SESSION_TAB_ONLY_KEY = "studydeck_auth_tab_session";

export function setAuthSessionTabOnlyForNextSignIn(tabOnly: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (tabOnly) sessionStorage.setItem(AUTH_SESSION_TAB_ONLY_KEY, "1");
    else sessionStorage.removeItem(AUTH_SESSION_TAB_ONLY_KEY);
  } catch {
    /* ignore */
  }
}

export function clearAuthSessionTabOnlyMarker(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(AUTH_SESSION_TAB_ONLY_KEY);
  } catch {
    /* ignore */
  }
}

function authSessionUsesTabStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(AUTH_SESSION_TAB_ONLY_KEY) === "1";
  } catch {
    return false;
  }
}

function primaryAuthBucket(): Storage {
  if (typeof window === "undefined") {
    return {
      length: 0,
      clear() {},
      getItem: () => null,
      key: () => null,
      setItem() {},
      removeItem() {},
    } as Storage;
  }
  return authSessionUsesTabStorage() ? window.sessionStorage : window.localStorage;
}

/**
 * Supabase auth storage adapter: session can live in localStorage (stay signed in)
 * or sessionStorage (this tab only). removeItem clears the key in both buckets.
 */
const studydeckAuthStorage: Storage = {
  get length() {
    if (typeof window === "undefined") return 0;
    return primaryAuthBucket().length;
  },
  clear() {
    if (typeof window === "undefined") return;
    try {
      primaryAuthBucket().clear();
    } catch {
      /* ignore */
    }
  },
  getItem(key: string) {
    if (typeof window === "undefined") return null;
    try {
      return primaryAuthBucket().getItem(key);
    } catch {
      return null;
    }
  },
  key(index: number) {
    if (typeof window === "undefined") return null;
    try {
      return primaryAuthBucket().key(index);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    if (typeof window === "undefined") return;
    try {
      primaryAuthBucket().setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  removeItem(key: string) {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.removeItem(key);
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export const supabase: SupabaseClient | null =
  url && anon
    ? createClient(url, anon, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storage: studydeckAuthStorage,
        },
      })
    : null;

export function isSupabaseConfigured(): boolean {
  return supabase !== null;
}
