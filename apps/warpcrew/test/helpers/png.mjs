import assert from 'node:assert/strict';
import zlib from 'node:zlib';

// Minimal PNG decoder: non-interlaced 8-bit grayscale / gray+alpha / RGB / RGBA, and 1/2/4/8-bit palette.
export function decodePng(buf) {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'not a PNG');
  let off = 8;
  let ihdr = null;
  let plte = null;
  let trns = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const depth = ihdr[8];
  const colorType = ihdr[9];
  assert.ok(depth === 8 || (colorType === 3 && [1, 2, 4].includes(depth)), `unsupported PNG bit depth ${depth}`);
  assert.equal(ihdr[12], 0, 'interlaced PNGs are not supported by this test');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  assert.ok(channels, `unsupported PNG color type ${colorType}`);
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((width * channels * depth) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, (stride + 1) * height, 'unexpected decoded PNG size');
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i += 1) {
      const x = raw[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = y > 0 ? out[dst - stride + i] : 0;
      const c = y > 0 && i >= bpp ? out[dst - stride + i - bpp] : 0;
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`bad PNG filter ${filter}`);
      out[dst + i] = v & 255;
    }
  }
  // Normalise to RGBA.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const s = i * channels;
    let r;
    let g;
    let b;
    let a = 255;
    if (colorType === 6) [r, g, b, a] = [out[s], out[s + 1], out[s + 2], out[s + 3]];
    else if (colorType === 2) [r, g, b] = [out[s], out[s + 1], out[s + 2]];
    else if (colorType === 0) r = g = b = out[s];
    else if (colorType === 4) { r = g = b = out[s]; a = out[s + 1]; }
    else {
      const idx = depth === 8 ? out[s] : (out[Math.floor(i / width) * stride + ((i % width) * depth >> 3)] >> (8 - depth - ((i % width) * depth & 7))) & ((1 << depth) - 1);
      [r, g, b] = [plte[idx * 3], plte[idx * 3 + 1], plte[idx * 3 + 2]];
      a = trns && idx < trns.length ? trns[idx] : 255;
    }
    rgba.set([r, g, b, a], i * 4);
  }
  return { width, height, rgba };
}
