/**
 * What a packaged asset is, decided by reading its bytes.
 *
 * A protected game ships no asset manifest (see `GameRuntimePackV1.assets`), so nothing tells the
 * protocol handler that one entry is a JPEG and the next is an Ogg stream. That turns out to be the
 * right shape rather than a gap to paper over: an item's media type is a property of its bytes, and
 * every consumer downstream - `<img>`, `<video>`, Howler, `FontFace` - would sniff for itself if we
 * handed it nothing. Deciding here keeps that one decision in one place, and keeps it out of the
 * build, where it would have to be written down and could then be read.
 *
 * Only the formats this runtime actually serves are recognised. Anything else answers
 * `application/octet-stream`, which is also the honest answer for a model bundle's `.moc3` or a
 * plugin's private payload - the renderer fetches those as raw buffers and never consults the type.
 */

/** Bytes needed before {@link sniffMediaType} can decide. Cheap: every signature lives up front. */
export const MEDIA_SNIFF_PREFIX_BYTES = 512;

const DEFAULT_MEDIA_TYPE = "application/octet-stream";

function startsWith(data: Buffer, signature: readonly number[], offset = 0): boolean {
    if (data.length < offset + signature.length) {
        return false;
    }
    return signature.every((byte, index) => data[offset + index] === byte);
}

function ascii(data: Buffer, offset: number, length: number): string {
    return data.length < offset + length ? "" : data.toString("latin1", offset, offset + length);
}

/**
 * ISO base media (`ftyp`) covers both `.mp4` and `.m4a`, and the difference is the major brand
 * rather than anything structural. Audio brands are listed because they are the closed set; a brand
 * we do not know is treated as video, which is what an unbranded `.mp4` from any exporter is.
 */
const ISO_AUDIO_BRANDS = new Set(["M4A ", "M4B ", "F4A ", "F4B "]);

function sniffIsoBaseMedia(data: Buffer): string {
    return ISO_AUDIO_BRANDS.has(ascii(data, 8, 4)) ? "audio/mp4" : "video/mp4";
}

/**
 * Ogg and Matroska are containers before they are anything else, so the codec name inside the first
 * page/element header is what separates an audio track from a video one. Both write it in plain
 * ASCII well inside the prefix this reads.
 */
function sniffContainerByDoctype(head: string, video: string, audio: string, markers: readonly string[]): string {
    return markers.some(marker => head.includes(marker)) ? video : audio;
}

/**
 * The media type of `data`, or null when nothing here recognises it.
 *
 * Null rather than the octet-stream default so a caller can tell "this is opaque" from "I did not
 * look", which matters for the renderer's preloader: it warms an image differently from an audio
 * clip, and guessing wrong costs a wasted decode rather than a wrong answer.
 */
export function sniffMediaType(data: Buffer): string | null {
    if (data.length === 0) {
        return null;
    }
    const head = ascii(data, 0, Math.min(data.length, MEDIA_SNIFF_PREFIX_BYTES));

    // Images.
    if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return "image/png";
    }
    if (startsWith(data, [0xff, 0xd8, 0xff])) {
        return "image/jpeg";
    }
    if (head.startsWith("GIF87a") || head.startsWith("GIF89a")) {
        return "image/gif";
    }
    if (head.startsWith("RIFF") && ascii(data, 8, 4) === "WEBP") {
        return "image/webp";
    }
    if (head.startsWith("RIFF") && ascii(data, 8, 4) === "WAVE") {
        return "audio/wav";
    }
    if (startsWith(data, [0x42, 0x4d])) {
        return "image/bmp";
    }
    if (startsWith(data, [0x00, 0x00, 0x01, 0x00])) {
        return "image/x-icon";
    }

    // Fonts. WOFF2 shares its first four bytes with nothing else; bare TTF/OTF are version tags.
    if (head.startsWith("wOFF")) {
        return "font/woff";
    }
    if (head.startsWith("wOF2")) {
        return "font/woff2";
    }
    if (head.startsWith("OTTO")) {
        return "font/otf";
    }
    if (startsWith(data, [0x00, 0x01, 0x00, 0x00]) || head.startsWith("true") || head.startsWith("ttcf")) {
        return "font/ttf";
    }

    // Audio and video containers.
    if (ascii(data, 4, 4) === "ftyp") {
        return sniffIsoBaseMedia(data);
    }
    if (head.startsWith("OggS")) {
        return sniffContainerByDoctype(head, "video/ogg", "audio/ogg", ["theora", "\x80theora"]);
    }
    if (startsWith(data, [0x1a, 0x45, 0xdf, 0xa3])) {
        // A `.weba` writes the same doctype as a `.webm`; Chromium accepts audio served as
        // `video/webm`, so the doctype alone is enough to route it.
        return head.includes("webm") ? "video/webm" : "video/x-matroska";
    }
    if (head.startsWith("fLaC")) {
        return "audio/flac";
    }
    if (head.startsWith("ID3") || startsWith(data, [0xff, 0xfb]) || startsWith(data, [0xff, 0xf3])
        || startsWith(data, [0xff, 0xf2])) {
        return "audio/mpeg";
    }
    if (startsWith(data, [0xff, 0xf1]) || startsWith(data, [0xff, 0xf9])) {
        return "audio/aac";
    }

    // Text-shaped payloads. SVG and JSON are the two a widget can be pointed at directly; both are
    // checked last so a binary format that happens to start with whitespace never reaches here.
    // An XML declaration and a DOCTYPE can push `<svg` well past the signature window, so the
    // element is looked for across the whole text prefix rather than at the front.
    // `head` is latin1, so a UTF-8 BOM arrives as its three raw bytes rather than as U+FEFF.
    const text = head.replace(/^\u00EF\u00BB\u00BF/, "").trimStart();
    if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) {
        return "image/svg+xml";
    }
    if (text.startsWith("<?xml")) {
        return "application/xml";
    }
    if (text.startsWith("{") || text.startsWith("[")) {
        return "application/json";
    }

    return null;
}

/** {@link sniffMediaType} with the fallback applied, for callers that must name something. */
export function mediaTypeOf(data: Buffer): string {
    return sniffMediaType(data) ?? DEFAULT_MEDIA_TYPE;
}
