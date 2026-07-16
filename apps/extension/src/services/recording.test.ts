import { describe, expect, it } from "vitest";
import { buildEvidenceFilename, supportedRecordingFormats } from "./recording";

describe("recording capability detection", () => {
  it("prefers only MIME types actually supported by the browser", () => {
    const fake = { isTypeSupported: (mime: string) => mime.includes("webm") } as typeof MediaRecorder;
    const formats = supportedRecordingFormats(fake);
    expect(formats.every((format) => format.extension === "webm")).toBe(true);
    expect(formats.some((format) => format.mimeType.includes("vp9"))).toBe(true);
  });
  it("creates a sanitized evidence filename containing the complete workspace context", () => {
    expect(buildEvidenceFilename({ client: "Cliente Á", project: "Checkout", product: "AR", environment: "QA" }, "mp4", new Date("2026-07-15T12:00:00Z"))).toBe("qa-evidence_cliente-a_checkout_ar_qa_2026-07-15T12-00-00-000Z.mp4");
  });
});
