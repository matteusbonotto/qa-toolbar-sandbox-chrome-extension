import { describe, expect, it } from "vitest";
import { supportedRecordingFormats } from "./recording";

describe("recording capability detection", () => {
  it("prefers only MIME types actually supported by the browser", () => {
    const fake = { isTypeSupported: (mime: string) => mime.includes("webm") } as typeof MediaRecorder;
    const formats = supportedRecordingFormats(fake);
    expect(formats.every((format) => format.extension === "webm")).toBe(true);
    expect(formats.some((format) => format.mimeType.includes("vp9"))).toBe(true);
  });
});
