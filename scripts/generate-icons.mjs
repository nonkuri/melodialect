import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function insideRoundedRect(x, y, size, inset, radius) {
  const left = inset;
  const right = size - inset - 1;
  const top = inset;
  const bottom = size - inset - 1;
  if (x >= left + radius && x <= right - radius && y >= top && y <= bottom) return true;
  if (y >= top + radius && y <= bottom - radius && x >= left && x <= right) return true;
  const cx = x < left + radius ? left + radius : right - radius;
  const cy = y < top + radius ? top + radius : bottom - radius;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function makeIcon(size, maskable) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const inset = maskable ? Math.round(size * 0.1) : 0;
  const radius = Math.round(size * 0.22);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const offset = row + 1 + x * 4;
      const inside = insideRoundedRect(x, y, size, inset, radius);
      const t = (x + y) / (size * 2);
      let color = inside
        ? [Math.round(37 - 18 * t), Math.round(61 - 35 * t), Math.round(115 - 72 * t), 255]
        : [17, 22, 33, maskable ? 255 : 0];
      const waveY = size * (0.51 + 0.075 * Math.sin((x / size) * Math.PI * 4));
      if (inside && Math.abs(y - waveY) < size * 0.028 && x > size * 0.16 && x < size * 0.86) {
        color = [126, Math.round(224 - x / size * 56), Math.round(209 + x / size * 46), 255];
      }
      for (const noteX of [0.35, 0.72]) {
        const stemX = size * noteX;
        const stemTop = size * (noteX < 0.5 ? 0.28 : 0.23);
        const stemBottom = size * (noteX < 0.5 ? 0.58 : 0.53);
        const headX = stemX - size * 0.045;
        const headY = stemBottom + size * 0.03;
        const onStem = distanceToSegment(x, y, stemX, stemTop, stemX, stemBottom) < size * 0.018;
        const onHead = ((x - headX) / (size * 0.07)) ** 2 + ((y - headY) / (size * 0.045)) ** 2 < 1;
        if (inside && (onStem || onHead)) color = [245, 247, 255, 255];
      }
      raw.set(color, offset);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const directory = resolve("public/icons");
await mkdir(directory, { recursive: true });
await Promise.all([
  writeFile(resolve(directory, "icon-192.png"), makeIcon(192, false)),
  writeFile(resolve(directory, "icon-512.png"), makeIcon(512, false)),
  writeFile(resolve(directory, "icon-maskable-512.png"), makeIcon(512, true)),
]);
