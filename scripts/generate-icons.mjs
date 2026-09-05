// Generates the PWA raster icons under public/icons/ without native dependencies.
// Run `npm run icons` after editing the palette below.
import { deflateSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function encodePng(size, pixels) {
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

const WOOD_LIGHT = [0xe8, 0xbd, 0x72]
const WOOD_DARK = [0xc0, 0x7c, 0x37]
const LINE = [0x5d, 0x3a, 0x17]

function renderIcon(size, boardFraction = 1) {
  const pixels = Buffer.alloc(size * size * 4)
  const scale = (size / 64) * boardFraction

  const put = (x, y, [r, g, b], alpha = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const offset = (y * size + x) * 4
    pixels[offset] = r
    pixels[offset + 1] = g
    pixels[offset + 2] = b
    pixels[offset + 3] = alpha
  }

  const fillCircle = (cx, cy, radius, colorAt) => {
    const max = Math.ceil(radius) + 1
    for (let dy = -max; dy <= max; dy += 1) {
      for (let dx = -max; dx <= max; dx += 1) {
        const distance = Math.hypot(dx, dy)
        if (distance > radius) continue
        const edge = distance > radius - 1.5 ? (radius - distance) / 1.5 : 1
        const [r, g, b] = colorAt(dx / radius, dy / radius)
        const previous = [
          pixels[((cy + dy) * size + (cx + dx)) * 4] ?? 0,
          pixels[((cy + dy) * size + (cx + dx)) * 4 + 1] ?? 0,
          pixels[((cy + dy) * size + (cx + dx)) * 4 + 2] ?? 0,
        ]
        put(cx + dx, cy + dy, mix(previous, [r, g, b], Math.min(1, edge)), 255)
      }
    }
  }

  // Splash backgrounds keep the app palette; plain icons fill the canvas.
  const margin = Math.round((size * (1 - boardFraction)) / 2)
  if (boardFraction < 1) {
    const felt = [0x10, 0x24, 0x1b]
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        put(x, y, felt)
      }
    }
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (boardFraction < 1) {
        // Skip the margin; the board occupies the centred square.
        if (
          x < margin || y < margin
          || x >= size - margin || y >= size - margin
        ) continue
      }
      const t = (x / size + y / size) / 2
      put(x, y, mix(WOOD_LIGHT, WOOD_DARK, t))
    }
  }

  const base = boardFraction < 1 ? margin : 0
  const span = size - 2 * base
  const gridScale = span / 64
  for (let index = 0; index < 5; index += 1) {
    const offset = base + (12 + index * 10) * gridScale
    const thickness = Math.max(1, Math.round(gridScale))
    const limit = base + span
    for (let p = base; p < limit; p += 1) {
      for (let t = 0; t < thickness; t += 1) {
        put(Math.round(offset) + t, p, LINE, 90)
        put(p, Math.round(offset) + t, LINE, 90)
      }
    }
  }

  const stone = (cx, cy, radius, dark) => {
    if (dark) {
      fillCircle(base + Math.round(cx * gridScale), base + Math.round(cy * gridScale), radius * gridScale, (nx, ny) => {
        const t = Math.min(1, Math.hypot(nx + 0.34, ny + 0.28) / 1.4)
        return mix([0x5d, 0x61, 0x69], [0x05, 0x06, 0x08], t)
      })
    } else {
      fillCircle(base + Math.round(cx * gridScale), base + Math.round(cy * gridScale), radius * gridScale, (nx, ny) => {
        const t = Math.min(1, Math.hypot(nx + 0.32, ny + 0.26) / 1.4)
        return mix([0xff, 0xff, 0xff], [0xc8, 0xc1, 0xb5], t)
      })
    }
  }

  stone(22, 22, 6.5, true)
  stone(32, 22, 6.5, false)
  stone(42, 22, 6.5, true)
  stone(32, 42, 6.5, false)

  return encodePng(size, pixels)
}

await mkdir(OUT_DIR, { recursive: true })
for (const size of [192, 512]) {
  await writeFile(join(OUT_DIR, `dufive-${size}.png`), renderIcon(size))
  console.log(`wrote icons/dufive-${size}.png`)
}

// Capacitor source assets for the Android build.
const ASSET_DIR = join(dirname(OUT_DIR), '..', 'assets')
await mkdir(ASSET_DIR, { recursive: true })
await writeFile(join(ASSET_DIR, 'icon-only.png'), renderIcon(1024))
console.log('wrote assets/icon-only.png')
await writeFile(join(ASSET_DIR, 'icon-foreground.png'), renderIcon(512, 0.62))
console.log('wrote assets/icon-foreground.png')
await writeFile(join(ASSET_DIR, 'icon-background.png'), renderIcon(512, 0))
console.log('wrote assets/icon-background.png')
await writeFile(join(ASSET_DIR, 'splash.png'), renderIcon(2732, 0.52))
await writeFile(join(ASSET_DIR, 'splash-dark.png'), renderIcon(2732, 0.52))
console.log('wrote assets/splash.png / splash-dark.png')
