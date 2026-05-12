/**
 * 1-bit dithered bitmap encoder/decoder for chat-sized image payloads.
 *
 * Wire format (after the typed-payload `\x01I|` prefix is stripped):
 *
 *   byte 0      width  (0–255 pixels)
 *   byte 1      height (0–255 pixels)
 *   bytes 2..N  packed 1-bit pixel data, row-major, MSB-first.
 *               Each row pads up to the next byte boundary.
 *
 * Wire size: 2 + ceil(W/8) × H bytes raw. Examples:
 *   32 × 32  →  130 B  ≈  175 B base64 → 1 chunk
 *   64 × 64  →  514 B  ≈  685 B base64 → 4 chunks
 *   96 × 64  →  770 B  ≈ 1030 B base64 → 6 chunks
 *
 * Compression rarely helps — random 1-bit dither output is near-incompressible —
 * so `maybeCompress` will skip and we ship the raw payload.
 */

export interface DitheredImage {
  width: number;
  height: number;
  /** Encoded byte array ready for `sendPayload({ type: 'image', bytes })`. */
  bytes: Uint8Array;
}

export interface DitherOpts {
  /** Maximum width of the output. Aspect ratio is preserved. */
  maxWidth?: number;
  /** Maximum height of the output. */
  maxHeight?: number;
}

const DEFAULT_MAX_W = 96;
const DEFAULT_MAX_H = 64;

/**
 * Take a File / Blob (or anything createImageBitmap accepts) and produce a
 * 1-bit dithered bitmap fit for chunked transmission.
 */
export async function ditherImage(input: ImageBitmapSource, opts: DitherOpts = {}): Promise<DitheredImage> {
  const maxW = Math.min(255, opts.maxWidth ?? DEFAULT_MAX_W);
  const maxH = Math.min(255, opts.maxHeight ?? DEFAULT_MAX_H);

  const bitmap = await createImageBitmap(input);
  // Preserve aspect ratio while fitting within (maxW, maxH).
  const srcAspect = bitmap.width / bitmap.height;
  let w: number, h: number;
  if (srcAspect > maxW / maxH) {
    w = maxW;
    h = Math.max(1, Math.round(maxW / srcAspect));
  } else {
    h = maxH;
    w = Math.max(1, Math.round(maxH * srcAspect));
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get 2D canvas context');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, w, h);
  // Luminance buffer; Floyd–Steinberg errors are diffused in here.
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const r = imageData.data[i * 4];
    const g = imageData.data[i * 4 + 1];
    const b = imageData.data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Floyd–Steinberg dither.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const old = gray[i];
      const next = old < 128 ? 0 : 255;
      gray[i] = next;
      const err = old - next;
      if (x + 1 < w)        gray[i + 1]      += (err * 7) / 16;
      if (y + 1 < h) {
        if (x > 0)          gray[i + w - 1]  += (err * 3) / 16;
                            gray[i + w]      += (err * 5) / 16;
        if (x + 1 < w)      gray[i + w + 1]  += (err * 1) / 16;
      }
    }
  }

  // Pack 1 bit per pixel, MSB-first within each byte. White = bit set.
  const stride = Math.ceil(w / 8);
  const out = new Uint8Array(2 + stride * h);
  out[0] = w;
  out[1] = h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (gray[y * w + x] > 128) {
        out[2 + y * stride + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { width: w, height: h, bytes: out };
}

export interface DecodedImage {
  width: number;
  height: number;
  /** Row-major boolean array. true = white, false = black. */
  pixels: boolean[];
}

export function decodeOneBitImage(bytes: Uint8Array): DecodedImage | null {
  if (bytes.length < 2) return null;
  const width = bytes[0];
  const height = bytes[1];
  if (width === 0 || height === 0) return null;
  const stride = Math.ceil(width / 8);
  if (bytes.length < 2 + stride * height) return null;
  const pixels: boolean[] = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byte = bytes[2 + y * stride + (x >> 3)];
      pixels[y * width + x] = (byte & (0x80 >> (x & 7))) !== 0;
    }
  }
  return { width, height, pixels };
}

/** Render a decoded 1-bit image into a canvas at the given pixel scale. */
export function renderOneBitImage(canvas: HTMLCanvasElement, img: DecodedImage, scale = 4): void {
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // Keep the pixelated look — disable smoothing.
  ctx.imageSmoothingEnabled = false;
  // Black background.
  ctx.fillStyle = '#0e1014';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // White-pixel pass.
  ctx.fillStyle = '#e6e8ee';
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.pixels[y * img.width + x]) {
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }
}
