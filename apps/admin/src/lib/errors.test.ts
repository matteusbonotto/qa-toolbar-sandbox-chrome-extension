import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors";

describe("errorMessage", () => {
  it("preserves Error and Supabase-style object messages", () => {
    expect(errorMessage(new Error("falha real"))).toBe("falha real");
    expect(errorMessage({ message: "falha do backend", code: "PGRST" })).toBe("falha do backend");
  });

  it("serializes other safe values instead of returning [object Object]", () => {
    expect(errorMessage({ status: 403 })).toBe('{"status":403}');
    expect(errorMessage("texto")).toBe("texto");
  });
});
