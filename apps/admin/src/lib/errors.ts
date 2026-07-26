// Supabase's PostgrestError/AuthError/FunctionsHttpError are plain objects with a `.message`
// (not always `instanceof Error`), so `err instanceof Error ? err.message : String(err)` - used
// all over this app's catch blocks - silently degraded to the literal string "[object Object]"
// for every Supabase-thrown error instead of the actual message.
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
