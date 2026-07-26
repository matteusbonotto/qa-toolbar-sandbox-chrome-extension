import QRCode from "qrcode";

window.QTS_QRCODE = Object.freeze({
  toCanvas(canvas, text, options = {}) {
    return QRCode.toCanvas(canvas, text, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 280,
      color: { dark: "#111827", light: "#ffffff" },
      ...options,
    });
  },
  toDataURL(text, options = {}) {
    return QRCode.toDataURL(text, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 512,
      color: { dark: "#111827", light: "#ffffff" },
      ...options,
    });
  },
});
