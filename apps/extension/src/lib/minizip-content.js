// Classic-script minimal ZIP writer (STORE method only, no compression) — same reasoning as the
// other lib/*-content.js twins: no build step, so no npm zip library to import. Used by the
// evidence-recording "partes" flow (toolbar.js) to package several 30s video segments into one
// .zip without a third-party conversion service. STORE (uncompressed) is deliberate: it's the
// entire ZIP spec surface that's actually needed here (files are already-compressed video, so DEFLATE
// would barely shrink them anyway) and it's simple enough to get byte-correct without a vendored
// dependency -- CRC-32 + local file headers + a central directory + the end-of-central-directory
// record, per the standard PKZIP APPNOTE format every unzip tool already implements.
(() => {
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const dosTime = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
    const dosDate = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
    return { dosTime, dosDate };
  }

  function writeUint32LE(view, offset, value) { view.setUint32(offset, value, true); }
  function writeUint16LE(view, offset, value) { view.setUint16(offset, value, true); }

  /**
   * @param {{name:string, data:Uint8Array}[]} files
   * @returns {Blob} a real, standards-conformant .zip (STORE method) containing every file
   */
  function createZip(files) {
    const { dosTime, dosDate } = dosDateTime(new Date());
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const data = file.data;
      const crc = crc32(data);
      const localHeader = new DataView(new ArrayBuffer(30));
      writeUint32LE(localHeader, 0, 0x04034b50);
      writeUint16LE(localHeader, 4, 20); // version needed to extract
      writeUint16LE(localHeader, 6, 0); // flags
      writeUint16LE(localHeader, 8, 0); // method: 0 = store
      writeUint16LE(localHeader, 10, dosTime);
      writeUint16LE(localHeader, 12, dosDate);
      writeUint32LE(localHeader, 14, crc);
      writeUint32LE(localHeader, 18, data.byteLength); // compressed size == raw size (store)
      writeUint32LE(localHeader, 22, data.byteLength);
      writeUint16LE(localHeader, 26, nameBytes.byteLength);
      writeUint16LE(localHeader, 28, 0); // extra field length
      localParts.push(new Uint8Array(localHeader.buffer), nameBytes, data);

      const centralHeader = new DataView(new ArrayBuffer(46));
      writeUint32LE(centralHeader, 0, 0x02014b50);
      writeUint16LE(centralHeader, 4, 20); // version made by
      writeUint16LE(centralHeader, 6, 20); // version needed
      writeUint16LE(centralHeader, 8, 0);
      writeUint16LE(centralHeader, 10, 0);
      writeUint16LE(centralHeader, 12, dosTime);
      writeUint16LE(centralHeader, 14, dosDate);
      writeUint32LE(centralHeader, 16, crc);
      writeUint32LE(centralHeader, 20, data.byteLength);
      writeUint32LE(centralHeader, 24, data.byteLength);
      writeUint16LE(centralHeader, 28, nameBytes.byteLength);
      writeUint16LE(centralHeader, 30, 0); // extra length
      writeUint16LE(centralHeader, 32, 0); // comment length
      writeUint16LE(centralHeader, 34, 0); // disk number start
      writeUint16LE(centralHeader, 36, 0); // internal attrs
      writeUint32LE(centralHeader, 38, 0); // external attrs
      writeUint32LE(centralHeader, 42, offset); // offset of local header
      centralParts.push(new Uint8Array(centralHeader.buffer), nameBytes);

      offset += 30 + nameBytes.byteLength + data.byteLength;
    }

    const centralStart = offset;
    let centralSize = 0;
    for (const part of centralParts) centralSize += part.byteLength;

    const end = new DataView(new ArrayBuffer(22));
    writeUint32LE(end, 0, 0x06054b50);
    writeUint16LE(end, 4, 0); // disk number
    writeUint16LE(end, 6, 0); // disk with central directory
    writeUint16LE(end, 8, files.length);
    writeUint16LE(end, 10, files.length);
    writeUint32LE(end, 12, centralSize);
    writeUint32LE(end, 16, centralStart);
    writeUint16LE(end, 20, 0); // comment length

    return new Blob([...localParts, ...centralParts, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  window.QTS_ZIP = Object.freeze({ createZip, crc32 });
})();
