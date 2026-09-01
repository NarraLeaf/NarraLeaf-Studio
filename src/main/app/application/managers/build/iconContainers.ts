/**
 * Writing the two native icon containers - Windows `.ico` and macOS `.icns` -
 * from a set of square PNGs.
 *
 * Studio produces these itself rather than handing electron-builder a large PNG
 * and letting it convert. The packager's converter is a script it runs with
 * `process.execPath`, and inside Studio that is the Electron binary: converting
 * one icon starts a whole second Electron, which on a machine with no window
 * server - an SSH session on the build Mac, the case the command-line build
 * exists for - dies on its GPU process and takes the build down with it
 * (`ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`). Handed a file that already carries
 * the target extension, electron-builder skips the converter entirely; see
 * `doConvertIcon` in app-builder-lib.
 *
 * Both formats are, for our purposes, a header and a list of images, so neither
 * needs an encoder beyond what is here. Nothing in this file touches Electron or
 * the file system: it takes bytes and returns bytes, which is also what makes it
 * testable without a display.
 */

/** One rendered square of the source icon. */
export type IconImage = {
    /** Edge length in pixels. Square throughout - both containers only carry squares. */
    size: number;
    /** The square encoded as a PNG. */
    png: Buffer;
    /**
     * The same square as straight (non-premultiplied) RGBA samples, row-major
     * from the top. Only the `.ico` writer needs it, and only for the sizes it
     * stores as bitmaps.
     */
    rgba: Uint8Array;
};

/**
 * The sizes a Windows `.ico` carries, smallest first.
 *
 * The small end is what Explorer's list view and the window's own title bar
 * draw; 256 is what the shell uses for large thumbnails and is the one size
 * electron-builder insists on - it refuses an `.ico` whose largest image is
 * under 256 with `ERR_ICON_TOO_SMALL`, so it is always written even when the
 * source is smaller and has to be upscaled to reach it.
 */
export const ICO_SIZES: readonly number[] = [16, 24, 32, 48, 64, 128, 256];

/**
 * Above this edge an `.ico` image is stored as a PNG rather than a bitmap.
 *
 * Windows has read PNG-compressed entries since Vista and a 256-square bitmap
 * would be 256 KB on its own, so the large end is stored compressed. The small
 * end is stored as an uncompressed DIB, which is what every icon authoring tool
 * writes and what the oldest readers in the chain - NSIS rewriting the
 * installer's icon resource, the shell drawing a 16-pixel list icon - have
 * always been able to read. Mixing the two is the conventional layout, not a
 * compromise.
 */
const ICO_PNG_THRESHOLD = 256;

/**
 * The chunks a macOS `.icns` carries: a four-character type and the pixel size
 * of the image it holds.
 *
 * Retina variants are separate chunk types holding the same pixels as their 1x
 * counterpart at twice the edge - `ic13` (128@2x) and `ic08` (256) are both a
 * 256-pixel square - so one rendered square can fill two chunks. Written in
 * ascending size, which is the order `iconutil` produces.
 *
 * The types below all take PNG data. The older `is32`/`il32` pairs, which carry
 * raw samples and a separate mask, are deliberately absent: every macOS that can
 * run an Electron app reads the PNG types, and a reader that finds no exact
 * match for a slot scales the nearest one it has.
 */
const ICNS_CHUNKS: ReadonlyArray<{ type: string; size: number }> = [
    { type: "ic11", size: 32 },
    { type: "ic12", size: 64 },
    { type: "ic07", size: 128 },
    { type: "ic08", size: 256 },
    { type: "ic13", size: 256 },
    { type: "ic09", size: 512 },
    { type: "ic14", size: 512 },
    { type: "ic10", size: 1024 },
];

/** The distinct pixel sizes an `.icns` needs rendering, smallest first. */
export const ICNS_SIZES: readonly number[] = [...new Set(ICNS_CHUNKS.map(chunk => chunk.size))]
    .sort((left, right) => left - right);

/**
 * The largest square each container is written up to when the source is smaller
 * than that.
 *
 * A source below the floor is upscaled to reach it rather than leaving the
 * container short: electron-builder refuses an `.ico` under 256, and macOS asks
 * for the 512 square whenever it draws an icon large (Get Info, the Dock at its
 * biggest). Above the floor the source's own size is the cap, so a 512-pixel
 * master does not get a blurry 1024 chunk nobody asked for.
 */
export const ICO_MINIMUM_EDGE = 256;
export const ICNS_MINIMUM_EDGE = 512;

/**
 * Which squares to render from a source whose largest edge is `sourceEdge`:
 * everything at or below the source's own size, plus whatever it takes to reach
 * the container's floor.
 */
export function iconSizesFor(sizes: readonly number[], sourceEdge: number, minimumEdge: number): number[] {
    const ceiling = Math.max(sourceEdge, minimumEdge);
    return sizes.filter(size => size <= ceiling);
}

/**
 * A Windows icon file holding every image given, in the order given.
 *
 * Throws rather than writing a container electron-builder will refuse: an `.ico`
 * whose largest image is under 256 fails the packager's own check, and finding
 * that out from the packager - minutes into a build, as an error code - is the
 * failure this file exists to remove.
 */
export function encodeIco(images: readonly IconImage[]): Buffer {
    if (images.length === 0) {
        throw new Error("An .ico needs at least one image");
    }
    if (!images.some(image => image.size >= ICO_MINIMUM_EDGE)) {
        throw new Error(`An .ico needs an image of at least ${ICO_MINIMUM_EDGE}x${ICO_MINIMUM_EDGE}`);
    }

    const payloads = images.map(image => image.size >= ICO_PNG_THRESHOLD
        ? image.png
        : encodeIcoBitmap(image));

    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);

    const directory = Buffer.alloc(16 * images.length);
    // The first image starts after the header and the whole directory.
    let offset = header.length + directory.length;
    for (const [index, image] of images.entries()) {
        const entry = index * 16;
        // 0 means 256 in a single byte, which is why the format cannot carry
        // anything larger than that as an entry dimension.
        const dimension = image.size >= 256 ? 0 : image.size;
        directory[entry] = dimension;
        directory[entry + 1] = dimension;
        directory[entry + 2] = 0;
        directory[entry + 3] = 0;
        directory.writeUInt16LE(1, entry + 4);
        directory.writeUInt16LE(32, entry + 6);
        directory.writeUInt32LE(payloads[index].length, entry + 8);
        directory.writeUInt32LE(offset, entry + 12);
        offset += payloads[index].length;
    }

    return Buffer.concat([header, directory, ...payloads]);
}

/**
 * One image as an uncompressed 32-bit DIB, in the shape an `.ico` entry wants:
 * a `BITMAPINFOHEADER` whose height covers both bitmaps, the colour rows bottom
 * up in BGRA, and an all-zero AND mask.
 *
 * The mask is a leftover of the 1-bit era and is ignored by every reader that
 * understands the alpha channel; it is still written because the header claims
 * the height, and a reader that trusts the header would run off the end of the
 * entry without it.
 */
function encodeIcoBitmap(image: IconImage): Buffer {
    const { size, rgba } = image;
    if (rgba.length < size * size * 4) {
        throw new Error(`Icon samples for ${size}x${size} are short: ${rgba.length} bytes`);
    }
    const infoHeader = Buffer.alloc(40);
    infoHeader.writeUInt32LE(40, 0);
    infoHeader.writeInt32LE(size, 4);
    infoHeader.writeInt32LE(size * 2, 8);
    infoHeader.writeUInt16LE(1, 12);
    infoHeader.writeUInt16LE(32, 14);
    infoHeader.writeUInt32LE(0, 16);

    const colors = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
        // Bottom-up: the last row of the image is the first row of the bitmap.
        const source = (size - 1 - y) * size * 4;
        const target = y * size * 4;
        for (let x = 0; x < size; x++) {
            colors[target + x * 4] = rgba[source + x * 4 + 2];
            colors[target + x * 4 + 1] = rgba[source + x * 4 + 1];
            colors[target + x * 4 + 2] = rgba[source + x * 4];
            colors[target + x * 4 + 3] = rgba[source + x * 4 + 3];
        }
    }

    // 1 bit per pixel, each row padded out to a 4-byte boundary.
    const maskStride = Math.ceil(size / 32) * 4;
    const mask = Buffer.alloc(maskStride * size);
    infoHeader.writeUInt32LE(colors.length + mask.length, 20);

    return Buffer.concat([infoHeader, colors, mask]);
}

/**
 * A macOS icon file holding a chunk for every declared type whose size was
 * rendered. Sizes that were not rendered are simply absent, which is a
 * well-formed `.icns` - the reader scales what it finds.
 */
export function encodeIcns(images: readonly IconImage[]): Buffer {
    const bySize = new Map(images.map(image => [image.size, image.png]));
    const chunks: Buffer[] = [];
    for (const { type, size } of ICNS_CHUNKS) {
        const png = bySize.get(size);
        if (!png) {
            continue;
        }
        const chunk = Buffer.alloc(8 + png.length);
        chunk.write(type, 0, 4, "ascii");
        // The length a chunk declares includes its own eight-byte header.
        chunk.writeUInt32BE(chunk.length, 4);
        png.copy(chunk, 8);
        chunks.push(chunk);
    }
    if (chunks.length === 0) {
        throw new Error("An .icns needs at least one image of a size it can carry");
    }

    const body = Buffer.concat(chunks);
    const file = Buffer.alloc(8 + body.length);
    file.write("icns", 0, 4, "ascii");
    // Likewise the file length, which counts the magic and the length itself.
    file.writeUInt32BE(file.length, 4);
    body.copy(file, 8);
    return file;
}
