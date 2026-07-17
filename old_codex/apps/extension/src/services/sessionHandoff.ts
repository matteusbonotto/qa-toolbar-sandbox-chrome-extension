import { z } from "zod";

const landingOrigin = "https://matteusbonotto.github.io";
const landingPath = "/qa-toolbar-sandbox-chrome-extension/";

const sessionSchema = z.object({
  accessToken: z.string().min(20).max(8192),
  refreshToken: z.string().min(1).max(4096),
  expiresAt: z.number().int().positive(),
  user: z.object({ id: z.string().uuid(), email: z.string().email().optional() }),
}).strict();

const handoffSchema = z.object({
  type: z.literal("qts:landing-session-handoff"),
  session: sessionSchema,
}).strict();

export type HandoffSession = z.infer<typeof sessionSchema>;

export function acceptLandingSession(message: unknown, senderUrl?: string): HandoffSession | null {
  if (!senderUrl) return null;
  let url: URL;
  try { url = new URL(senderUrl); } catch { return null; }
  if (url.origin !== landingOrigin || !url.pathname.startsWith(landingPath)) return null;
  const parsed = handoffSchema.safeParse(message);
  if (!parsed.success || parsed.data.session.expiresAt <= Math.floor(Date.now() / 1000) + 30) return null;
  return parsed.data.session;
}
