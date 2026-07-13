import { BillingApi } from "./billingApi";
import { AuthApi } from "./authApi";

export function createBillingApi(): BillingApi {
  const supabaseUrl = import.meta.env.WXT_PUBLIC_SUPABASE_URL as string | undefined;
  const supabasePublicKey = import.meta.env.WXT_PUBLIC_SUPABASE_KEY as string | undefined;
  if (!supabaseUrl || !supabasePublicKey) throw new Error("Public Supabase configuration is missing");
  return new BillingApi({ supabaseUrl, supabasePublicKey });
}

export function createAuthApi(): AuthApi {
  const supabaseUrl = import.meta.env.WXT_PUBLIC_SUPABASE_URL as string | undefined;
  const supabasePublicKey = import.meta.env.WXT_PUBLIC_SUPABASE_KEY as string | undefined;
  if (!supabaseUrl || !supabasePublicKey) throw new Error("Public Supabase configuration is missing");
  return new AuthApi(supabaseUrl, supabasePublicKey);
}
