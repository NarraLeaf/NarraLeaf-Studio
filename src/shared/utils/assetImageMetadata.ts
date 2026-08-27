/**
 * Remove the metadata an image carries about the person and machine that made
 * it, before the build ships it.
 *
 * A camera or an editor writes far more into an image than the picture: the
 * photographer's name, a copyright line, which application and version wrote the
 * file, an embedded preview, GPS coordinates, the path the file had on the
 * artist's disk, timestamps. None of it is used to draw anything, all of it
 * travels with the asset into every copy of the shipped game, and an author who
 * commissioned art has no way to know it is there.
 *
 * This belongs to the pack-time half of content protection rather than the
 * runtime half: information that is not in the file cannot be recovered from it
 * by anyone, on any machine, no matter what they do to the game. That is the
 * whole reason it is worth doing - unlike a check the shipped game performs,
 * there is nothing here for an attacker to remove.
 *
 * ## What it does not remove
 *
 * An **ICC profile** stays. It is not provenance, it is how the pixel values are
 * meant to be interpreted, and an image that carries one is saying its numbers
 * are not sRGB. Dropping it does not remove information about the author, it
 * shifts the colours - the same failure {@link planAssetImageTranscode} refuses
 * to re-encode a colour-managed image to avoid.
 *
 * Everything else that decides how the image draws stays too, which is why each
 * format below works from a list of what to drop rather than a list of what to
 * keep. A keep-list is the shape that quietly breaks an image the day somebody
 * saves it from a tool nobody here has tried: APNG's animation control, WebP's
 * alpha and animation chunks, JPEG's Adobe colour-transform marker are all
 * things a "strip everything unknown" pass would take out, and only the first
 * would be obvious.
 *
 * ## Formats
 *
 * PNG, JPEG and WebP - the three whose bytes {@link readImageDimensions} can
 * identify, and the three that carry EXIF, XMP and IPTC at all. Anything else is
 * returned untouched rather than guessed at, and the format is read from the
 * bytes rather than the file name, so a `.png` that is really a JPEG is treated
 * as the JPEG it is.
 */

import { readImageDimensions } from "@shared/utils/imageDimensions";

/** What was taken out, named for a build log rather than for the format spec. */
export type ImageMetadataKind =
    /** EXIF: camera, lens, timestamps, GPS, and often an embedded preview. */
    | "exif"
    /** XMP: editor history, author, rights, and whatever else a tool chose to write. */
    | "xmp"
    /** Photoshop resources: IPTC rights fields, the saved thumbnail, path and layer residue. */
    | "photoshop"
    /** Free text: PNG's tEXt family, JPEG comments. Where "Software" and "Author" live. */
    | "text"
    /** A creation or modification time written into the image. */
    | "timestamp";

export type StrippedImage = {
    /** The bytes to ship. The same object when nothing was found to remove. */
    bytes: Uint8Array;
    /** Empty when the image carried none of the above. */
    removed: ImageMetadataKind[];
    /** How many bytes the removal saved. Zero when nothing was removed. */
    bytesRemoved: number;
};

function unchanged(bytes: Uint8Array): StrippedImage {
    return { bytes, removed: [], bytesRemoved: 0 };
}

export function stripImageMetadata(bytes: Uint8Array): StrippedImage {
    const format = readImageDimensions(bytes)?.format;
    if (format === "png") {
        return stripPng(bytes);
    }
    if (format === "jpeg") {
        return stripJpeg(bytes);
    }
    if (format === "webp") {
        return stripWebp(bytes);
    }
    return unchanged(bytes);
}

/** Assemble the kept pieces, or hand back the original when nothing was dropped. */
function rebuild(bytes: Uint8Array, kept: Uint8Array[], removed: Set<ImageMetadataKind>): StrippedImage {
    if (removed.size === 0) {
        return unchanged(bytes);
    }
    const total = kept.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of kept) {
        out.set(part, offset);
        offset += part.length;
    }
    return { bytes: out, removed: [...removed], bytesRemoved: bytes.length - out.length };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
    if (offset + length > bytes.length) {
        return "";
    }
    let out = "";
    for (let i = 0; i < length; i += 1) {
        out += String.fromCharCode(bytes[offset + i]);
    }
    return out;
}

/* --- PNG ---------------------------------------------------------------- */

const PNG_SIGNATURE_LENGTH = 8;

/**
 * PNG chunks that hold nothing the renderer reads.
 *
 * `iTXt` is where XMP arrives (keyword `XML:com.adobe.xmp`) and `tEXt`/`zTXt`
 * are where `Software`, `Author`, `Copyright` and `Comment` arrive, so all three
 * go regardless of keyword: a text chunk that survives because its keyword was
 * not recognised is the case this is for.
 *
 * Not here, deliberately: `iCCP` (the colour profile), `pHYs` (physical pixel
 * size, which a renderer may scale by), `sRGB`/`gAMA`/`cHRM`/`sBIT` (colour
 * interpretation), `tRNS`/`PLTE`/`bKGD` (pixels), and `acTL`/`fcTL`/`fdAT`
 * (APNG's animation, without which the image stops moving).
 */
const PNG_METADATA_CHUNKS: Record<string, ImageMetadataKind> = {
    tEXt: "text",
    zTXt: "text",
    iTXt: "xmp",
    eXIf: "exif",
    tIME: "timestamp",
};

/**
 * Unlike the checks in `assetImageOptimization`, this walks past `IDAT` to
 * `IEND`. Those checks look for chunks the spec requires to precede the image
 * data, so they can stop there; text chunks have no such rule and editors do
 * write them at the end, which is exactly where a "Software" line tends to sit.
 *
 * Each kept chunk carries its own CRC over its own bytes, so removing whole
 * chunks needs no checksum to be recomputed - which is why this works on bytes
 * without decoding the image.
 */
function stripPng(bytes: Uint8Array): StrippedImage {
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const kept: Uint8Array[] = [bytes.subarray(0, PNG_SIGNATURE_LENGTH)];
    const removed = new Set<ImageMetadataKind>();
    let offset = PNG_SIGNATURE_LENGTH;

    while (offset + 12 <= bytes.length) {
        const length = data.getUint32(offset);
        const type = ascii(bytes, offset + 4, 4);
        const end = offset + length + 12;
        // A length that runs past the buffer means truncated or malformed bytes.
        // Keep the remainder verbatim rather than emit something shorter than
        // what came in: this pass is not a validator, and an image Studio cannot
        // parse is still an image the author put in the project.
        if (end <= offset || end > bytes.length) {
            kept.push(bytes.subarray(offset));
            return rebuild(bytes, kept, removed);
        }
        const kind = PNG_METADATA_CHUNKS[type];
        if (kind) {
            removed.add(kind);
        } else {
            kept.push(bytes.subarray(offset, end));
        }
        offset = end;
        if (type === "IEND") {
            break;
        }
    }
    // Trailing bytes after IEND are not part of the image, but some tools append
    // them and something may be reading them; they are not ours to drop.
    if (offset < bytes.length) {
        kept.push(bytes.subarray(offset));
    }
    return rebuild(bytes, kept, removed);
}

/* --- JPEG --------------------------------------------------------------- */

const JPEG_XMP_IDENTIFIER = "http://ns.adobe.com/xap/1.0/";
const JPEG_XMP_EXTENSION_IDENTIFIER = "http://ns.adobe.com/xmp/extension/";

/**
 * Which APP segment this is, by the identifier string that opens its payload
 * rather than by its marker number. Several different things share `APP1`, and
 * one of them - the ICC profile in `APP2` - must survive, so the marker alone is
 * not enough to decide with.
 */
function jpegSegmentKind(bytes: Uint8Array, marker: number, payload: number): ImageMetadataKind | null {
    // COM: a free-text comment.
    if (marker === 0xfe) {
        return "text";
    }
    if (marker === 0xe1) {
        if (ascii(bytes, payload, 4) === "Exif") {
            return "exif";
        }
        if (ascii(bytes, payload, JPEG_XMP_IDENTIFIER.length) === JPEG_XMP_IDENTIFIER
            || ascii(bytes, payload, JPEG_XMP_EXTENSION_IDENTIFIER.length) === JPEG_XMP_EXTENSION_IDENTIFIER) {
            return "xmp";
        }
        return null;
    }
    // APP13, Photoshop's image resource block: IPTC rights fields, the saved
    // thumbnail, clipping paths, and whatever else the editor kept.
    if (marker === 0xed && ascii(bytes, payload, 9) === "Photoshop") {
        return "photoshop";
    }
    return null;
}

/**
 * Walks markers only as far as the start of scan, after which the entropy-coded
 * data begins and a `0xFF` no longer introduces anything. Everything from `SOS`
 * onward is copied verbatim.
 *
 * `APP14` (Adobe) is never dropped even though it is written by an editor: it
 * declares the colour transform, and a decoder that does not see it can read a
 * three-component JPEG as RGB instead of YCbCr. That is an inverted-looking
 * image, from removing what looks like editor residue.
 */
function stripJpeg(bytes: Uint8Array): StrippedImage {
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const kept: Uint8Array[] = [bytes.subarray(0, 2)];
    const removed = new Set<ImageMetadataKind>();
    let offset = 2;

    while (offset + 4 <= bytes.length) {
        if (bytes[offset] !== 0xff) {
            break;
        }
        let markerAt = offset;
        let marker = bytes[markerAt + 1];
        // Runs of 0xFF are legal padding ahead of the marker byte.
        while (marker === 0xff && markerAt + 2 < bytes.length) {
            markerAt += 1;
            marker = bytes[markerAt + 1];
        }
        // Start of scan, end of image: nothing parseable follows.
        if (marker === 0xda || marker === 0xd9) {
            break;
        }
        // Standalone markers: no length, no payload.
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
            kept.push(bytes.subarray(offset, markerAt + 2));
            offset = markerAt + 2;
            continue;
        }
        const lengthAt = markerAt + 2;
        if (lengthAt + 2 > bytes.length) {
            break;
        }
        const segmentLength = data.getUint16(lengthAt);
        const end = lengthAt + segmentLength;
        if (segmentLength < 2 || end > bytes.length) {
            break;
        }
        const kind = jpegSegmentKind(bytes, marker, lengthAt + 2);
        if (kind) {
            removed.add(kind);
            // Any 0xFF padding ahead of this marker belongs to it and goes too.
            kept.push(bytes.subarray(offset, markerAt));
        } else {
            kept.push(bytes.subarray(offset, end));
        }
        offset = end;
    }
    kept.push(bytes.subarray(offset));
    return rebuild(bytes, kept, removed);
}

/* --- WebP --------------------------------------------------------------- */

const WEBP_METADATA_CHUNKS: Record<string, ImageMetadataKind> = {
    EXIF: "exif",
    // The fourcc is four characters; XMP's is padded with a trailing space.
    "XMP ": "xmp",
};

/** VP8X flag bits. Only the two that announce metadata are ever cleared. */
const VP8X_FLAG_EXIF = 0x08;
const VP8X_FLAG_XMP = 0x04;

const RIFF_HEADER_LENGTH = 12;
const WEBP_CHUNK_HEADER_LENGTH = 8;

/**
 * A WebP is a RIFF container, so two things have to be corrected after a chunk
 * is removed rather than only the chunk taken out: the RIFF size in the header,
 * and the `VP8X` flag bits that announce which optional chunks are present. A
 * reader that trusts the flags and then cannot find the chunk they promise is
 * entitled to reject the file, so leaving them set turns a metadata strip into a
 * corrupt image.
 *
 * The ICC flag is not touched, matching the `ICCP` chunk being kept.
 */
function stripWebp(bytes: Uint8Array): StrippedImage {
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const kept: Uint8Array[] = [];
    const removed = new Set<ImageMetadataKind>();
    let vp8xFlagsAt = -1;
    let offset = RIFF_HEADER_LENGTH;

    // The header is rewritten at the end once the new size is known, so it is
    // held back rather than pushed with the rest.
    while (offset + WEBP_CHUNK_HEADER_LENGTH <= bytes.length) {
        const fourcc = ascii(bytes, offset, 4);
        const payloadLength = data.getUint32(offset + 4, true);
        // Odd-sized payloads are followed by one padding byte.
        const end = offset + WEBP_CHUNK_HEADER_LENGTH + payloadLength + (payloadLength % 2);
        if (end <= offset || end > bytes.length) {
            kept.push(bytes.subarray(offset));
            offset = bytes.length;
            break;
        }
        const kind = WEBP_METADATA_CHUNKS[fourcc];
        if (kind) {
            removed.add(kind);
        } else {
            if (fourcc === "VP8X" && payloadLength >= 1) {
                // Where the flags byte will land once the kept parts are joined.
                vp8xFlagsAt = RIFF_HEADER_LENGTH
                    + kept.reduce((sum, part) => sum + part.length, 0)
                    + WEBP_CHUNK_HEADER_LENGTH;
            }
            kept.push(bytes.subarray(offset, end));
        }
        offset = end;
    }
    if (offset < bytes.length) {
        kept.push(bytes.subarray(offset));
    }
    if (removed.size === 0) {
        return unchanged(bytes);
    }

    const header = bytes.slice(0, RIFF_HEADER_LENGTH);
    const result = rebuild(bytes, [header, ...kept], removed);
    const out = result.bytes;
    // RIFF size counts everything after its own field: the file, less "RIFF"
    // and the four bytes of the size itself.
    new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(4, out.length - 8, true);
    if (vp8xFlagsAt >= 0 && vp8xFlagsAt < out.length) {
        out[vp8xFlagsAt] &= ~(VP8X_FLAG_EXIF | VP8X_FLAG_XMP);
    }
    return result;
}
