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
  isValidEmail,
  isValidPhoneDigits,
  phoneDigits,
  toE164Loose,
} from "../lib/signupValidation";
import {
  canAccessExams,
  isBannedStatus,
  parseAccountStatus,
  type AccountStatus,
} from "../lib/accountStatus";
import { clearAuthSessionTabOnlyMarker, supabase } from "../lib/supabaseClient";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  /** True while resolving profile / admin flags for a signed-in user */
  accessLoading: boolean;
  /** True when the signed-in user has profiles.approved_at (Supabase migration). */
  profileApproved: boolean;
  /** Practice banks: approved profile and account_status active. */
  examAccessApproved: boolean;
  accountStatus: AccountStatus;
  /** Where to send a signed-in user from auth screens (community home, pending, or moderation). */
  signedInHomePath: string;
  /** Row in app_admins for the current user */
  isAdmin: boolean;
  refetchAccess: () => Promise<void>;
  hasSession: boolean;
  signInWithPassword: (
    email: string,
    password: string,
  ) => Promise<{
    error: string | null;
    errorCode?: string;
    errorStatus?: number;
  }>;
  signUpWithPassword: (
    password: string,
    profile: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
    },
  ) => Promise<{
    error: string | null;
    needsEmailConfirm?: boolean;
    needsPhoneConfirm?: boolean;
  }>;
  signOutUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type AccessSnapshot = {
  approvedAt: string | null;
  isAdmin: boolean;
  accountStatus: AccountStatus;
};

function signedInHomeFromSnapshot(s: AccessSnapshot): string {
  if (isBannedStatus(s.accountStatus)) return "/account/moderation";
  if (canAccessExams(s.approvedAt, s.accountStatus)) return "/community";
  if (!s.approvedAt) return "/pending-approval";
  return "/account/moderation";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(() => Boolean(supabase));
  const [accessSnapshot, setAccessSnapshot] = useState<AccessSnapshot | null>(
    null,
  );

  useEffect(() => {
    try {
      localStorage.removeItem("studydeck_guest");
      sessionStorage.removeItem("studydeck_guest_nav");
    } catch {
      /* ignore */
    }
  }, []);

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
    });
    return () => subscription.unsubscribe();
  }, []);

  const refetchAccess = useCallback(async () => {
    if (!supabase || !user?.id) return;
    const [profileRes, adminRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("approved_at, account_status")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("app_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    const approvedAt =
      typeof profileRes.data?.approved_at === "string"
        ? profileRes.data.approved_at
        : null;
    setAccessSnapshot({
      approvedAt,
      isAdmin: Boolean(adminRes.data),
      accountStatus: parseAccountStatus(profileRes.data?.account_status),
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !supabase) {
      setAccessSnapshot(null);
      return;
    }
    const ac = new AbortController();
    setAccessSnapshot(null);
    (async () => {
      const [profileRes, adminRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("approved_at, account_status")
          .eq("id", user.id)
          .maybeSingle(),
        supabase
          .from("app_admins")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      if (ac.signal.aborted) return;
      const approvedAt =
        typeof profileRes.data?.approved_at === "string"
          ? profileRes.data.approved_at
          : null;
      setAccessSnapshot({
        approvedAt,
        isAdmin: Boolean(adminRes.data),
        accountStatus: parseAccountStatus(profileRes.data?.account_status),
      });
    })();
    return () => ac.abort();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !supabase) return;
    const channel = supabase
      .channel(`profile-access-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${user.id}`,
        },
        () => {
          void refetchAccess();
        },
      )
      .subscribe();
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [user?.id, refetchAccess]);

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      if (!supabase) {
        return { error: "Supabase is not configured for this deployment." };
      }
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (!error) return { error: null };
      return {
        error: error.message,
        errorCode: typeof error.code === "string" ? error.code : undefined,
        errorStatus: error.status,
      };
    },
    [],
  );

  const signUpWithPassword = useCallback(
    async (
      password: string,
      profile: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
      },
    ) => {
      if (!supabase) {
        return { error: "Supabase is not configured for this deployment." };
      }
      const emailTrim = profile.email.trim();
      const digits = phoneDigits(profile.phone);
      const emailOk = isValidEmail(emailTrim);
      const phoneOk = isValidPhoneDigits(digits);

      if (!emailOk && !phoneOk) {
        return {
          error:
            "Enter a valid email and/or a phone number with 10–15 digits (one is required).",
        };
      }

      if (emailTrim.length > 0 && !emailOk && digits.length > 0 && !phoneOk) {
        return {
          error:
            "That email does not look valid. Fix it or enter a complete phone number.",
        };
      }

      if (digits.length > 0 && !phoneOk && emailOk) {
        return {
          error:
            "Phone number looks incomplete. Clear the field or use 10–15 digits.",
        };
      }

      const userMeta: Record<string, string> = {
        first_name: profile.firstName.trim(),
        last_name: profile.lastName.trim(),
      };
      if (digits) userMeta.phone = digits;
      if (emailTrim.length > 0) userMeta.signup_email = emailTrim;

      const { data, error } = emailOk
        ? await supabase.auth.signUp({
            email: emailTrim,
            password,
            options: { data: userMeta },
          })
        : await supabase.auth.signUp({
            phone: toE164Loose(digits) as string,
            password,
            options: { data: userMeta },
          });

      if (error) return { error: error.message };
      if (data.user && !data.session) {
        if (emailOk) {
          return { error: null, needsEmailConfirm: true };
        }
        return { error: null, needsPhoneConfirm: true };
      }
      return { error: null };
    },
    [],
  );

  const signOutUser = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    clearAuthSessionTabOnlyMarker();
    setAccessSnapshot(null);
  }, []);

  const accessLoading = Boolean(user && supabase && accessSnapshot === null);
  const profileApproved = Boolean(accessSnapshot?.approvedAt);
  const accountStatus = accessSnapshot?.accountStatus ?? "active";
  const examAccessApproved = Boolean(
    user &&
      accessSnapshot &&
      canAccessExams(accessSnapshot.approvedAt, accessSnapshot.accountStatus),
  );
  const signedInHomePath = accessSnapshot
    ? signedInHomeFromSnapshot(accessSnapshot)
    : "/pending-approval";
  const isAdmin = Boolean(accessSnapshot?.isAdmin);
  const loading =
    authLoading || (Boolean(user) && Boolean(supabase) && accessSnapshot === null);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      accessLoading,
      profileApproved,
      examAccessApproved,
      accountStatus,
      signedInHomePath,
      isAdmin,
      refetchAccess,
      hasSession: Boolean(user),
      signInWithPassword,
      signUpWithPassword,
      signOutUser,
    }),
    [
      user,
      loading,
      accessLoading,
      profileApproved,
      examAccessApproved,
      accountStatus,
      signedInHomePath,
      isAdmin,
      refetchAccess,
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
