import { createClient } from "@supabase/supabase-js";
import { detectAuthRedirect, type AuthRedirectKind } from "./pendingPlanIntent";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

// Captured BEFORE createClient: with detectSessionInUrl the client consumes the e-mail link tokens
// and strips them from the URL, after which nothing tells this page load came from a confirmation
// or magic link. PricingSection uses it to resume a pending voucher/plan or explain what to do.
export const authRedirectOnLoad: AuthRedirectKind = typeof window !== "undefined"
  ? detectAuthRedirect(window.location.hash, window.location.search)
  : "none";

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabasePublishableKey!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  : null;
