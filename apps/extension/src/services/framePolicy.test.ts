import { describe, expect, it } from "vitest";
import { classifyFramePolicy } from "./framePolicy";

describe("breakpoint iframe policy", () => {
  it.each([
    [{ "x-frame-options": "DENY" }, "blocked"],
    [{ "x-frame-options": "SAMEORIGIN" }, "blocked"],
    [{ "content-security-policy": "default-src 'self'; frame-ancestors 'none'" }, "blocked"],
    [{ "content-security-policy": "frame-ancestors *" }, "allowed"],
  ])("classifies browser-enforced frame headers", (values, expected) => {
    expect(classifyFramePolicy(new Headers(values)).state).toBe(expected);
  });
});
