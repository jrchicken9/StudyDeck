import { isSupabaseConfigured } from "./supabaseClient";

export { isSupabaseConfigured };

export function supabaseStatusMessage(): string {
  return isSupabaseConfigured()
    ? "Signed-in accounts sync through Supabase when you enable tables and policies."
    : "Accounts are disabled until you add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. Guests use this device only.";
}
