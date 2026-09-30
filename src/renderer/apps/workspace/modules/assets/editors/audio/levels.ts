import { clipLength, type AudioClip } from "./audioClip";

/**
 * Level facts about a whole clip: how loud it peaks, how loud it sounds, how much silence pads
 * either end, and whether it clips.
 *
 * All four are read off the decoded samples the preview already holds, so nothing here touches the
 * file. They answer the questions an author meets when two clips are placed side by side in a scene:
 * one BGM plays noticeably louder than the next, a voice line starts late because the take has a
 * second of room tone in front of it, a master was limited into the ceiling.
 */
export interface ClipLevels {
    /** Highest absolute sample value on any channel, in dBFS. `-Infinity` for a silent clip. */
    peakDb: number;
    /**
     * Integrated loudness in LUFS (ITU-R BS.1770-4, gated). `null` when the clip is shorter than one
     * 400 ms measurement block, or when every block falls under the absolute gate.
     */
    loudnessLufs: number | null;
    /** Seconds before the first sample above {@link SILENCE_THRESHOLD}. The whole clip when none is. */
    leadingSilenceSeconds: number;
    /** Seconds after the last sample above {@link SILENCE_THRESHOLD}. The whole clip when none is. */
    trailingSilenceSeconds: number;
    /**
     * Places the signal clips, counted per channel: a flat run pinned at full scale, or any run that
     * goes past it. The second is common in lossy files - a master limited to 0 dBFS decodes a little
     * over it - and it clips just the same once the samples reach the output.
     */
    clippedRuns: number;
}

/** -60 dBFS. Room tone and dither sit below it; the softest intended sound in a mix does not. */
export const SILENCE_THRESHOLD = 0.001;

/**
 * A sample this close to full scale counts as pinned there. Just under 1 rather than 1 itself: a
 * decoder converting from integer PCM lands a clipped sample on 32767/32768, not on 1.0.
 */
const CLIP_LEVEL = 0.999;

/**
 * How many pinned samples in a row make a clip. One sample at the ceiling is a peak normalised to
 * 0 dBFS; a flat run is a waveform that wanted to go further. Three is the run Audacity's Find
 * Clipping starts at, which keeps normalised masters out and limiter overshoot in. A run with any
 * sample past full scale counts whatever its length: nothing downstream can play that sample.
 */
const CLIP_RUN = 3;

const BLOCK_SECONDS = 0.4;
const STEP_SECONDS = 0.1;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;

interface Biquad {
    b0: number;
    b1: number;
    b2: number;
    a1: number;
    a2: number;
}

/**
 * The two stages of the BS.1770 K-weighting filter at an arbitrary sample rate: a high shelf for
 * the head's acoustic effect, then a high-pass. The standard only tabulates 48 kHz coefficients;
 * these are the analogue-prototype constants libebur128 derives them from, which reproduce that
 * table exactly at 48 kHz and give the matching filter at 44.1 kHz and everything else.
 */
export function kWeightingFilters(sampleRate: number): [Biquad, Biquad] {
    const shelfF0 = 1681.974450955533;
    const shelfGainDb = 3.999843853973347;
    const shelfQ = 0.7071752369554196;
    const k1 = Math.tan((Math.PI * shelfF0) / sampleRate);
    const vh = Math.pow(10, shelfGainDb / 20);
    const vb = Math.pow(vh, 0.4996667741545416);
    const shelfA0 = 1 + k1 / shelfQ + k1 * k1;
    const shelf: Biquad = {
        b0: (vh + (vb * k1) / shelfQ + k1 * k1) / shelfA0,
        b1: (2 * (k1 * k1 - vh)) / shelfA0,
        b2: (vh - (vb * k1) / shelfQ + k1 * k1) / shelfA0,
        a1: (2 * (k1 * k1 - 1)) / shelfA0,
        a2: (1 - k1 / shelfQ + k1 * k1) / shelfA0,
    };

    const passF0 = 38.13547087602444;
    const passQ = 0.5003270373238773;
    const k2 = Math.tan((Math.PI * passF0) / sampleRate);
    const passA0 = 1 + k2 / passQ + k2 * k2;
    const highPass: Biquad = {
        b0: 1,
        b1: -2,
        b2: 1,
        a1: (2 * (k2 * k2 - 1)) / passA0,
        a2: (1 - k2 / passQ + k2 * k2) / passA0,
    };
    return [shelf, highPass];
}

/**
 * Per-channel weight in the loudness sum. Surround channels count 1.41, the LFE not at all; mono
 * and stereo are weighted 1 throughout, which is every clip a visual novel is likely to hold.
 */
function channelWeights(channelCount: number): number[] {
    if (channelCount === 6) {
        // L R C LFE Ls Rs
        return [1, 1, 1, 0, 1.41, 1.41];
    }
    if (channelCount === 5) {
        return [1, 1, 1, 1.41, 1.41];
    }
    return new Array<number>(channelCount).fill(1);
}

/** Samples scanned between yields, per channel: a few milliseconds of work. */
const SAMPLES_PER_SLICE = 1 << 17;

function blockLoudness(power: number): number {
    return -0.691 + 10 * Math.log10(power);
}

/**
 * Integrated loudness from the K-weighted energy of each channel's 100 ms segments (BS.1770-4:
 * 400 ms blocks, 75% overlap, absolute then relative gate).
 *
 * The gating blocks are 400 ms long and start every 100 ms, so each one is exactly four segments -
 * which is what lets the whole measurement ride along the single pass that finds the peak.
 */
function gatedLoudness(perChannel: Float64Array[], weights: number[], segmentLength: number): number | null {
    const segmentsPerBlock = Math.round(BLOCK_SECONDS / STEP_SECONDS);
    const blockLength = segmentLength * segmentsPerBlock;
    const segments = perChannel[0]?.length ?? 0;
    const blockCount = segments - segmentsPerBlock + 1;
    if (blockCount <= 0) {
        return null;
    }

    const blockPower = new Float64Array(blockCount);
    for (let block = 0; block < blockCount; block++) {
        let power = 0;
        perChannel.forEach((energy, channel) => {
            const weight = weights[channel] ?? 1;
            if (weight === 0) {
                return;
            }
            let sum = 0;
            for (let segment = block; segment < block + segmentsPerBlock; segment++) {
                sum += energy[segment];
            }
            power += weight * (sum / blockLength);
        });
        blockPower[block] = power;
    }

    const gatedMean = (threshold: number): number | null => {
        let total = 0;
        let count = 0;
        for (const power of blockPower) {
            if (power > 0 && blockLoudness(power) > threshold) {
                total += power;
                count++;
            }
        }
        return count === 0 ? null : total / count;
    };

    const absolute = gatedMean(ABSOLUTE_GATE_LUFS);
    if (absolute === null) {
        return null;
    }
    const relativeGate = blockLoudness(absolute) + RELATIVE_GATE_LU;
    const relative = gatedMean(Math.max(ABSOLUTE_GATE_LUFS, relativeGate));
    return relative === null ? null : blockLoudness(relative);
}

/** Totals across every channel. */
interface ClipScan {
    peak: number;
    firstAudible: number;
    lastAudible: number;
    clippedRuns: number;
    /** Consecutive samples at full scale at the end of the last slice of the current channel. */
    run: number;
    /** Whether that run has already been counted. */
    runCounted: boolean;
}

/** Peak, silence and clipping over one slice of one channel. */
function scanAmplitude(samples: Float32Array, from: number, to: number, totals: ClipScan): void {
    let { peak, firstAudible, lastAudible, clippedRuns, run, runCounted } = totals;
    for (let index = from; index < to; index++) {
        const x = samples[index];
        const magnitude = x < 0 ? -x : x;
        if (magnitude > peak) {
            peak = magnitude;
        }
        if (magnitude > SILENCE_THRESHOLD) {
            if (firstAudible === -1 || index < firstAudible) {
                firstAudible = index;
            }
            if (index > lastAudible) {
                lastAudible = index;
            }
        }
        if (magnitude >= CLIP_LEVEL) {
            // Counted once per run, on the first sample that qualifies it.
            run++;
            if (!runCounted && (run >= CLIP_RUN || magnitude > 1)) {
                clippedRuns++;
                runCounted = true;
            }
        } else {
            run = 0;
            runCounted = false;
        }
    }
    totals.peak = peak;
    totals.firstAudible = firstAudible;
    totals.lastAudible = lastAudible;
    totals.clippedRuns = clippedRuns;
    totals.run = run;
    totals.runCounted = runCounted;
}

/** Indices into a channel's filter state: both stages' direct form I history, then the segment. */
const X1 = 0, X2 = 1, Y1 = 2, Y2 = 3, Z1 = 4, Z2 = 5, SEGMENT = 6, FILL = 7, ENERGY = 8;
const FILTER_STATE_SIZE = 9;

/**
 * K-weight one slice of one channel and add its energy to the 100 ms segments.
 *
 * The filter history is carried between slices in `state`, a typed array rather than an object so
 * that reading it in and writing it back costs nothing a hot loop would notice.
 */
function filterSlice(
    samples: Float32Array,
    from: number,
    to: number,
    filters: [Biquad, Biquad],
    segmentLength: number,
    energy: Float64Array,
    state: Float64Array,
): void {
    const [shelf, highPass] = filters;
    const sb0 = shelf.b0, sb1 = shelf.b1, sb2 = shelf.b2, sa1 = shelf.a1, sa2 = shelf.a2;
    const hb0 = highPass.b0, hb1 = highPass.b1, hb2 = highPass.b2, ha1 = highPass.a1, ha2 = highPass.a2;
    let x1 = state[X1], x2 = state[X2], y1 = state[Y1], y2 = state[Y2], z1 = state[Z1], z2 = state[Z2];
    let segment = state[SEGMENT], fill = state[FILL], sum = state[ENERGY];
    const segmentCount = energy.length;
    for (let index = from; index < to; index++) {
        const x = samples[index];
        const y = sb0 * x + sb1 * x1 + sb2 * x2 - sa1 * y1 - sa2 * y2;
        x2 = x1;
        x1 = x;
        const z = hb0 * y + hb1 * y1 + hb2 * y2 - ha1 * z1 - ha2 * z2;
        y2 = y1;
        y1 = y;
        z2 = z1;
        z1 = z;
        sum += z * z;
        if (++fill === segmentLength) {
            // The trailing partial segment belongs to no full block, so it never lands.
            if (segment < segmentCount) {
                energy[segment] = sum;
            }
            segment++;
            fill = 0;
            sum = 0;
        }
    }
    state[X1] = x1; state[X2] = x2; state[Y1] = y1; state[Y2] = y2; state[Z1] = z1; state[Z2] = z2;
    state[SEGMENT] = segment; state[FILL] = fill; state[ENERGY] = sum;
}

/**
 * The measurement, as a generator that yields between slices of samples.
 *
 * A four-minute stereo clip is twenty-five million samples, and one pass over them costs a couple
 * of hundred milliseconds - a visible stall if it ran in one go right after the waveform appears.
 * Yielding lets {@link measureLevelsInSlices} spread it across tasks; {@link measureLevels} simply
 * runs it to the end.
 */
export function* levelMeasurement(clip: AudioClip): Generator<void, ClipLevels> {
    const length = clipLength(clip);
    const duration = length / clip.sampleRate;
    const segmentLength = Math.round(clip.sampleRate * STEP_SECONDS);
    const segmentCount = segmentLength > 0 ? Math.floor(length / segmentLength) : 0;
    const filters = kWeightingFilters(clip.sampleRate);
    const totals: ClipScan = { peak: 0, firstAudible: -1, lastAudible: -1, clippedRuns: 0, run: 0, runCounted: false };
    const perChannel: Float64Array[] = [];

    for (const samples of clip.channels) {
        const energy = new Float64Array(segmentCount);
        const state = new Float64Array(FILTER_STATE_SIZE);
        perChannel.push(energy);
        totals.run = 0;
        totals.runCounted = false;
        for (let from = 0; from < length; from += SAMPLES_PER_SLICE) {
            const to = Math.min(length, from + SAMPLES_PER_SLICE);
            scanAmplitude(samples, from, to, totals);
            if (segmentLength > 0) {
                filterSlice(samples, from, to, filters, segmentLength, energy, state);
            }
            yield;
        }
    }

    const { peak, firstAudible, lastAudible, clippedRuns } = totals;
    const audible = firstAudible !== -1;
    return {
        peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
        loudnessLufs: segmentLength > 0 ? gatedLoudness(perChannel, channelWeights(clip.channels.length), segmentLength) : null,
        leadingSilenceSeconds: audible ? firstAudible / clip.sampleRate : duration,
        trailingSilenceSeconds: audible ? (length - 1 - lastAudible) / clip.sampleRate : duration,
        clippedRuns,
    };
}

/** The whole measurement at once. */
export function measureLevels(clip: AudioClip): ClipLevels {
    const steps = levelMeasurement(clip);
    for (;;) {
        const next = steps.next();
        if (next.done) {
            return next.value;
        }
    }
}

/** Integrated loudness alone. */
export function integratedLoudness(clip: AudioClip): number | null {
    return measureLevels(clip).loudnessLufs;
}

/** How long one task may run slices before handing the thread back. Half a 60 Hz frame. */
const TASK_BUDGET_MS = 8;

/**
 * Run the measurement a few slices per task, so the clip's first paint and the author's first
 * clicks are not queued behind it. Resolves `null` once `signal` aborts - a different clip has been
 * loaded, or the editor has closed.
 */
export async function measureLevelsInSlices(clip: AudioClip, signal: AbortSignal): Promise<ClipLevels | null> {
    const steps = levelMeasurement(clip);
    for (;;) {
        if (signal.aborted) {
            return null;
        }
        const taskStart = performance.now();
        do {
            const next = steps.next();
            if (next.done) {
                return next.value;
            }
        } while (performance.now() - taskStart < TASK_BUDGET_MS);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
}
