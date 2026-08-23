// Generál egyszerű PWA ikonokat (teal háttér + fehér "A") külső függőség nélkül.
// Raw PNG (RGBA) kódolás Node zlib-bel.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
mkdirSync(OUT, { recursive: true })

// 7x7 "A" bitmap
const A = [
  '0011100',
  '0100010',
  '1000001',
  '1000001',
  '1111111',
  '1000001',
  '1000001',
]
const BG = [15, 118, 110, 255] // #0f766e
const FG = [255, 255, 255, 255]

function makePng(size) {
  const buf = Buffer.alloc(size * size * 4)
  const glyph = Math.floor(size * 0.6)
  const cell = glyph / 7
  const offX = (size - glyph) / 2
  const offY = (size - glyph) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = BG
      const gx = Math.floor((x - offX) / cell)
      const gy = Math.floor((y - offY) / cell)
      if (gx >= 0 && gx < 7 && gy >= 0 && gy < 7 && A[gy][gx] === '1') c = FG
      const i = (y * size + x) * 4
      buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3]
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
