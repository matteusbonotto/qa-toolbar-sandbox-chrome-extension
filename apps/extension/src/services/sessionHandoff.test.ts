import { describe, expect, it } from "vitest";
import { acceptLandingSession } from "./sessionHandoff";

const session = {
  accessToken: "access-token-value-long-enough",
  refreshToken: "refresh-token",
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "60c2cd97-b1c8-44d2-bef2-37d4109500e1", email: "qa@example.test" },
};

describe("landing session handoff", () => {
  it("accepts a current session only from the official landing page", () => {
    expect(acceptLandingSession({ type: "qts:landing-session-handoff", session }, "https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/")).toEqual(session);
    expect(acceptLandingSession({ type: "qts:landing-session-handoff", session }, "https://evil.example/qa-toolbar-sandbox-chrome-extension/")).toBeNull();
  });

  it("rejects expired, malformed and wrong-path messages", () => {
    expect(acceptLandingSession({ type: "qts:landing-session-handoff", session: { ...session, expiresAt: 1 } }, "https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/")).toBeNull();
    expect(acceptLandingSession({ type: "other", session }, "https://matteusbonotto.github.io/qa-toolbar-sandbox-chrome-extension/")).toBeNull();
    expect(acceptLandingSession({ type: "qts:landing-session-handoff", session }, "https://matteusbonotto.github.io/another-app/")).toBeNull();
  });
});
