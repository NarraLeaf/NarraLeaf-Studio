// Bakes the two bitmaps the Windows installer wears out of the same 1024px app icon master
// everything else is derived from.
//
// Run it when the icon changes; the results are committed (`project/installer/*.bmp`) rather than
// produced during packaging, for the reason the derived icons are: electron-builder resolves them
// by path while packing, and an asset that is missing at that moment is skipped with a log line
// rather than a failure.
//
//   node project/build/prepare-installer-bitmaps.js
//
// Why 2x and not 1x or 3x. MUI sizes the header and sidebar controls in dialog units, so with
// `ManifestDPIAware true` (see project/installer/installer.nsh) the control is physically larger
// on a scaled display, and NSIS's default `FitControl` stretch resizes whatever bitmap it is
// given to fit. A 1x bitmap would be upscaled and soft at 150%; a 3x one would be downscaled by
// NSIS's own stretch - a plain StretchBlt, not the box filter below - at 100%. 2x makes the
// common case an exact 2:1 reduction, which even a crude stretch handles, and 200% a 1:1 copy.
//
// BMP rather than PNG because MUI's header and welcome images are `SetBrandingImage` targets,
// which take a bitmap. 24-bit, no alpha: the header sits on MUI's white background and the
// sidebar on its own, so both are composited here against a known color instead.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const rootDir = path.resolve(__dirname, "..", "..");
const sourceIcon = path.join(rootDir, "resources", "app-icon.png");
const outDir = path.join(rootDir, "project", "installer");

/** MUI's own header background. Anything else leaves a seam beside the page title. */
const HEADER_BACKGROUND = [0xff, 0xff, 0xff];
/** Studio's dark chrome, the same value the organisation's dark banners use. */
const SIDEBAR_BACKGROUND = [0x0c, 0x0e, 0x12];

/**
 * Decode an 8-bit RGBA, non-interlaced PNG into `{ width, height, pixels }`.
 *
 * Deliberately not a general PNG reader: it handles exactly the one file this script consumes and
 * refuses anything else loudly. A tolerant decoder that quietly mis-read a palette would produce
 * a plausible-looking installer graphic, which is the failure that would ship.
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
            const rawByte = line[x];
            const left = x >= 4 ? out[x - 4] : 0;
            const up = prior ? prior[x] : 0;
            const upLeft = prior && x >= 4 ? prior[x - 4] : 0;
            let value;
            switch (filter) {
                case 0: value = rawByte; break;
                case 1: value = rawByte + left; break;
                case 2: value = rawByte + up; break;
                case 3: value = rawByte + ((left + up) >> 1); break;
                case 4: value = rawByte + paeth(left, up, upLeft); break;
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

/**
 * Box-average `image` down to `size` x `size`, premultiplying by alpha.
 *
 * Premultiplied because the master's transparent margin is not black - averaging straight RGBA
 * pulls whatever color those invisible pixels happen to carry into the edge of the mark, which is
 * the halo every naive downscale produces.
 */
function downscale(image, size) {
    const out = Buffer.alloc(size * size * 4);
    const scale = image.width / size;

    for (let y = 0; y < size; y += 1) {
        const y0 = Math.floor(y * scale);
        const y1 = Math.min(image.height, Math.ceil((y + 1) * scale));
        for (let x = 0; x < size; x += 1) {
            const x0 = Math.floor(x * scale);
            const x1 = Math.min(image.width, Math.ceil((x + 1) * scale));
            let r = 0, g = 0, b = 0, a = 0, count = 0;
            for (let sy = y0; sy < y1; sy += 1) {
                for (let sx = x0; sx < x1; sx += 1) {
                    const i = (sy * image.width + sx) * 4;
                    const alpha = image.pixels[i + 3] / 255;
                    r += image.pixels[i] * alpha;
                    g += image.pixels[i + 1] * alpha;
                    b += image.pixels[i + 2] * alpha;
                    a += alpha;
                    count += 1;
                }
            }
            const o = (y * size + x) * 4;
            const coverage = a / count;
            // Un-premultiply, so compositing below can use the averaged coverage as-is.
            out[o] = coverage > 0 ? Math.round(r / a) : 0;
            out[o + 1] = coverage > 0 ? Math.round(g / a) : 0;
            out[o + 2] = coverage > 0 ? Math.round(b / a) : 0;
            out[o + 3] = Math.round(coverage * 255);
        }
    }

    return { width: size, height: size, pixels: out };
}

/** A solid canvas with the mark composited onto it at (left, top). Returns 24-bit BGR rows. */
function compose(width, height, background, mark, left, top) {
    const canvas = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i += 1) {
        canvas[i * 3] = background[2];
        canvas[i * 3 + 1] = background[1];
        canvas[i * 3 + 2] = background[0];
    }

    for (let y = 0; y < mark.height; y += 1) {
        const canvasY = top + y;
        if (canvasY < 0 || canvasY >= height) {
            continue;
        }
        for (let x = 0; x < mark.width; x += 1) {
            const canvasX = left + x;
            if (canvasX < 0 || canvasX >= width) {
                continue;
            }
            const source = (y * mark.width + x) * 4;
            const alpha = mark.pixels[source + 3] / 255;
            if (alpha === 0) {
                continue;
            }
            const target = (canvasY * width + canvasX) * 3;
            for (let channel = 0; channel < 3; channel += 1) {
                // BMP is BGR; the mark is RGB.
                const value = mark.pixels[source + (2 - channel)];
                canvas[target + channel] = Math.round(value * alpha + canvas[target + channel] * (1 - alpha));
            }
        }
    }

    return canvas;
}

/** Write a bottom-up 24-bit BMP. Rows pad to a 4-byte boundary, which is what makes them bottom-up. */
function writeBmp(file, width, height, bgr) {
    const rowSize = Math.ceil((width * 3) / 4) * 4;
    const imageSize = rowSize * height;
    const buffer = Buffer.alloc(54 + imageSize);

    buffer.write("BM", 0, "ascii");
    buffer.writeUInt32LE(54 + imageSize, 2);
    buffer.writeUInt32LE(54, 10);
    buffer.writeUInt32LE(40, 14);
    buffer.writeInt32LE(width, 18);
    buffer.writeInt32LE(height, 22);
    buffer.writeUInt16LE(1, 26);
    buffer.writeUInt16LE(24, 28);
    buffer.writeUInt32LE(imageSize, 34);
    // 96 DPI in pixels per metre, which is what every other tool writes here.
    buffer.writeInt32LE(3780, 38);
    buffer.writeInt32LE(3780, 42);

    for (let y = 0; y < height; y += 1) {
        const sourceRow = (height - 1 - y) * width * 3;
        bgr.copy(buffer, 54 + y * rowSize, sourceRow, sourceRow + width * 3);
    }

    fs.writeFileSync(file, buffer);
    return buffer.length;
}

function main() {
    const icon = decodePng(fs.readFileSync(sourceIcon));
    fs.mkdirSync(outDir, { recursive: true });

    // Header: 2x of MUI's 150x57. With MUI_HEADERIMAGE_RIGHT (which electron-builder defines
    // whenever `installerHeader` is set) this sits at the right end of the header band, with the
    // page title to its left - so the mark is centred in its own strip rather than aligned.
    const headerWidth = 300;
    const headerHeight = 114;
    const headerMark = downscale(icon, 90);
    writeBmp(
        path.join(outDir, "header.bmp"),
        headerWidth,
        headerHeight,
        compose(
            headerWidth,
            headerHeight,
            HEADER_BACKGROUND,
            headerMark,
            Math.round((headerWidth - headerMark.width) / 2),
            Math.round((headerHeight - headerMark.height) / 2),
        ),
    );

    // Sidebar: 2x of MUI's 164x314, shown on the welcome and finish pages. The mark sits above
    // centre because the page's own text starts level with the middle of this strip.
    const sidebarWidth = 328;
    const sidebarHeight = 628;
    const sidebarMark = downscale(icon, 160);
    writeBmp(
        path.join(outDir, "sidebar.bmp"),
        sidebarWidth,
        sidebarHeight,
        compose(
            sidebarWidth,
            sidebarHeight,
            SIDEBAR_BACKGROUND,
            sidebarMark,
            Math.round((sidebarWidth - sidebarMark.width) / 2),
            Math.round(sidebarHeight * 0.28),
        ),
    );

    console.log(`Wrote header.bmp (${headerWidth}x${headerHeight}) and sidebar.bmp (${sidebarWidth}x${sidebarHeight}) to ${outDir}`);
}

main();
