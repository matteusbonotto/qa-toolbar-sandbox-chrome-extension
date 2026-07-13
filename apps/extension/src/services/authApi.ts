import { z } from "zod";

const sessionSchema = z.object({
  accessToken: z.string().min(20).max(8192),
  refreshToken: z.string().min(1).max(4096),
  expiresAt: z.number().int().positive(),
  user: z.object({ id: z.string().uuid(), email: z.string().email().optional() }),
}).strict();

export type AuthSession = z.infer<typeof sessionSchema>;
export type SignUpResult = AuthSession | { confirmationRequired: true; email: string };

interface SessionStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export class AuthApi {
  private readonly storage: SessionStorage;

  constructor(
    private readonly supabaseUrl: string,
    private readonly supabasePublicKey: string,
    storage: SessionStorage = browser.storage.session,
  ) {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".supabase.co")) throw new Error("Invalid Supabase URL");
    this.storage = storage;
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const session = sessionSchema.parse(await this.post("auth-sign-in", { email, password }));
    await this.storage.set({ qtsAuthSession: session });
    return session;
  }

  async signUp(email: string, password: string, acceptedTerms: true, referralCode?: string): Promise<SignUpResult> {
    const raw = await this.post("auth-sign-up", { email, password, acceptedTerms, ...(referralCode ? { referralCode } : {}) });
    const confirmation = z.object({ confirmationRequired: z.literal(true), email: z.string().email() }).safeParse(raw);
    if (confirmation.success) return confirmation.data;
    const session = sessionSchema.parse(raw);
    await this.storage.set({ qtsAuthSession: session });
    return session;
  }

  async accessToken(): Promise<string | null> {
    const stored = await this.storage.get("qtsAuthSession");
    const parsed = sessionSchema.safeParse(stored.qtsAuthSession);
    if (!parsed.success) return null;
    if (parsed.data.expiresAt > Math.floor(Date.now() / 1000) + 60) return parsed.data.accessToken;
    const refreshed = sessionSchema.parse(await this.post("auth-refresh", { refreshToken: parsed.data.refreshToken }));
    await this.storage.set({ qtsAuthSession: refreshed });
    return refreshed.accessToken;
  }

  async signOut(): Promise<void> {
    await this.storage.remove("qtsAuthSession");
  }

  private async post(functionName: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${this.supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: { apikey: this.supabasePublicKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    const data: unknown = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Authentication failed");
    return data;
  }
}
