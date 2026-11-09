// Generál egyszerű PWA ikonokat (teal háttér + fehér "U" — Utód) külső függőség nélkül.
// Raw PNG (RGBA) kódolás Node zlib-bel; a betű élsimított (4×4 mintavétel pixelenként).
// Ugyanaz a forma, mint a public/favicon.svg-ben.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
mkdirSync(OUT, { recursive: true })

const BG = [15, 118, 110] // #0f766e
const FG = [255, 255, 255]

// "U" az 512-es koordinátarendszerben: külső sáv 128..384 (sugár 128), belső 200..312 (sugár 56),
// a felső szél 96-nál, az ív közepe (256, 288) — az alja 416-ig ér
function inU(x, y) {
  const cx = 256; const cy = 288
  const inside = (half, r) => {
    if (y < 96) return false
    if (y <= cy) return Math.abs(x - cx) <= half
    const dx = x - cx; const dy = y - cy
    return dx * dx + dy * dy <= r * r
  }
  return inside(128, 128) && !inside(56, 56)
}

function makePng(size) {
  const buf = Buffer.alloc(size * size * 4)
  const SS = 4; const k = 512 / size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hit = 0
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        if (inU((x + (sx + 0.5) / SS) * k, (y + (sy + 0.5) / SS) * k)) hit++
      }
      const a = hit / (SS * SS)
      const i = (y * size + x) * 4
      for (let c = 0; c < 3; c++) buf[i + c] = Math.round(BG[c] * (1 - a) + FG[c] * a)
      buf[i + 3] = 255
    }
  }
  // add filter byte (0) per scanline
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    buf.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw)

  const crcTable = (() => {
    const t = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })()
  const crc32 = (b) => {
    let c = 0xffffffff
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
    const t = Buffer.from(type, 'ascii')
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
    return Buffer.concat([len, t, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

for (const [name, size] of [['pwa-192.png', 192], ['pwa-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(join(OUT, name), makePng(size))
  console.log('generated', name)
}
