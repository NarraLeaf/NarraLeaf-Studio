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
//   narra.ico                the drawing, re-laid in the frame structure below; a size the drawing
//                            lacks is area-averaged down from its 256 frame, and a size the table
//                            does not carry is dropped
//   leaf-white.ico           the leaf on a white tile cut to narra.ico's outline, frame for frame
//   leaf.png                 the bare leaf placed on the Apple grid
//
// Every `.ico` Studio writes has one frame structure, and one writer: the encoder the game build uses
// (src/main/app/application/managers/build/iconContainers.ts), loaded from its TypeScript below
// rather than copied. Its `ICO_SIZES` are the frames - 16, 24, 32, 48, 64, 72, 96, 128 and 256 - and
// it stores those up to 128 as 32-bit bitmaps and the 256 as a PNG. leaf.ico already has that shape
// and is not touched. The PNGs go through the shared codec (src/shared/utils/pngOpaque.ts) for the
// same reason.
//
// The results are committed, like the installer bitmaps (prepare-installer-bitmaps.js), because
// electron-builder and the running app both resolve them by path, and a missing icon is skipped with
// a log line rather than a failure. A re-run that changed nothing writes the same bytes: narra.ico
// is read back in either frame format, its 256 PNG is passed through as it is, and every PNG is
// written with the same fixed filter.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const esbuild = require("esbuild");

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
 * more of the tile and thicken the stroke, by the amounts that icon uses at the same sizes. 72 and
 * 96 have no counterpart there and sit on the line between 64 and 128, where the stroke no longer
 * needs help.
 */
const WHITE_TILE_RECIPE = {
    16: { leaf: 0.667, stroke: 1.9 },
    24: { leaf: 0.64, stroke: 1.6 },
    32: { leaf: 0.615, stroke: 1.4 },
    48: { leaf: 0.6, stroke: 1.15 },
    64: { leaf: 0.6, stroke: 1 },
    72: { leaf: 0.598, stroke: 1 },
    96: { leaf: 0.594, stroke: 1 },
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
// Studio's own codecs

/**
 * The `.ico` encoder and the PNG codec Studio ships, bundled from their TypeScript for this run.
 *
 * Both are pure functions over bytes with no imports of their own, so a bundle of the two is all it
 * takes - and a second copy here would be free to disagree with the one that writes games' icons.
 */
function loadStudioCodecs() {
    const result = esbuild.buildSync({
        stdin: {
            contents: [
                'export { ICO_SIZES, encodeIco } from "./src/main/app/application/managers/build/iconContainers";',
                'export { decodePngToRgba, encodeRgbaPng } from "./src/shared/utils/pngOpaque";',
            ].join("\n"),
            resolveDir: rootDir,
            sourcefile: "prepare-studio-icons.entry.ts",
            loader: "ts",
        },
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "node20",
        write: false,
        logLevel: "silent",
    });
    const module = { exports: {} };
    new Function("module", "exports", "require", result.outputFiles[0].text)(module, module.exports, require);
    return module.exports;
}

const { ICO_SIZES, encodeIco, decodePngToRgba, encodeRgbaPng } = loadStudioCodecs();

/** A PNG as `{ width, height, pixels }`, straight RGBA from the top row down. */
function decodePng(buffer) {
    const { width, height, rgba } = decodePngToRgba(buffer, data => zlib.inflateSync(data));
    return { width, height, pixels: rgba };
}

async function encodePng({ width, height, pixels }) {
    return Buffer.from(await encodeRgbaPng(pixels, width, height, data => zlib.deflateSync(data, { level: 9 })));
}

// ---------------------------------------------------------------------------------------------
// Icon containers

/**
 * The frames of an `.ico`, keyed by pixel size, as `{ image, png }`: `png` is the entry's own bytes
 * when it is stored as a PNG, so it can be written back untouched, and null for a bitmap.
 */
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
        if (data.readUInt32BE(0) === 0x89504e47) {
            const image = decodePng(data);
            if (image.width !== size || image.height !== size) {
                throw new Error(`The ${size}px frame holds a ${image.width}x${image.height} PNG`);
            }
            frames.set(size, { image, png: Buffer.from(data) });
        } else {
            frames.set(size, { image: decodeIcoBitmap(data, size), png: null });
        }
    }
    return frames;
}

/**
 * A 32-bit bitmap entry as RGBA. The colour rows are stored bottom-up in BGRA; the AND mask after
 * them is ignored, since with an alpha channel present it carries nothing. Any other kind of bitmap
 * is refused rather than guessed at - these are files the encoder wrote, or a drawing in its shape.
 */
function decodeIcoBitmap(data, size) {
    const headerSize = data.readUInt32LE(0);
    const width = data.readInt32LE(4);
    const height = data.readInt32LE(8);
    const bitCount = data.readUInt16LE(14);
    const compression = data.readUInt32LE(16);
    if (headerSize !== 40 || width !== size || height !== size * 2 || bitCount !== 32 || compression !== 0) {
        throw new Error(
            `The ${size}px frame is a ${width}x${height} ${bitCount}-bit bitmap (compression ${compression}); `
            + "this script reads uncompressed 32-bit ones only",
        );
    }
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        const source = headerSize + (size - 1 - y) * size * 4;
        for (let x = 0; x < size; x += 1) {
            const from = source + x * 4;
            const to = (y * size + x) * 4;
            pixels[to] = data[from + 2];
            pixels[to + 1] = data[from + 1];
            pixels[to + 2] = data[from];
            pixels[to + 3] = data[from + 3];
        }
    }
    return { width: size, height: size, pixels };
}

/** One frame as `encodeIco` takes it; `png` is the entry's existing bytes, when it has some to keep. */
async function icoImage(image, png = null) {
    return { size: image.width, rgba: image.pixels, png: png ?? await encodePng(image) };
}

/** An `.ico` holding one frame per `ICO_SIZES` entry, from `frames` (size -> `{ image, png }`). */
async function writeIco(frames) {
    const images = [];
    for (const size of ICO_SIZES) {
        const frame = frames.get(size);
        images.push(await icoImage(frame.image, frame.png));
    }
    return encodeIco(images);
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

/** Four premultiplied planes of a `size` square back into a straight RGBA image. */
function fromPlanes(channels, size) {
    const pixels = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i += 1) {
        const alpha = Math.min(1, channels[3][i]);
        for (let channel = 0; channel < 3; channel += 1) {
            pixels[i * 4 + channel] = alpha > 0 ? toByte(channels[channel][i] / channels[3][i]) : 0;
        }
        pixels[i * 4 + 3] = toByte(alpha);
    }
    return { width: size, height: size, pixels };
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

/** A square image area-averaged down to a `size` square, edge to edge. */
function downscale(image, size) {
    const scale = size / image.width;
    return fromPlanes([0, 1, 2, 3].map(channel => resample(plane(image, channel), image.width, size, 0, 0, scale)), size);
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
 * narra.ico's frames at every size the table carries: the drawn ones as they are, and the ones the
 * drawing lacks area-averaged down from its largest.
 */
function narraTileFrames(drawn) {
    const largest = Math.max(...drawn.keys());
    if (largest < Math.max(...ICO_SIZES)) {
        throw new Error(`narra.ico's largest frame is ${largest}px; it needs a ${Math.max(...ICO_SIZES)}px one`);
    }
    const frames = new Map();
    for (const size of ICO_SIZES) {
        frames.set(size, drawn.get(size) ?? { image: downscale(drawn.get(largest).image, size), png: null });
    }
    return frames;
}

/**
 * One frame of the white-tiled leaf, on the tile narra.ico uses at the same size.
 *
 * The tile is lifted from the default icon's own frame (its alpha is the tile's outline) rather than
 * redrawn from a radius, so the icons stay the same shape in the taskbar at every size the designer
 * drew - including the small ones, where that outline was adjusted by hand.
 */
function whiteTileFrame(size, tile, leafAlpha, leafSize, leafBox) {
    const recipe = WHITE_TILE_RECIPE[size];
    if (!recipe) {
        throw new Error(`No white-tile recipe for ${size}px; add one to WHITE_TILE_RECIPE`);
    }
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

    const pixels = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i += 1) {
        const coverage = Math.min(1, leaf[i]);
        for (let channel = 0; channel < 3; channel += 1) {
            pixels[i * 4 + channel] = Math.round(WHITE[channel] + (LEAF_ON_WHITE[channel] - WHITE[channel]) * coverage);
        }
        pixels[i * 4 + 3] = toByte(tileAlpha[i]);
    }
    return { width: size, height: size, pixels };
}

/** The bare leaf on Apple's grid: the full-bleed art scaled into the 824px body, colours kept. */
function appleGridLeaf(art) {
    const scale = APPLE_BODY / art.width;
    const inset = (APPLE_CANVAS - APPLE_BODY) / 2;
    // The art is one flat colour, so un-premultiplying keeps its edge that colour.
    return fromPlanes(
        [0, 1, 2, 3].map(channel =>
            resample(plane(art, channel), art.width, APPLE_CANVAS, -inset / scale, -inset / scale, scale)),
        APPLE_CANVAS,
    );
}

function write(name, data) {
    fs.writeFileSync(path.join(iconDir, name), data);
    console.log(`Wrote ${name} (${data.length} bytes)`);
}

async function main() {
    const narraIcns = fs.readFileSync(path.join(iconDir, "narra.icns"));
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

    const narraFrames = narraTileFrames(readIco(fs.readFileSync(path.join(iconDir, "narra.ico"))));
    write("narra.ico", await writeIco(narraFrames));

    const leafAlpha = plane(art, 3);
    const leafBox = extent(leafAlpha, art.width);
    const whiteFrames = new Map();
    for (const size of ICO_SIZES) {
        whiteFrames.set(size, {
            image: whiteTileFrame(size, narraFrames.get(size).image, leafAlpha, art.width, leafBox),
            png: null,
        });
    }
    write("leaf-white.ico", await writeIco(whiteFrames));

    write("leaf.png", await encodePng(appleGridLeaf(art)));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
