// Derives the Studio icon variants nobody draws by hand from the ones somebody did.
//
//   node project/build/prepare-studio-icons.js
//
// Studio offers three icons (src/shared/constants/windowIcon.ts), and each needs two shapes: a
// Windows tile (`.ico`, a rounded square that fills its frame) and an Apple-grid one (a PNG with the
// body inset to 824 of 1024, for the macOS Dock and for Linux). Four of the six are drawn:
//
//   narra.icns / narra.ico   the default icon, drawn once per platform
//   leaf-white.png           the leaf on a white superellipse, Apple grid
//   leaf.ico                 the bare leaf, Windows
//
// and this script makes the rest, so a redrawn master can be followed by a re-run rather than by a
// second round of drawing:
//
//   narra.png                the .icns's own 1024 frame, lifted out for `app.dock.setIcon`,
//                            which takes a bitmap and not an icon family
//   leaf-white.ico           the leaf on a white tile cut to narra.ico's outline, frame for frame
//   leaf.png                 the bare leaf placed on the Apple grid
//
// The results are committed, like the installer bitmaps (prepare-installer-bitmaps.js), because
// electron-builder and the running app both resolve them by path, and a missing icon is skipped with
// a log line rather than a failure.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const rootDir = path.resolve(__dirname, "..", "..");
const iconDir = path.join(rootDir, "resources", "studio-icon");
/** The leaf itself: 1024px, transparent, full-bleed. Also the default game icon (BaseApp). */
const leafArt = path.join(rootDir, "resources", "app-icon.png");

/** The brand teal, which is also the leaf's colour on the white macOS tile this one matches. */
const LEAF_ON_WHITE = [0x40, 0xa8, 0xc4];
const WHITE = [0xff, 0xff, 0xff];

/** The leaf's stroke in `app-icon.png`, measured across it: 48px against a 866px-wide mark. */
const LEAF_ART_STROKE = 48;

/**
 * How large the leaf sits on its tile, and how much heavier its stroke is drawn, per frame size.
 *
 * Measured off the macOS white icon (leaf-white.png's .icns), which already solved this: the leaf
 * is a thin outline, so a straight downscale fades to a smudge below 32px. The small frames give it
 * more of the tile and thicken the stroke, by the amounts that icon uses at the same sizes.
 */
const WHITE_TILE_RECIPE = {
    16: { leaf: 0.667, stroke: 1.9 },
    24: { leaf: 0.64, stroke: 1.6 },
    32: { leaf: 0.615, stroke: 1.4 },
    48: { leaf: 0.6, stroke: 1.15 },
    64: { leaf: 0.6, stroke: 1 },
    128: { leaf: 0.587, stroke: 1 },
    256: { leaf: 0.587, stroke: 1 },
};

/**
 * The macOS icon sets the leaf a little below the tile's centre, by this much of its own width:
 * the stem hangs lower than the blade reaches up, so a centred bounding box looks high.
 */
const LEAF_OPTICAL_DROP = 0.026;

/** Apple's grid: the body is 824px of a 1024px canvas, inset 100px on every side. */
const APPLE_CANVAS = 1024;
const APPLE_BODY = 824;

// ---------------------------------------------------------------------------------------------
// PNG

/**
 * Decode an 8-bit RGBA, non-interlaced PNG into `{ width, height, pixels }`.
 *
 * Only the one shape every input here has. Anything else is refused rather than guessed at, for
 * the reason prepare-installer-bitmaps.js gives: a lenient decoder produces a plausible icon.
 */
function decodePng(buffer) {
    if (buffer.readUInt32BE(0) !== 0x89504e47) {
        throw new Error("Not a PNG file");
    }

    let header = null;
    const idat = [];
    let offset = 8;
    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString("ascii", offset + 4, offset + 8);
        const body = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === "IHDR") {
            header = {
                width: body.readUInt32BE(0),
                height: body.readUInt32BE(4),
                depth: body[8],
                colorType: body[9],
                interlace: body[12],
            };
        } else if (type === "IDAT") {
            idat.push(body);
        } else if (type === "IEND") {
            break;
        }
        offset += 12 + length;
    }

    if (!header) {
        throw new Error("PNG has no IHDR");
    }
    if (header.depth !== 8 || header.colorType !== 6 || header.interlace !== 0) {
        throw new Error(
            `Unsupported PNG (depth ${header.depth}, color type ${header.colorType}, interlace ${header.interlace}); `
            + "this script reads 8-bit RGBA only",
        );
    }

    const { width, height } = header;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * 4;
    const pixels = Buffer.alloc(stride * height);

    for (let y = 0; y < height; y += 1) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const out = pixels.subarray(y * stride, (y + 1) * stride);
        const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;

        for (let x = 0; x < stride; x += 1) {
            const left = x >= 4 ? out[x - 4] : 0;
            const up = prior ? prior[x] : 0;
            const upLeft = prior && x >= 4 ? prior[x - 4] : 0;
            let value;
            switch (filter) {
                case 0: value = line[x]; break;
                case 1: value = line[x] + left; break;
                case 2: value = line[x] + up; break;
                case 3: value = line[x] + ((left + up) >> 1); break;
                case 4: value = line[x] + paeth(left, up, upLeft); break;
                default: throw new Error(`Unknown PNG filter ${filter} on row ${y}`);
            }
            out[x] = value & 0xff;
        }
    }

    return { width, height, pixels };
}

function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) {
        return a;
    }
    return pb <= pc ? b : c;
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
        crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, body) {
    const chunk = Buffer.alloc(12 + body.length);
    chunk.writeUInt32BE(body.length, 0);
    chunk.write(type, 4, "ascii");
    body.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + body.length)), 8 + body.length);
    return chunk;
}

/**
 * Encode `{ width, height, pixels }` as an 8-bit RGBA PNG.
 *
 * Every row is Paeth-filtered rather than filtered by whichever heuristic an encoder prefers, so the
 * same pixels always come out as the same bytes - these files are committed, and a re-run that
 * changed nothing should leave nothing to commit.
 */
function encodePng({ width, height, pixels }) {
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y += 1) {
        const row = pixels.subarray(y * stride, (y + 1) * stride);
        const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
        const out = raw.subarray(y * (stride + 1), (y + 1) * (stride + 1));
        out[0] = 4;
        for (let x = 0; x < stride; x += 1) {
            const left = x >= 4 ? row[x - 4] : 0;
            const up = prior ? prior[x] : 0;
            const upLeft = prior && x >= 4 ? prior[x - 4] : 0;
            out[x + 1] = (row[x] - paeth(left, up, upLeft)) & 0xff;
        }
    }

    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}

// ---------------------------------------------------------------------------------------------
// Icon containers

/** The frames of an `.ico` whose images are all PNG-compressed, keyed by their pixel size. */
function readIco(buffer) {
    if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
        throw new Error("Not an .ico file");
    }
    const frames = new Map();
    const count = buffer.readUInt16LE(4);
    for (let i = 0; i < count; i += 1) {
        const entry = 6 + i * 16;
        const size = buffer[entry] || 256;
        const length = buffer.readUInt32LE(entry + 8);
        const offset = buffer.readUInt32LE(entry + 12);
        const data = buffer.subarray(offset, offset + length);
        if (data.readUInt32BE(0) !== 0x89504e47) {
            throw new Error(`The ${size}px frame is a bitmap; this script reads PNG frames only`);
        }
        frames.set(size, data);
    }
    return frames;
}

/** An `.ico` holding one PNG frame per entry of `frames` (size -> PNG buffer), smallest first. */
function writeIco(frames) {
    const sizes = [...frames.keys()].sort((a, b) => a - b);
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);

    let offset = header.length;
    sizes.forEach((size, i) => {
        const entry = 6 + i * 16;
        const data = frames.get(size);
        // 256 does not fit in a byte; the format spells it 0.
        header[entry] = size >= 256 ? 0 : size;
        header[entry + 1] = size >= 256 ? 0 : size;
        header.writeUInt16LE(1, entry + 4);
        header.writeUInt16LE(32, entry + 6);
        header.writeUInt32LE(data.length, entry + 8);
        header.writeUInt32LE(offset, entry + 12);
        offset += data.length;
    });

    return Buffer.concat([header, ...sizes.map(size => frames.get(size))]);
}

/** One element of an `.icns` family, by its four-letter type. */
function readIcnsElement(buffer, wanted) {
    if (buffer.toString("ascii", 0, 4) !== "icns") {
        throw new Error("Not an .icns file");
    }
    let offset = 8;
    while (offset < buffer.length) {
        const type = buffer.toString("ascii", offset, offset + 4);
        const length = buffer.readUInt32BE(offset + 4);
        if (type === wanted) {
            return buffer.subarray(offset + 8, offset + length);
        }
        offset += length;
    }
    throw new Error(`The .icns has no ${wanted} element`);
}

// ---------------------------------------------------------------------------------------------
// Pixels

/** One channel of an RGBA image as floats in 0..1, premultiplied by alpha unless it is alpha. */
function plane(image, channel) {
    const out = new Float32Array(image.width * image.height);
    for (let i = 0; i < out.length; i += 1) {
        const alpha = image.pixels[i * 4 + 3] / 255;
        out[i] = channel === 3 ? alpha : (image.pixels[i * 4 + channel] / 255) * alpha;
    }
    return out;
}

/**
 * Area-average one axis of `source` onto `length` destination cells, where destination cell `d`
 * covers source span `[origin + d / scale, origin + (d + 1) / scale)`.
 *
 * Exact coverage weights rather than nearest samples, so a reduction of any ratio - 1024 down to
 * 16, or down to 824 - keeps every source pixel's contribution. Beyond the source is transparent.
 */
function resampleAxis(source, lines, sourceLength, length, origin, scale, horizontal) {
    const out = new Float32Array(lines * length);
    const span = 1 / scale;
    for (let d = 0; d < length; d += 1) {
        const start = origin + d * span;
        const end = start + span;
        const first = Math.max(0, Math.floor(start));
        const last = Math.min(sourceLength, Math.ceil(end));
        for (let s = first; s < last; s += 1) {
            const weight = (Math.min(end, s + 1) - Math.max(start, s)) * scale;
            if (weight <= 0) {
                continue;
            }
            for (let line = 0; line < lines; line += 1) {
                const from = horizontal ? line * sourceLength + s : s * lines + line;
                const to = horizontal ? line * length + d : d * lines + line;
                out[to] += source[from] * weight;
            }
        }
    }
    return out;
}

/** Resample a `size`-square plane onto a `target`-square one; see `resampleAxis` for the mapping. */
function resample(source, size, target, originX, originY, scale) {
    const rows = resampleAxis(source, size, size, target, originX, scale, true);
    return resampleAxis(rows, target, size, target, originY, scale, false);
}

/**
 * Grow the mark by `radius` pixels in every direction (a disc-shaped maximum filter).
 *
 * This is what "a heavier stroke" means for a mark that exists only as pixels: the outline keeps
 * its path and gains width on both sides, and round caps stay round.
 */
function dilate(source, size, radius) {
    if (radius <= 0) {
        return source;
    }
    const reach = Math.ceil(radius);
    const offsets = [];
    for (let dy = -reach; dy <= reach; dy += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
            if (dx * dx + dy * dy <= radius * radius) {
                offsets.push(dy * size + dx, dx, dy);
            }
        }
    }
    const out = new Float32Array(source.length);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            let max = 0;
            for (let o = 0; o < offsets.length; o += 3) {
                const sx = x + offsets[o + 1];
                const sy = y + offsets[o + 2];
                if (sx >= 0 && sx < size && sy >= 0 && sy < size) {
                    const value = source[y * size + x + offsets[o]];
                    if (value > max) {
                        max = value;
                    }
                }
            }
            out[y * size + x] = max;
        }
    }
    return out;
}

/** The opaque extent of an alpha plane as `{ x0, y0, x1, y1 }`, ends exclusive. */
function extent(alpha, size) {
    let x0 = size, y0 = size, x1 = 0, y1 = 0;
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            if (alpha[y * size + x] >= 0.5) {
                x0 = Math.min(x0, x);
                y0 = Math.min(y0, y);
                x1 = Math.max(x1, x + 1);
                y1 = Math.max(y1, y + 1);
            }
        }
    }
    return { x0, y0, x1, y1 };
}

function toByte(value) {
    return Math.max(0, Math.min(255, Math.round(value * 255)));
}

// ---------------------------------------------------------------------------------------------
// The variants

/**
 * One frame of the white-tiled leaf, on the tile narra.ico uses at the same size.
 *
 * The tile is lifted from the default icon's own frame (its alpha is the tile's outline) rather than
 * redrawn from a radius, so the icons stay the same shape in the taskbar at every size the designer
 * drew - including the small ones, where that outline was adjusted by hand.
 */
function whiteTileFrame(size, tileFrame, leafAlpha, leafSize, leafBox) {
    const recipe = WHITE_TILE_RECIPE[size];
    if (!recipe) {
        throw new Error(`No white-tile recipe for ${size}px; add one to WHITE_TILE_RECIPE`);
    }
    const tile = decodePng(tileFrame);
    if (tile.width !== size || tile.height !== size) {
        throw new Error(`narra.ico's ${size}px frame is ${tile.width}x${tile.height}`);
    }
    const tileAlpha = plane(tile, 3);
    const tileBox = extent(tileAlpha, size);

    // Output pixels per leaf-art pixel, and a supersampling factor that keeps the working canvas at
    // or below the art's own resolution, so the art is only ever reduced.
    const leafWidth = recipe.leaf * (tileBox.x1 - tileBox.x0);
    const scale = leafWidth / (leafBox.x1 - leafBox.x0);
    const supersample = Math.max(1, Math.min(64, Math.floor(1 / scale)));
    const canvas = size * supersample;
    const workScale = scale * supersample;

    const centreX = ((tileBox.x0 + tileBox.x1) / 2) * supersample;
    const centreY = ((tileBox.y0 + tileBox.y1) / 2 + LEAF_OPTICAL_DROP * leafWidth) * supersample;
    const artCentreX = (leafBox.x0 + leafBox.x1) / 2;
    const artCentreY = (leafBox.y0 + leafBox.y1) / 2;
    let work = resample(
        leafAlpha,
        leafSize,
        canvas,
        artCentreX - centreX / workScale,
        artCentreY - centreY / workScale,
        workScale,
    );
    work = dilate(work, canvas, ((recipe.stroke - 1) * LEAF_ART_STROKE * workScale) / 2);
    const leaf = resample(work, canvas, size, 0, 0, 1 / supersample);

    const pixels = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i += 1) {
        const coverage = Math.min(1, leaf[i]);
        for (let channel = 0; channel < 3; channel += 1) {
            pixels[i * 4 + channel] = Math.round(WHITE[channel] + (LEAF_ON_WHITE[channel] - WHITE[channel]) * coverage);
        }
        pixels[i * 4 + 3] = toByte(tileAlpha[i]);
    }
    return encodePng({ width: size, height: size, pixels });
}

/** The bare leaf on Apple's grid: the full-bleed art scaled into the 824px body, colours kept. */
function appleGridLeaf(art) {
    const scale = APPLE_BODY / art.width;
    const inset = (APPLE_CANVAS - APPLE_BODY) / 2;
    const channels = [0, 1, 2, 3].map(channel =>
        resample(plane(art, channel), art.width, APPLE_CANVAS, -inset / scale, -inset / scale, scale));
    const pixels = Buffer.alloc(APPLE_CANVAS * APPLE_CANVAS * 4);
    for (let i = 0; i < APPLE_CANVAS * APPLE_CANVAS; i += 1) {
        const alpha = Math.min(1, channels[3][i]);
        for (let channel = 0; channel < 3; channel += 1) {
            // Un-premultiply; the art is one flat colour, so its edge keeps that colour.
            pixels[i * 4 + channel] = alpha > 0 ? toByte(channels[channel][i] / channels[3][i]) : 0;
        }
        pixels[i * 4 + 3] = toByte(alpha);
    }
    return encodePng({ width: APPLE_CANVAS, height: APPLE_CANVAS, pixels });
}

function write(name, data) {
    fs.writeFileSync(path.join(iconDir, name), data);
    console.log(`Wrote ${name} (${data.length} bytes)`);
}

function main() {
    const narraIcns = fs.readFileSync(path.join(iconDir, "narra.icns"));
    const narraIco = readIco(fs.readFileSync(path.join(iconDir, "narra.ico")));
    const art = decodePng(fs.readFileSync(leafArt));
    if (art.width !== art.height) {
        throw new Error(`app-icon.png is ${art.width}x${art.height}; expected a square`);
    }

    // ic10 is the 512@2x element, i.e. the 1024px frame.
    const narraDock = readIcnsElement(narraIcns, "ic10");
    if (narraDock.readUInt32BE(0) !== 0x89504e47) {
        throw new Error("narra.icns stores its 1024px frame in a format other than PNG");
    }
    write("narra.png", narraDock);

    const leafAlpha = plane(art, 3);
    const leafBox = extent(leafAlpha, art.width);
    const frames = new Map();
    for (const [size, frame] of narraIco) {
        frames.set(size, whiteTileFrame(size, frame, leafAlpha, art.width, leafBox));
    }
    write("leaf-white.ico", writeIco(frames));

    write("leaf.png", appleGridLeaf(art));
}

main();
