import { describe, expect, it } from "vitest";
import { AdminApiError } from "./adminApi";

describe("AdminApiError", () => {
  it("keeps the server error code available for callers that need to branch on it", () => {
    const error = new AdminApiError("administrator_required", "Esta conta não tem acesso ao painel administrativo.");
    expect(error.code).toBe("administrator_required");
    expect(error.message).toBe("Esta conta não tem acesso ao painel administrativo.");
  });

  it("falls back to the code itself when no human-readable message is given", () => {
    const error = new AdminApiError("request_failed");
    expect(error.message).toBe("request_failed");
  });
});
