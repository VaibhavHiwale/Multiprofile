import QRCodeCore from 'qrcode/lib/core/qrcode.js';
import { encodeGreyscalePng } from './png.js';

// The `qrcode` package's top-level entry pulls in node:fs / node:stream and a
// canvas renderer, none of which exist on Workers. Its *core* encoder, though,
// is pure JS over Uint8Array/TextEncoder with no Node builtins at all, so we
// import that directly and do the rasterising ourselves (see lib/png.js).
// Verified by test/qrcode.test.js, which runs inside workerd.
const DEFAULT_TARGET_WIDTH = 400;
const DEFAULT_MARGIN = 2; // quiet zone, in modules — matches the Node build

export function renderQrPixels(text, { targetWidth = DEFAULT_TARGET_WIDTH, margin = DEFAULT_MARGIN } = {}) {
  const qr = QRCodeCore.create(text, {});
  const size = qr.modules.size;
  const data = qr.modules.data;

  const totalModules = size + margin * 2;
  const scale = Math.max(1, Math.floor(targetWidth / totalModules));
  const width = totalModules * scale;

  const pixels = new Uint8Array(width * width).fill(0xff); // white background
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!data[row * size + col]) continue;
      const x0 = (col + margin) * scale;
      const y0 = (row + margin) * scale;
      for (let dy = 0; dy < scale; dy++) {
        pixels.fill(0x00, (y0 + dy) * width + x0, (y0 + dy) * width + x0 + scale);
      }
    }
  }
  return { pixels, width };
}

export async function generateManifestQrPng(url, options) {
  const { pixels, width } = renderQrPixels(url, options);
  return encodeGreyscalePng(pixels, width, width);
}
