import { describe, expect, it } from "vitest";
import { calculateRutVerifier, generateRut } from "./syntheticData";

describe("synthetic RUT", () => {
  it("calculates the official modulus 11 verifier", () => expect(calculateRutVerifier(12345678)).toBe("5"));
  it("generates locally without external data", () => expect(generateRut(() => 0)).toBe("5.000.000-1"));
});
