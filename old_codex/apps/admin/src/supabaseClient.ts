import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null = null;
let configError: string | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  if (configError) throw new Error(configError);

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key) {
    configError = "Configuração do Supabase ausente (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).";
    throw new Error(configError);
  }

  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) {
    configError = "Endereço do Supabase inválido.";
    throw new Error(configError);
  }

  cachedClient = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return cachedClient;
}
