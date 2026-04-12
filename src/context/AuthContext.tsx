import type { User } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  clearGuestSession,
  getGuestSession,
  saveGuestSession,
} from "../lib/session";
import { supabase } from "../lib/supabaseClient";

const GUEST_NAV_KEY = "studydeck_guest_nav";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  /** Guest browsing without Supabase account */
  isGuest: boolean;
  hasSession: boolean;
  continueAsGuest: (displayName: string) => void;
  leaveGuestSession: () => void;
  signInWithPassword: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null }>;
  signUpWithPassword: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null; needsEmailConfirm?: boolean }>;
  signOutUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readGuestFlag(): boolean {
  try {
    return sessionStorage.getItem(GUEST_NAV_KEY) === "1";
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  /** Resolving Supabase session (guests should not wait on this). */
  const [authLoading, setAuthLoading] = useState(() => Boolean(supabase));
  const [isGuest, setIsGuest] = useState(() => {
    if (!readGuestFlag()) return false;
    if (!getGuestSession()) {
      try {
        sessionStorage.removeItem(GUEST_NAV_KEY);
      } catch {
        /* ignore */
      }
      return false;
    }
    return true;
  });

  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        try {
          sessionStorage.removeItem(GUEST_NAV_KEY);
        } catch {
          /* ignore */
        }
        setIsGuest(false);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!readGuestFlag()) return;
    if (getGuestSession()) return;
    try {
      sessionStorage.removeItem(GUEST_NAV_KEY);
    } catch {
      /* ignore */
    }
    setIsGuest(false);
  }, []);

  const continueAsGuest = useCallback((displayName: string) => {
    saveGuestSession(displayName);
    try {
      sessionStorage.setItem(GUEST_NAV_KEY, "1");
    } catch {
      /* ignore */
    }
    setIsGuest(true);
  }, []);

  const leaveGuestSession = useCallback(() => {
    try {
      sessionStorage.removeItem(GUEST_NAV_KEY);
    } catch {
      /* ignore */
    }
    clearGuestSession();
    setIsGuest(false);
  }, []);

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      if (!supabase) {
        return { error: "Supabase is not configured for this deployment." };
      }
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { error: error?.message ?? null };
    },
    [],
  );

  const signUpWithPassword = useCallback(
    async (email: string, password: string) => {
      if (!supabase) {
        return { error: "Supabase is not configured for this deployment." };
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });
      if (error) return { error: error.message };
      if (data.user && !data.session) {
        return { error: null, needsEmailConfirm: true };
      }
      return { error: null };
    },
    [],
  );

  const signOutUser = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading: authLoading && !isGuest,
      isGuest,
      hasSession: Boolean(user) || isGuest,
      continueAsGuest,
      leaveGuestSession,
      signInWithPassword,
      signUpWithPassword,
      signOutUser,
    }),
    [
      user,
      authLoading,
      isGuest,
      continueAsGuest,
      leaveGuestSession,
      signInWithPassword,
      signUpWithPassword,
      signOutUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
