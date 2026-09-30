/**
 * A video's frame rate, read out of its container.
 *
 * Chromium's `<video>` never reports a frame rate, and the asset record does not carry one: the
 * metadata pass reads `duration`, `videoWidth` and `videoHeight` off a `<video>` and nothing else.
 * But frame stepping, the frame counter and the filmstrip's tile times all need it, so the preview
 * reads it from the bytes it already holds. Two containers cover what Studio plays:
 *
 * - **ISO-BMFF** (`.mp4`, `.m4v`, `.mov`): the video track's `stts` table lists how long every sample
 *   lasts in the track's own timescale, so the average rate is exact for constant-rate video and an
 *   honest average for variable-rate video. A fragmented file keeps its samples in `moof` boxes
 *   instead, and answers through the track's default sample duration in `trex`.
 * - **Matroska / WebM**: the video track's `DefaultDuration`, in nanoseconds per frame. FFmpeg writes
 *   it whenever it knows the rate; a browser's `MediaRecorder` does not, and those files fall through
 *   to {@link estimateFrameRate}, which measures the rate while the clip plays.
 *
 * Nothing here throws on a malformed file: a box or element whose size runs past its parent ends
 * the walk, and the answer is `null` - "not stated", which the preview treats as "measure it".
 */

/** Rates a measured interval is snapped to when it lands within {@link SNAP_TOLERANCE} of one. */
const COMMON_RATES = [24000 / 1001, 24, 25, 30000 / 1001, 30, 48, 50, 60000 / 1001, 60, 120];
/**
 * Relative. Tighter than the 0.1% between 29.97 and 30, so the two are never confused: the intervals
 * are the stream's own timestamps, differenced, and carry no more error than their microsecond
 * rounding.
 */
const SNAP_TOLERANCE = 0.0003;
/** Below this many intervals a measurement is not trusted; a single late frame skews a short run. */
const MIN_MEASURED_INTERVALS = 8;

/** Rates outside this band are a misread box, not a video. */
function plausible(rate: number): number | null {
    return Number.isFinite(rate) && rate >= 1 && rate <= 1000 ? rate : null;
}

/** What the container states about the picture's timing. */
export interface VideoTiming {
    rate: number;
    /**
     * How many frames the picture track holds, when the container lists them. Not the file's
     * duration times the rate: a sound track that runs a few milliseconds longer than the picture
     * stretches the file's duration, and that product counts a frame that is not there.
     */
    frames: number | null;
}

export function readVideoTiming(bytes: Uint8Array): VideoTiming | null {
    if (bytes.byteLength < 12) {
        return null;
    }
    // Matroska opens with the EBML magic; everything else Studio plays as video is ISO-BMFF.
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
        const rate = readMatroskaFrameRate(bytes);
        return rate === null ? null : { rate, frames: null };
    }
    return readIsoBmffTiming(bytes);
}

// ---- ISO-BMFF ---------------------------------------------------------------

interface Box {
    type: string;
    /** First byte after the header. */
    start: number;
    /** One past the last byte of the box. */
    end: number;
}

function boxesIn(view: DataView, from: number, to: number): Box[] {
    const boxes: Box[] = [];
    let offset = from;
    while (offset + 8 <= to) {
        let size = view.getUint32(offset);
        const type = String.fromCharCode(
            view.getUint8(offset + 4),
            view.getUint8(offset + 5),
            view.getUint8(offset + 6),
            view.getUint8(offset + 7),
        );
        let header = 8;
        if (size === 1) {
            if (offset + 16 > to) {
                break;
            }
            // A 64-bit size. Anything past 2^53 is not a file this preview is holding in memory.
            size = Number(view.getBigUint64(offset + 8));
            header = 16;
        } else if (size === 0) {
            size = to - offset;
        }
        if (size < header || offset + size > to) {
            break;
        }
        boxes.push({ type, start: offset + header, end: offset + size });
        offset += size;
    }
    return boxes;
}

function child(view: DataView, parent: Box, type: string): Box | null {
    return boxesIn(view, parent.start, parent.end).find(box => box.type === type) ?? null;
}

function readIsoBmffTiming(bytes: Uint8Array): VideoTiming | null {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const moov = boxesIn(view, 0, bytes.byteLength).find(box => box.type === "moov");
    if (!moov) {
        return null;
    }
    const trex = new Map<number, number>();
    const mvex = child(view, moov, "mvex");
    if (mvex) {
        for (const box of boxesIn(view, mvex.start, mvex.end)) {
            if (box.type === "trex" && box.end - box.start >= 16) {
                // version/flags, track_ID, default_sample_description_index, default_sample_duration
                trex.set(view.getUint32(box.start + 4), view.getUint32(box.start + 12));
            }
        }
    }
    for (const trak of boxesIn(view, moov.start, moov.end)) {
        if (trak.type !== "trak") {
            continue;
        }
        const mdia = child(view, trak, "mdia");
        const hdlr = mdia && child(view, mdia, "hdlr");
        if (!mdia || !hdlr || hdlr.end - hdlr.start < 12) {
            continue;
        }
        const handler = String.fromCharCode(
            view.getUint8(hdlr.start + 8),
            view.getUint8(hdlr.start + 9),
            view.getUint8(hdlr.start + 10),
            view.getUint8(hdlr.start + 11),
        );
        if (handler !== "vide") {
            continue;
        }
        const mdhd = child(view, mdia, "mdhd");
        if (!mdhd || mdhd.end - mdhd.start < 24) {
            continue;
        }
        const timescale = view.getUint32(mdhd.start + (view.getUint8(mdhd.start) === 1 ? 20 : 12));
        if (timescale <= 0) {
            continue;
        }
        const minf = child(view, mdia, "minf");
        const stbl = minf && child(view, minf, "stbl");
        const stts = stbl && child(view, stbl, "stts");
        if (stts && stts.end - stts.start >= 8) {
            const entries = view.getUint32(stts.start + 4);
            let samples = 0;
            let ticks = 0;
            for (let entry = 0; entry < entries; entry++) {
                const at = stts.start + 8 + entry * 8;
                if (at + 8 > stts.end) {
                    break;
                }
                const count = view.getUint32(at);
                samples += count;
                ticks += count * view.getUint32(at + 4);
            }
            const rate = samples > 0 && ticks > 0 ? plausible((timescale * samples) / ticks) : null;
            if (rate !== null) {
                return { rate, frames: samples };
            }
        }
        // Fragmented: the samples live in `moof` boxes, and the track header says how long each lasts.
        const tkhd = child(view, trak, "tkhd");
        if (tkhd && tkhd.end - tkhd.start >= 24) {
            const trackId = view.getUint32(tkhd.start + (view.getUint8(tkhd.start) === 1 ? 20 : 12));
            const duration = trex.get(trackId);
            const rate = duration && duration > 0 ? plausible(timescale / duration) : null;
            if (rate !== null) {
                return { rate, frames: null };
            }
        }
    }
    return null;
}

// ---- Matroska ---------------------------------------------------------------

const EBML_SEGMENT = 0x18538067;
const EBML_TRACKS = 0x1654ae6b;
const EBML_TRACK_ENTRY = 0xae;
const EBML_TRACK_TYPE = 0x83;
const EBML_DEFAULT_DURATION = 0x23e383;
const EBML_VIDEO = 0xe0;
const EBML_FRAME_RATE = 0x2383e3;
const EBML_CLUSTER = 0x1f43b675;

interface Element {
    id: number;
    start: number;
    end: number;
}

/** A variable-length integer, keeping the length marker (IDs) or stripping it (sizes). */
function readVint(bytes: Uint8Array, offset: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } | null {
    const first = bytes[offset];
    if (first === undefined || first === 0) {
        return null;
    }
    let length = 1;
    while (length <= 8 && (first & (0x80 >> (length - 1))) === 0) {
        length++;
    }
    if (length > 8 || offset + length > bytes.byteLength) {
        return null;
    }
    let value = keepMarker ? first : first & (0xff >> length);
    let allOnes = value === (0xff >> length);
    for (let index = 1; index < length; index++) {
        const byte = bytes[offset + index];
        value = value * 256 + byte;
        allOnes = allOnes && byte === 0xff;
    }
    return { value, length, unknown: !keepMarker && allOnes };
}

function elementsIn(bytes: Uint8Array, from: number, to: number): Element[] {
    const elements: Element[] = [];
    let offset = from;
    while (offset < to) {
        const id = readVint(bytes, offset, true);
        const size = id && readVint(bytes, offset + id.length, false);
        if (!id || !size) {
            break;
        }
        const start = offset + id.length + size.length;
        // An unknown size (a live muxer's Segment or Cluster) runs to the end of its parent.
        const end = size.unknown ? to : start + size.value;
        if (end > to) {
            break;
        }
        elements.push({ id: id.value, start, end });
        if (id.value === EBML_CLUSTER) {
            // Tracks are declared before the first cluster; the rest of the file is frames.
            break;
        }
        offset = end;
    }
    return elements;
}

function readUint(bytes: Uint8Array, element: Element): number {
    let value = 0;
    for (let offset = element.start; offset < element.end; offset++) {
        value = value * 256 + bytes[offset];
    }
    return value;
}

function readFloat(bytes: Uint8Array, element: Element): number {
    const view = new DataView(bytes.buffer, bytes.byteOffset + element.start, element.end - element.start);
    if (view.byteLength === 4) {
        return view.getFloat32(0);
    }
    return view.byteLength === 8 ? view.getFloat64(0) : Number.NaN;
}

function readMatroskaFrameRate(bytes: Uint8Array): number | null {
    const segment = elementsIn(bytes, 0, bytes.byteLength).find(element => element.id === EBML_SEGMENT);
    if (!segment) {
        return null;
    }
    const tracks = elementsIn(bytes, segment.start, segment.end).find(element => element.id === EBML_TRACKS);
    if (!tracks) {
        return null;
    }
    for (const entry of elementsIn(bytes, tracks.start, tracks.end)) {
        if (entry.id !== EBML_TRACK_ENTRY) {
            continue;
        }
        const fields = elementsIn(bytes, entry.start, entry.end);
        const type = fields.find(field => field.id === EBML_TRACK_TYPE);
        if (!type || readUint(bytes, type) !== 1) {
            continue;
        }
        const defaultDuration = fields.find(field => field.id === EBML_DEFAULT_DURATION);
        if (defaultDuration) {
            const nanoseconds = readUint(bytes, defaultDuration);
            if (nanoseconds > 0) {
                return plausible(1e9 / nanoseconds);
            }
        }
        const video = fields.find(field => field.id === EBML_VIDEO);
        const frameRate = video && elementsIn(bytes, video.start, video.end).find(field => field.id === EBML_FRAME_RATE);
        if (frameRate) {
            return plausible(readFloat(bytes, frameRate));
        }
    }
    return null;
}

// ---- measured ---------------------------------------------------------------

/**
 * The rate implied by the intervals between frames the player presented, or `null` until there are
 * enough of them to trust.
 *
 * The median, not the mean: a frame the compositor was late for shows up as one double-length
 * interval, and a mean would drag the whole estimate toward it. Snapped to a broadcast rate when it
 * lands that close, so 29.97 reads as 29.97 rather than 29.968.
 */
export function estimateFrameRate(intervals: readonly number[]): number | null {
    const usable = intervals.filter(interval => Number.isFinite(interval) && interval > 0).sort((a, b) => a - b);
    if (usable.length < MIN_MEASURED_INTERVALS) {
        return null;
    }
    const middle = usable.length >> 1;
    const median = usable.length % 2 === 1 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
    const rate = 1 / median;
    const nearest = COMMON_RATES.reduce((best, common) =>
        Math.abs(common - rate) < Math.abs(best - rate) ? common : best);
    return plausible(Math.abs(nearest - rate) / nearest <= SNAP_TOLERANCE ? nearest : rate);
}

/** `29.97`, `30`, `23.98` - two decimals at most, trailing zeros dropped. */
export function formatFrameRate(rate: number): string {
    return String(Number(rate.toFixed(2)));
}

// ---- frame arithmetic ---------------------------------------------------------

/** The frame shown at `seconds`, counting from zero. */
export function frameIndexAt(seconds: number, rate: number): number {
    // A frame's start time arrives rounded: the player reports it to the microsecond, so frame 2 at
    // 30000/1001 is 0.066733 s rather than 0.0667333..., and 0.066733 x 29.97 floors to frame 1. A
    // thousandth of a frame absorbs that rounding and is far below any time an author can point at.
    return Math.max(0, Math.floor(seconds * rate + 1e-3));
}

/** Frames in a clip whose container did not list them: its duration at its rate. */
export function frameCount(durationSeconds: number, rate: number): number {
    return Math.max(1, Math.round(durationSeconds * rate));
}

/**
 * Where to seek to show frame `index`: the middle of it, not its first instant.
 *
 * A seek to a frame's exact start is a coin toss between it and the one before, because the time is
 * rounded into the stream's own timescale on the way in. The midpoint is a full half-frame away from
 * either neighbour.
 */
export function frameSeekTime(index: number, rate: number, totalFrames: number): number {
    const clamped = Math.max(0, Math.min(totalFrames - 1, index));
    return (clamped + 0.5) / rate;
}
