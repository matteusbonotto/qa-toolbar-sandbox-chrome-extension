import type { AuthSession } from "./authApi";

export interface SessionProvider {
  session(): Promise<AuthSession | null>;
}

/**
 * A single fail-closed authorization boundary shared by extension surfaces.
 * Network errors, invalid refresh tokens and missing sessions are all denied.
 */
export async function authorizeExtensionSurface(provider: SessionProvider): Promise<AuthSession | null> {
  try {
    return await provider.session();
  } catch {
    return null;
  }
}
