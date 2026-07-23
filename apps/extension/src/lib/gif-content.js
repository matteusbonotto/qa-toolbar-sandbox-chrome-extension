// Small, dependency-free animated GIF encoder for the MV3 content-script runtime.
// A deterministic 3-3-2 RGB palette avoids the large CPU/memory cost of quantizing every
// screen-capture frame. GIF is limited to 256 colours by design; ordered dithering preserves
// gradients and text edges better than plain colour truncation.
(() => {
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    palette[i * 3] = Math.round(((i >> 5) & 7) * 255 / 7);
    palette[i * 3 + 1] = Math.round(((i >> 2) & 7) * 255 / 7);
    palette[i * 3 + 2] = Math.round((i & 3) * 255 / 3);
  }
  const bayer = [-8, 0, -6, 2, 4, -4, 6, -2, -5, 3, -7, 1, 7, -1, 5, -3];
  const u16 = (out, value) => { out.push(value & 255, (value >>> 8) & 255); };
  const text = (out, value) => { for (let i = 0; i < value.length; i++) out.push(value.charCodeAt(i)); };

  function indexPixels(rgba, width, height) {
    const indexed = new Uint8Array(width * height);
    for (let p = 0, i = 0; p < indexed.length; p++, i += 4) {
      const d = bayer[((Math.floor(p / width) & 3) << 2) | (p % width & 3)];
      const r = Math.max(0, Math.min(255, rgba[i] + d * 2));
      const g = Math.max(0, Math.min(255, rgba[i + 1] + d * 2));
      const b = Math.max(0, Math.min(255, rgba[i + 2] + d * 4));
      indexed[p] = (r >> 5 << 5) | (g >> 5 << 2) | (b >> 6);
    }
    return indexed;
  }

  function lzw(indices) {
    const minCodeSize = 8, clear = 256, end = 257;
    const bytes = [], blocks = [];
    let bitBuffer = 0, bitCount = 0, codeSize, nextCode, dictionary;
    const emit = (code) => {
      bitBuffer |= code << bitCount; bitCount += codeSize;
      while (bitCount >= 8) { bytes.push(bitBuffer & 255); bitBuffer >>>= 8; bitCount -= 8; }
    };
    const reset = () => { dictionary = new Map(); codeSize = 9; nextCode = 258; };
    reset(); emit(clear);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const value = indices[i], key = prefix * 256 + value, found = dictionary.get(key);
      if (found !== undefined) { prefix = found; continue; }
      emit(prefix);
      if (nextCode < 4096) {
        dictionary.set(key, nextCode++);
        if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
      } else { emit(clear); reset(); }
      prefix = value;
    }
    emit(prefix); emit(end);
    if (bitCount) bytes.push(bitBuffer & 255);
    for (let i = 0; i < bytes.length; i += 255) blocks.push(bytes.slice(i, i + 255));
    return { minCodeSize, blocks };
  }

  class GifEncoder {
    constructor(width, height, delayCs) {
      this.width = width; this.height = height; this.delayCs = Math.max(2, delayCs | 0);
      this.parts = [];
      const header = []; text(header, "GIF89a"); u16(header, width); u16(header, height);
      header.push(0xf7, 0, 0); this.parts.push(new Uint8Array(header), palette);
      // Loop forever (NETSCAPE application extension).
      this.parts.push(new Uint8Array([0x21,0xff,0x0b,0x4e,0x45,0x54,0x53,0x43,0x41,0x50,0x45,0x32,0x2e,0x30,0x03,0x01,0,0,0]));
      this.frameCount = 0;
    }
    addFrame(imageData, delayCs = this.delayCs) {
      const compressed = lzw(indexPixels(imageData.data, this.width, this.height));
      const head = [0x21,0xf9,0x04,0x04]; u16(head, Math.max(2, Math.min(65535, delayCs | 0))); head.push(0,0, 0x2c);
      u16(head, 0); u16(head, 0); u16(head, this.width); u16(head, this.height); head.push(0, compressed.minCodeSize);
      this.parts.push(new Uint8Array(head));
      for (const block of compressed.blocks) this.parts.push(new Uint8Array([block.length]), new Uint8Array(block));
      this.parts.push(new Uint8Array([0])); this.frameCount++;
    }
    finish() { return new Blob([...this.parts, new Uint8Array([0x3b])], { type: "image/gif" }); }
  }
  window.QTS_GIF = Object.freeze({ GifEncoder, indexPixels, lzw });
})();
