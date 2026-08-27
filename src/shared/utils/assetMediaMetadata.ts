/**
 * Remove what a sound file says about the people and machines that made it,
 * before the build ships it.
 *
 * The same job {@link stripImageMetadata} does for artwork, and worth doing for
 * the same reason: a recording carries far more than the sound. The performer's
 * name, the studio, the composer, a copyright line, the session's path on
 * somebody's disk, the software that bounced it, an embedded cover - none of it
 * is used to play anything, all of it travels into every copy of the shipped
 * game, and an author who commissioned a soundtrack has no way to know it is
 * there. Like the image pass, this belongs to the pack-time half of content
 * protection: what is not in the file cannot be recovered from it by anyone.
 *
 * ## Which formats, and why not the others
 *
 * WAV, FLAC and MP3 - the three whose metadata sits in a list of self-describing
 * blocks that can be rebuilt by leaving some of them out, exactly as PNG's
 * chunks can. Nothing else is touched.
 *
 * The three that are deliberately absent are absent because editing them in
 * place is not a matter of dropping bytes:
 *
 *  - **MP4 and MOV** keep their sample tables in `moov` and their samples in
 *    `mdat`, and every entry of `stco`/`co64` is a byte offset into the file.
 *    Removing a box from `moov` moves `mdat`, so a correct edit has to rewrite
 *    every one of those offsets - and a fragmented file has more of them, in
 *    more places.
 *  - **Ogg** stores a CRC per page, and a comment header that grows or shrinks
 *    past a page boundary has to be repaginated.
 *  - **Matroska and WebM** record absolute positions in `SeekHead`.
 *
 * For those three the correct tool is a remux by something that already knows
 * the container, which is what the build's compression pass reaches for; this
 * module refuses rather than guessing.
 *
 * ## Drop-lists, never keep-lists
 *
 * Every format below works from a list of what to remove. A keep-list is the
 * shape that quietly breaks a file the day somebody saves it from a tool nobody
 * here has tried - and in audio that failure is worse than in images, because
 * some of what looks like metadata is load-bearing: a WAV's `smpl` chunk holds
 * the loop points a looping track is unusable without, `cue ` holds markers,
 * FLAC's `SEEKTABLE` is how a player seeks and its `CUESHEET` is how a single
 * file becomes many tracks. None of those is provenance, so none of them is
 * named below, so all of them survive.
 *
 * The same rule runs one level deeper for Vorbis comments, which are free-form
 * key/value pairs: the fields named here go and every other field stays. A tool
 * that writes `LOOPSTART`, or a mastering chain that writes `REPLAYGAIN_*`, is
 * writing something a player may act on, and this pass has no business deciding
 * that a key it has never heard of is decoration.
 */

/** What was taken out, named for a build log rather than for the format spec. */
export type MediaMetadataKind =
    /** ID3, in either version, at the front or the back of an MP3. */
    | "id3"
    /** A RIFF `LIST`/`INFO` block, or one of the XML sidecars a DAW writes into a WAV. */
    | "riff-info"
    /** Named fields inside a Vorbis comment. The block itself stays. */
    | "vorbis-comment"
    /** An embedded cover image. */
    | "picture"
    /** Space reserved for tags that were never written. */
    | "padding";

export type StrippedMedia = {
    /** The bytes to ship. The same object when nothing was found to remove. */
    bytes: Uint8Array;
    /** Empty when the file carried none of the above. */
    removed: MediaMetadataKind[];
    /** How many bytes the removal saved. Zero when nothing was removed. */
    bytesRemoved: number;
};

function unchanged(bytes: Uint8Array): StrippedMedia {
    return { bytes, removed: [], bytesRemoved: 0 };
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

/**
 * The formats this module edits, read from the bytes rather than the file name.
 *
 * An asset in the library is stored under its id with no extension at all, so
 * there is nothing else to read it from.
 */
export type StrippableMediaFormat = "wav" | "flac" | "mp3";

export function readMediaFormat(bytes: Uint8Array): StrippableMediaFormat | null {
    if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") {
        return "wav";
    }
    if (bytes.length >= 4 && ascii(bytes, 0, 4) === "fLaC") {
        return "flac";
    }
    if (bytes.length >= 3 && ascii(bytes, 0, 3) === "ID3") {
        return "mp3";
    }
    // A bare MPEG audio frame: eleven set bits, then a version and layer that are
    // not the reserved values. Checked because an MP3 whose tag sits only at the
    // end has no prefix to recognise it by.
    if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
        && (bytes[1] & 0x18) !== 0x08 && (bytes[1] & 0x06) !== 0x00) {
        return "mp3";
    }
    return null;
}

export function stripMediaMetadata(bytes: Uint8Array): StrippedMedia {
    switch (readMediaFormat(bytes)) {
        case "wav":
            return stripWav(bytes);
        case "flac":
            return stripFlac(bytes);
        case "mp3":
            return stripMp3(bytes);
        default:
            return unchanged(bytes);
    }
}

/**
 * Whether a file is worth reading in full to strip, decided from its ends.
 *
 * Every tag these three formats carry lives either in a bounded prefix - the
 * RIFF chunk list before the samples, FLAC's metadata blocks, an ID3v2 header -
 * or in a bounded suffix, which is ID3v1's last 128 bytes and APE's trailer. So
 * a few kilobytes off each end answer "is there anything here at all", and the
 * answer is no for most of a project.
 *
 * That matters more than it looks. The alternative is reading every sound file
 * in the project on every build to find out, and a fully voiced game is
 * gigabytes of them. This is deliberately allowed to say yes when the answer is
 * no - the caller then reads the file and finds nothing, which costs one read -
 * but it must never say no when the answer is yes.
 */
export function mediaMetadataLikely(head: Uint8Array, tail: Uint8Array): boolean {
    const format = readMediaFormat(head);
    if (format === "mp3") {
        return ascii(head, 0, 3) === "ID3"
            || ascii(tail, Math.max(0, tail.length - 128), 3) === "TAG"
            || tailHasApe(tail);
    }
    if (format === "flac") {
        // Every FLAC metadata block sits before the audio, and the last one says
        // so, which makes a prefix conclusive for all but a file whose blocks are
        // larger than the head - and a file like that has a picture or a padding
        // block in it, which is already an answer of yes.
        const scan = flacBlocks(head);
        return scan.strippable || scan.unknownTail;
    }
    if (format === "wav") {
        const scan = wavChunks(head);
        return scan.strippable || scan.unknownTail || tailHasWavDropId(tail);
    }
    return false;
}

/* --- WAV ------------------------------------------------------------------ */

/**
 * RIFF chunks that hold nothing a decoder reads.
 *
 * `LIST` is only dropped when its list type is `INFO`; the same chunk id also
 * carries `adtl`, which is where the labels attached to `cue ` markers live, and
 * that is part of what the markers mean rather than a note about the studio.
 *
 * `bext` is the Broadcast Wave extension: originator, origination date, and a
 * coding history naming every machine the file passed through. It also carries a
 * timecode reference, which is a fact about a shoot rather than about playback -
 * nothing that plays a game reads it.
 */
const WAV_DROP_CHUNKS: ReadonlySet<string> = new Set([
    "ID3 ", "id3 ", // ID3 smuggled into a RIFF container
    "bext",         // Broadcast Wave: originator, date, coding history
    "iXML", "axml", // XML sidecars written by field recorders and DAWs
    "_PMX",         // XMP
    "CART", "cart", // radio traffic metadata: title, artist, agency, dates
    "afsp", "levl", // analysis leftovers from editors
]);

function wavChunks(bytes: Uint8Array): { strippable: boolean; unknownTail: boolean } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    let strippable = false;
    while (offset + 8 <= bytes.length) {
        const id = ascii(bytes, offset, 4);
        const size = view.getUint32(offset + 4, true);
        // Chunks are padded to an even length, and the pad byte is not counted.
        const advance = 8 + size + (size % 2);
        if (WAV_DROP_CHUNKS.has(id) || (id === "LIST" && ascii(bytes, offset + 8, 4) === "INFO")) {
            strippable = true;
        }
        if (offset + advance > bytes.length) {
            // The samples themselves, which is where the chunk list stops being
            // readable from a prefix and stops mattering: everything a tagger
            // writes before the audio has already been seen, and anything after
            // it is the tail's business. Any other overrun means this is a
            // truncated view and nothing can be ruled out.
            return { strippable, unknownTail: id !== "data" };
        }
        offset += advance;
    }
    return { strippable, unknownTail: offset !== bytes.length };
}

/**
 * Whether a WAV's last few kilobytes mention a chunk this pass would drop.
 *
 * Scanned rather than parsed: the tail is a window into the middle of a chunk
 * list, so there is no boundary to walk from. A four-byte id that happens to
 * occur inside sample data reads as a false positive, which costs one read of a
 * file that turns out to have nothing in it - the direction this whole check is
 * allowed to be wrong in.
 */
function tailHasWavDropId(tail: Uint8Array): boolean {
    for (let offset = 0; offset + 4 <= tail.length; offset += 1) {
        if (WAV_DROP_CHUNKS.has(ascii(tail, offset, 4))) {
            return true;
        }
        if (ascii(tail, offset, 4) === "LIST" && ascii(tail, offset + 8, 4) === "INFO") {
            return true;
        }
    }
    return false;
}

function stripWav(bytes: Uint8Array): StrippedMedia {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const kept: Uint8Array[] = [];
    const removed = new Set<MediaMetadataKind>();
    let offset = 12;
    while (offset + 8 <= bytes.length) {
        const id = ascii(bytes, offset, 4);
        const size = view.getUint32(offset + 4, true);
        const advance = 8 + size + (size % 2);
        if (offset + advance > bytes.length) {
            // A chunk running past the end is a damaged file. Keeping the rest
            // verbatim is the only answer that cannot make it worse.
            kept.push(bytes.subarray(offset));
            offset = bytes.length;
            break;
        }
        const isInfoList = id === "LIST" && ascii(bytes, offset + 8, 4) === "INFO";
        if (WAV_DROP_CHUNKS.has(id) || isInfoList) {
            removed.add(id === "ID3 " || id === "id3 " ? "id3" : "riff-info");
        } else {
            kept.push(bytes.subarray(offset, offset + advance));
        }
        offset += advance;
    }
    if (removed.size === 0) {
        return unchanged(bytes);
    }
    const body = kept.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(12 + body);
    out.set(bytes.subarray(0, 12), 0);
    let cursor = 12;
    for (const part of kept) {
        out.set(part, cursor);
        cursor += part.length;
    }
    // The RIFF size counts everything after the size field itself, so it is the
    // new length less the eight bytes of "RIFF" and the field.
    new DataView(out.buffer).setUint32(4, out.length - 8, true);
    return { bytes: out, removed: [...removed], bytesRemoved: bytes.length - out.length };
}

/* --- FLAC ----------------------------------------------------------------- */

const FLAC_BLOCK_PADDING = 1;
const FLAC_BLOCK_VORBIS_COMMENT = 4;
const FLAC_BLOCK_PICTURE = 6;

function flacBlocks(bytes: Uint8Array): { strippable: boolean; unknownTail: boolean } {
    let offset = 4;
    let strippable = false;
    while (offset + 4 <= bytes.length) {
        const header = bytes[offset];
        const last = (header & 0x80) !== 0;
        const type = header & 0x7f;
        const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
        if (type === FLAC_BLOCK_PADDING || type === FLAC_BLOCK_PICTURE || type === FLAC_BLOCK_VORBIS_COMMENT) {
            strippable = true;
        }
        if (offset + 4 + length > bytes.length) {
            return { strippable, unknownTail: true };
        }
        offset += 4 + length;
        if (last) {
            return { strippable, unknownTail: false };
        }
    }
    return { strippable, unknownTail: true };
}

function stripFlac(bytes: Uint8Array): StrippedMedia {
    type Block = { type: number; data: Uint8Array };
    const blocks: Block[] = [];
    const removed = new Set<MediaMetadataKind>();
    let offset = 4;
    let sawLast = false;
    while (offset + 4 <= bytes.length && !sawLast) {
        const header = bytes[offset];
        sawLast = (header & 0x80) !== 0;
        const type = header & 0x7f;
        const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
        if (offset + 4 + length > bytes.length) {
            // Truncated: nothing here can be rebuilt safely.
            return unchanged(bytes);
        }
        const data = bytes.subarray(offset + 4, offset + 4 + length);
        offset += 4 + length;

        if (type === FLAC_BLOCK_PADDING) {
            removed.add("padding");
            continue;
        }
        if (type === FLAC_BLOCK_PICTURE) {
            removed.add("picture");
            continue;
        }
        if (type === FLAC_BLOCK_VORBIS_COMMENT) {
            const rewritten = stripVorbisComment(data);
            if (rewritten === null) {
                // Unreadable: kept exactly as it was rather than guessed at.
                blocks.push({ type, data });
                continue;
            }
            if (rewritten.length !== data.length) {
                removed.add("vorbis-comment");
            }
            blocks.push({ type, data: rewritten });
            continue;
        }
        blocks.push({ type, data });
    }
    if (!sawLast || removed.size === 0) {
        return unchanged(bytes);
    }
    const audio = bytes.subarray(offset);
    const size = 4 + blocks.reduce((sum, block) => sum + 4 + block.data.length, 0) + audio.length;
    const out = new Uint8Array(size);
    out.set(bytes.subarray(0, 4), 0);
    let cursor = 4;
    blocks.forEach((block, index) => {
        // The last surviving block has to carry the last-block flag, whether or
        // not it was the last one before. A file whose flag went out with a
        // dropped padding block is one no decoder will read past.
        const last = index === blocks.length - 1 ? 0x80 : 0;
        out[cursor] = last | block.type;
        out[cursor + 1] = (block.data.length >> 16) & 0xff;
        out[cursor + 2] = (block.data.length >> 8) & 0xff;
        out[cursor + 3] = block.data.length & 0xff;
        out.set(block.data, cursor + 4);
        cursor += 4 + block.data.length;
    });
    out.set(audio, cursor);
    return { bytes: out, removed: [...removed], bytesRemoved: bytes.length - out.length };
}

/* --- Vorbis comments ------------------------------------------------------ */

/**
 * Comment fields that describe the people, the release or the tools.
 *
 * A drop-list, and it stops here on purpose. `LOOPSTART` and `LOOPLENGTH` are
 * how a looping track knows where its loop is; `REPLAYGAIN_*` is a level a
 * player may apply; a key nobody here has seen may be either. All of them
 * survive, because the cost of keeping a field that turns out to be decoration
 * is a few bytes, and the cost of removing one that turns out to be instruction
 * is a game that sounds wrong.
 */
const VORBIS_DROP_FIELDS: ReadonlySet<string> = new Set([
    "title", "version", "album", "tracknumber", "tracktotal", "discnumber", "disctotal",
    "artist", "albumartist", "performer", "composer", "conductor", "ensemble", "arranger",
    "lyricist", "author", "publisher", "label", "organization", "copyright", "license",
    "contact", "location", "isrc", "genre", "date", "year", "originaldate", "comment",
    "description", "encoded-by", "encoder", "encoder_options", "encoding", "encodedby",
    "sourcemedia", "rating", "bpm", "lyrics", "unsyncedlyrics",
]);

/**
 * Rewrite a Vorbis comment block with the named fields taken out, or `null` when
 * the block cannot be read.
 *
 * The vendor string goes too, and unconditionally: it is a version of whichever
 * encoder wrote the file and nothing reads it. The spec allows it to be empty.
 */
function stripVorbisComment(data: Uint8Array): Uint8Array | null {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data.length < 8) {
        return null;
    }
    const vendorLength = view.getUint32(0, true);
    let offset = 4 + vendorLength;
    if (offset + 4 > data.length) {
        return null;
    }
    const count = view.getUint32(offset, true);
    offset += 4;
    const kept: Uint8Array[] = [];
    for (let i = 0; i < count; i += 1) {
        if (offset + 4 > data.length) {
            return null;
        }
        const length = view.getUint32(offset, true);
        if (offset + 4 + length > data.length) {
            return null;
        }
        const field = data.subarray(offset, offset + 4 + length);
        const text = data.subarray(offset + 4, offset + 4 + length);
        const separator = text.indexOf(0x3d); // "="
        const key = separator < 0 ? "" : ascii(text, 0, separator).toLowerCase();
        if (!VORBIS_DROP_FIELDS.has(key)) {
            kept.push(field);
        }
        offset += 4 + length;
    }
    const body = kept.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(4 + 4 + body);
    const outView = new DataView(out.buffer);
    outView.setUint32(0, 0, true);
    outView.setUint32(4, kept.length, true);
    let cursor = 8;
    for (const part of kept) {
        out.set(part, cursor);
        cursor += part.length;
    }
    return out;
}

/* --- MP3 ------------------------------------------------------------------ */

/** ID3v2's size fields spend only seven bits of each byte, so a sync word can never appear in one. */
function syncsafe(bytes: Uint8Array, offset: number): number {
    return ((bytes[offset] & 0x7f) << 21)
        | ((bytes[offset + 1] & 0x7f) << 14)
        | ((bytes[offset + 2] & 0x7f) << 7)
        | (bytes[offset + 3] & 0x7f);
}

/** The length of the ID3v2 tag at the front, including its own header, or 0. */
function id3v2Length(bytes: Uint8Array): number {
    if (bytes.length < 10 || ascii(bytes, 0, 3) !== "ID3") {
        return 0;
    }
    // Bit 4 of the flags marks a footer, which is another ten bytes at the end of
    // the tag. Missing it leaves ten bytes of tag in front of the audio, and some
    // decoders will not resynchronise past them.
    const footer = (bytes[5] & 0x10) !== 0 ? 10 : 0;
    return 10 + syncsafe(bytes, 6) + footer;
}

function tailHasApe(tail: Uint8Array): boolean {
    for (let offset = Math.max(0, tail.length - 32 - 128); offset + 8 <= tail.length; offset += 1) {
        if (ascii(tail, offset, 8) === "APETAGEX") {
            return true;
        }
    }
    return false;
}

/** How many bytes of tag sit at the end: ID3v1, its extension, and an APE tag. */
function trailingTagLength(bytes: Uint8Array): number {
    let end = bytes.length;
    if (end >= 128 && ascii(bytes, end - 128, 3) === "TAG") {
        end -= 128;
        // The extended block is written *before* the tag it extends.
        if (end >= 227 && ascii(bytes, end - 227, 4) === "TAG+") {
            end -= 227;
        }
    }
    if (end >= 32 && ascii(bytes, end - 32, 8) === "APETAGEX") {
        // The footer's size field covers the tag body and the footer itself; the
        // header, when present, is another 32 bytes in front of that.
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const size = view.getUint32(end - 32 + 12, true);
        const flags = view.getUint32(end - 32 + 16, true);
        const withHeader = size + ((flags & 0x80000000) !== 0 ? 32 : 0);
        if (withHeader > 0 && withHeader <= end) {
            end -= withHeader;
        }
    }
    return bytes.length - end;
}

function stripMp3(bytes: Uint8Array): StrippedMedia {
    const front = id3v2Length(bytes);
    const back = trailingTagLength(bytes);
    if (front === 0 && back === 0) {
        return unchanged(bytes);
    }
    if (front + back >= bytes.length) {
        // Nothing but tags. Not a file this pass has any business rewriting.
        return unchanged(bytes);
    }
    const out = bytes.slice(front, bytes.length - back);
    return { bytes: out, removed: ["id3"], bytesRemoved: bytes.length - out.length };
}
