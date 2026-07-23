import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { chromium } from "playwright";

const source = fs.readFileSync(new URL("../apps/extension/src/lib/gif-content.js", import.meta.url), "utf8");
const context = { window: {}, Uint8Array, Map, Blob, Math };
vm.runInNewContext(source, context);
const { GifEncoder } = context.window.QTS_GIF;
const encoder = new GifEncoder(16, 12, 12);
for (let frame = 0; frame < 3; frame++) {
  const data = new Uint8ClampedArray(16 * 12 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = frame * 90; data[i + 1] = (i / 4) % 255; data[i + 2] = 255 - frame * 70; data[i + 3] = 255;
  }
  encoder.addFrame({ data });
}
const bytes = new Uint8Array(await encoder.finish().arrayBuffer());
assert.equal(new TextDecoder().decode(bytes.slice(0, 6)), "GIF89a");
assert.equal(bytes.at(-1), 0x3b);
assert.equal(encoder.frameCount, 3);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const src = `data:image/gif;base64,${Buffer.from(bytes).toString("base64")}`;
  await page.setContent(`<img id="gif" src="${src}">`);
  await page.locator("#gif").evaluate((image) => image.decode());
  assert.deepEqual(await page.locator("#gif").evaluate((image) => [image.naturalWidth, image.naturalHeight]), [16, 12]);
} finally { await browser.close(); }
console.log(JSON.stringify({ gifEncoder: true, frames: 3, bytes: bytes.length }));
