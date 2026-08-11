import type { DocumentChange } from "@shared/documents/diff";
import { readImageDimensions } from "@shared/utils/imageDimensions";
import { readFontHeader, readMediaHeader } from "@shared/utils/mediaHeader";
import type { ContentClass } from "@shared/vcs/contentClass";

/**
 * Describing two versions of a file **without reading it**.
 *
 * The tier that exists because the old answer for an asset was a sentence the tree already
 * knew: an author who re-exported a 200 MB video was told "changed, 209715200 -> 209800000
 * bytes", and producing that cost both sides being pulled into main-process memory. A
 * revision's tree walk already hands over every file's size and content address
 * (`revisionReader.listFilesAt`), so the sentence was free all along and the read bought
 * nothing.
 *
 * ## Two phases, and the shape is the contract
 *
 * A provider is asked for its verdict from a {@link ContentProbe} - size and content address,
 * both already in hand - plus, only if it asks for them, a bounded prefix of the file. Nothing
 * here may request the whole file, and a provider whose {@link ContentDiffProvider.headBytes}
 * is zero is one that never causes a byte to be read at all.
 *
 * **Head bytes are not always available, and that is not a failure.** On the working-tree side
 * a prefix is a ranged `fs.read` and genuinely costs a few kilobytes. On the revision side the
 * backend has **no ranged fetch** - `storageGet` answers with the whole blob or nothing - so a
 * prefix there costs the whole file, and the caller only pays it for files small enough to be
 * worth it. Every provider therefore has to answer usefully from the probe alone, and each
 * field it reports is conditional on having seen the bytes that carry it.
 *
 * ## What a provider may claim
 *
 * The class handed in is a guess from the file's name (`shared/vcs/contentClass.ts`); the
 * bytes are the evidence. So a provider confirms the format from the header and reports
 * nothing when the header is not what the name promised - which is how a `.png` that is
 * really a JPEG still gets its dimensions, and how a `.mp4` whose index sits at the end of
 * the file says "changed" rather than inventing a duration.
 */

/** What is known about one side without opening it. Both fields come from the tree walk. */
export interface ContentProbe {
    readonly size: number;
    /** Content address; equal on both sides means the same bytes. */
    readonly hash?: string;
}

/** One side of a comparison: what is known, plus the prefix that was affordable to read. */
export interface ContentSide {
    readonly probe: ContentProbe;
    /**
     * The first {@link ContentDiffProvider.headBytes} bytes, when the caller could get them.
     *
     * Absent is ordinary - see the note on this module - and a provider must degrade to what
     * the probe says rather than treat it as an error.
     */
    readonly head?: Buffer;
}

export interface ContentDiffProvider {
    readonly id: string;
    matches(path: string, contentClass: ContentClass): boolean;
    /** Upper bound on the prefix this provider wants. Zero means it needs no bytes at all. */
    readonly headBytes: number;
    /** Both sides' probes, and their prefixes where there are any, as change rows. */
    describe(a: ContentSide | null, b: ContentSide | null): readonly DocumentChange[];
}

/**
 * The largest prefix any provider may ask for.
 *
 * 64 KiB because that is the size of one JPEG application segment, which is the biggest single
 * thing that can sit between the start of a file and the header being looked for. Every
 * provider below asks for less; this is the ceiling the caller budgets against, not a target.
 */
export const CONTENT_HEAD_BYTE_CEILING = 64 * 1024;

/** Label keys this module produces. The `documentDiff.content.` namespace is this tier's. */
const LABEL_SIZE = "documentDiff.content.size";
const LABEL_DIMENSIONS = "documentDiff.content.dimensions";
const LABEL_DURATION = "documentDiff.content.duration";
const LABEL_SAMPLE_RATE = "documentDiff.content.sampleRate";
const LABEL_FAMILY = "documentDiff.content.family";
const LABEL_CHANGED = "documentDiff.content.changed";
const LABEL_UNRECOGNIZED = "documentDiff.content.unrecognized";
const LABEL_NOT_INSPECTED = "documentDiff.content.notInspected";
export const LABEL_MOVED = "documentDiff.content.moved";

/* ---------------------------------------------------------------------------------------- */
/* Rows                                                                                       */
/* ---------------------------------------------------------------------------------------- */

/**
 * The size row, which every provider ends with.
 *
 * Last rather than first, and the order matters: {@link import("@shared/documents/diff").buildDocumentDiff}
 * truncates from the end of the list it is given, so the rows are built in the order an author
 * would want them kept. A resolution that changed is what breaks a layout; a file being 4 KB
 * bigger is the least of it.
 */
function sizeRow(a: ContentProbe, b: ContentProbe): DocumentChange[] {
    if (a.size === b.size) {
        return [];
    }
    return [{
        path: ["size"],
        kind: "changed",
        label: { key: LABEL_SIZE, params: { fromBytes: a.size, toBytes: b.size } },
    }];
}

function dimensionRow(
    a: { width: number; height: number } | undefined,
    b: { width: number; height: number } | undefined,
): DocumentChange[] {
    if (!a || !b || (a.width === b.width && a.height === b.height)) {
        return [];
    }
    return [{
        path: ["dimensions"],
        kind: "changed",
        label: {
            key: LABEL_DIMENSIONS,
            params: { fromWidth: a.width, fromHeight: a.height, toWidth: b.width, toHeight: b.height },
        },
    }];
}

/** Seconds to one decimal, which is as much as a header's own precision supports. */
function seconds(milliseconds: number): number {
    return Math.round(milliseconds / 100) / 10;
}

function durationRow(a: number | undefined, b: number | undefined): DocumentChange[] {
    if (a === undefined || b === undefined || seconds(a) === seconds(b)) {
        return [];
    }
    return [{
        path: ["duration"],
        kind: "changed",
        label: { key: LABEL_DURATION, params: { fromSeconds: seconds(a), toSeconds: seconds(b) } },
    }];
}

/**
 * A row saying the bytes differ and nothing more specific could be said.
 *
 * Three reasons produce it and they are told apart because they are three different facts: a
 * header that WAS read and reports the same numbers ({@link LABEL_CHANGED}); a format nobody
 * here parses, which will never say more ({@link LABEL_UNRECOGNIZED}); and a header this
 * comparison decided not to spend bytes on ({@link LABEL_NOT_INSPECTED}). Collapsing them
 * would leave an author unable to tell a permanent limit from a budget.
 */
function opaqueRow(key: string): DocumentChange {
    return { path: [], kind: "changed", label: { key } };
}

/** What to say when a provider found nothing to report: it depends on whether it could look. */
function nothingToReport(read: boolean): DocumentChange[] {
    return [opaqueRow(read ? LABEL_CHANGED : LABEL_NOT_INSPECTED)];
}

/* ---------------------------------------------------------------------------------------- */
/* Providers                                                                                  */
/* ---------------------------------------------------------------------------------------- */

/**
 * Stills.
 *
 * Dimensions come from `shared/utils/imageDimensions.ts` rather than from a second reader
 * here, which is why they are reported for PNG, JPEG and WebP and not for GIF, BMP or TIFF:
 * one header reader that is used everywhere beats two that agree until they do not. The
 * dimension row is separate from the size row on purpose - a re-export at the same size is a
 * detail, and a sprite that is suddenly half as wide is a broken scene.
 */
const bitmapProvider: ContentDiffProvider = {
    id: "bitmap",
    headBytes: CONTENT_HEAD_BYTE_CEILING,
    matches: (_path, contentClass) => contentClass === "bitmap",
    describe(a, b) {
        const pair = bothSides(a, b);
        if (!pair) return [];
        const before = pair.a.head ? readImageDimensions(pair.a.head) : null;
        const after = pair.b.head ? readImageDimensions(pair.b.head) : null;
        const rows = [
            ...dimensionRow(before ?? undefined, after ?? undefined),
            ...sizeRow(pair.a.probe, pair.b.probe),
        ];
        return rows.length > 0 ? rows : nothingToReport(Boolean(before && after));
    },
};

/**
 * Sound.
 *
 * 16 KiB reaches a WAVE `fmt ` chunk, a FLAC STREAMINFO, an Ogg identification page and an MP3
 * frame past a large ID3 tag. It does not reach the end of an Ogg stream, which is where its
 * length lives - so an Ogg file reports a sample rate and no duration, and that is the honest
 * answer rather than an estimate from a bitrate hint that is wrong for every variable-bitrate
 * file.
 */
const audioProvider: ContentDiffProvider = {
    id: "audio",
    headBytes: 16 * 1024,
    matches: (_path, contentClass) => contentClass === "audio",
    describe(a, b) {
        const pair = bothSides(a, b);
        if (!pair) return [];
        const before = headerOf(pair.a);
        const after = headerOf(pair.b);
        const rows = [
            ...durationRow(before?.durationMs, after?.durationMs),
            ...rateRow(before?.sampleRate, after?.sampleRate),
            ...sizeRow(pair.a.probe, pair.b.probe),
        ];
        return rows.length > 0 ? rows : nothingToReport(Boolean(before && after));
    },
};

function rateRow(a: number | undefined, b: number | undefined): DocumentChange[] {
    if (a === undefined || b === undefined || a === b) {
        return [];
    }
    return [{
        path: ["sampleRate"],
        kind: "changed",
        label: { key: LABEL_SAMPLE_RATE, params: { fromHertz: a, toHertz: b } },
    }];
}

/**
 * Moving pictures.
 *
 * An MP4 written without a faststart pass keeps its index behind the media data, hundreds of
 * megabytes past anything this reads, so a resolution and a duration are reported when they
 * happen to be at the front and never guessed when they are not.
 */
const videoProvider: ContentDiffProvider = {
    id: "video",
    headBytes: CONTENT_HEAD_BYTE_CEILING,
    matches: (_path, contentClass) => contentClass === "video",
    describe(a, b) {
        const pair = bothSides(a, b);
        if (!pair) return [];
        const before = headerOf(pair.a);
        const after = headerOf(pair.b);
        const rows = [
            ...dimensionRow(framesOf(before), framesOf(after)),
            ...durationRow(before?.durationMs, after?.durationMs),
            ...sizeRow(pair.a.probe, pair.b.probe),
        ];
        return rows.length > 0 ? rows : nothingToReport(Boolean(before && after));
    },
};

function framesOf(
    header: { width?: number; height?: number } | null | undefined,
): { width: number; height: number } | undefined {
    return header?.width && header.height ? { width: header.width, height: header.height } : undefined;
}

/**
 * Fonts.
 *
 * The family is reported when the `name` table falls inside the prefix, which is not always:
 * an sfnt may write its tables in any order, so a large font can put its glyph outlines first
 * and its names past any bounded read. WOFF and WOFF2 never report one at all, because their
 * tables are compressed and inflating repository bytes to read a string is the sort of thing
 * a header-only reader exists to avoid.
 */
const fontProvider: ContentDiffProvider = {
    id: "font",
    headBytes: CONTENT_HEAD_BYTE_CEILING,
    matches: (_path, contentClass) => contentClass === "font",
    describe(a, b) {
        const pair = bothSides(a, b);
        if (!pair) return [];
        const before = pair.a.head ? readFontHeader(pair.a.head) : null;
        const after = pair.b.head ? readFontHeader(pair.b.head) : null;
        const rows: DocumentChange[] = [];
        if (before?.family && after?.family && before.family !== after.family) {
            rows.push({
                path: ["family"],
                kind: "changed",
                label: { key: LABEL_FAMILY, params: { from: before.family, to: after.family } },
                // The family is a string out of the author's own file, which is what `subject`
                // is defined to carry - unlike a dimension, which Studio computed.
                subject: after.family,
            });
        }
        rows.push(...sizeRow(pair.a.probe, pair.b.probe));
        return rows.length > 0 ? rows : nothingToReport(Boolean(before && after));
    },
};

/**
 * Model binaries, which read no bytes at all.
 *
 * `headBytes: 0` is a design statement rather than a shortcut: `shared/utils/modelBundle.ts`
 * says as a rule that Studio must never learn to read `.moc3` or `.skel`, because a model's
 * manifest names its siblings by relative path and the moment Studio parses one it owns every
 * model format there is. So the honest answer here is the size, and there will never be
 * another.
 */
const modelProvider: ContentDiffProvider = {
    id: "model",
    headBytes: 0,
    matches: (_path, contentClass) => contentClass === "model",
    describe(a, b) {
        const pair = bothSides(a, b);
        if (!pair) return [];
        const rows = sizeRow(pair.a.probe, pair.b.probe);
        return rows.length > 0 ? rows : [opaqueRow(LABEL_UNRECOGNIZED)];
    },
};

/**
 * A file whose name Studio does not recognise at all.
 *
 * Distinct from {@link opaqueProvider} below, which covers a path whose kind IS known and whose
 * header this comparison chose not to spend bytes on. The two sentences are different facts and
 * only one of them is permanent.
 */
const unknownProvider: ContentDiffProvider = {
    id: "unknown",
    headBytes: 0,
    matches: (_path, contentClass) => contentClass === "unknown",
    describe(a, b) {
        const pair = bothSides(a, b);
        if (!pair) return [];
        return [opaqueRow(LABEL_UNRECOGNIZED), ...sizeRow(pair.a.probe, pair.b.probe)];
    },
};

/**
 * The catch-all, so the registry is total.
 *
 * Reached by a path whose class says its bytes are worth reading - `text`, mostly - that some
 * budget declined to read. Saying "Studio does not recognise this format" about an author's
 * `.txt` would be false; saying its header was not read is exactly what happened.
 */
const opaqueProvider: ContentDiffProvider = {
    id: "opaque",
    headBytes: 0,
    matches: () => true,
    describe(a, b) {
        const pair = bothSides(a, b);
        if (!pair) return [];
        return [opaqueRow(LABEL_NOT_INSPECTED), ...sizeRow(pair.a.probe, pair.b.probe)];
    },
};

/**
 * The registry, in match order.
 *
 * {@link opaqueProvider} is last and matches everything, so {@link contentProviderFor} is
 * total - there is no path with no provider, and no caller has to have a fallback of its own.
 */
export const CONTENT_DIFF_PROVIDERS: readonly ContentDiffProvider[] = [
    bitmapProvider,
    audioProvider,
    videoProvider,
    fontProvider,
    modelProvider,
    unknownProvider,
    opaqueProvider,
];

/** The provider that will describe this path. Never undefined; see the note on the registry. */
export function contentProviderFor(path: string, contentClass: ContentClass): ContentDiffProvider {
    return CONTENT_DIFF_PROVIDERS.find((provider) => provider.matches(path, contentClass)) ?? opaqueProvider;
}

/**
 * Both sides, or nothing.
 *
 * A file that exists on one side only is an addition or a removal, which the caller has
 * already said in the entry's own `kind`. Listing every header field of a new file as a change
 * would spend a budget restating one act - the same call `presenceDiff` makes in
 * `documentDiff.ts`.
 */
function bothSides(
    a: ContentSide | null,
    b: ContentSide | null,
): { a: ContentSide; b: ContentSide } | null {
    return a && b ? { a, b } : null;
}

function headerOf(side: ContentSide): ReturnType<typeof readMediaHeader> {
    return side.head ? readMediaHeader(side.head, side.probe.size) : null;
}

/**
 * Whether two probes describe the same bytes.
 *
 * **`hash` and not `context`, and that is measured rather than assumed.** A backend address has
 * two halves and they are not the same kind of thing: on a real repository, two files holding
 * identical bytes at unrelated paths report the same `hash` and *different* contexts - the
 * context looks like a per-entry generated id, not a digest. Comparing it here would mean this
 * predicate answered false for every rename there has ever been, silently. The experiment is
 * `revisionReader.integration.test.ts`, "what a content address means", which also pins the
 * other direction: different contents, different hashes, including at identical sizes.
 *
 * The size is required as well, at no cost, because it is the one field a caller can always
 * supply and it makes a hash collision need a length collision too. A probe with no hash at all
 * - which is every working-tree file, since nothing on disk carries a backend address - can
 * never match, and must not: a length is not evidence of anything.
 */
export function probesMatch(a: ContentProbe | undefined, b: ContentProbe | undefined): boolean {
    // An empty file is excluded, and not because two of them differ - they do not. Emptiness is
    // simply not evidence of identity: delete four empty placeholders, add three more, and every
    // one of the twelve possible pairings is equally supported, so whichever this returned would
    // be an invention presented to the author as a fact about where their file went.
    return Boolean(a && b && a.size > 0 && a.hash && b.hash && a.hash === b.hash && a.size === b.size);
}

/**
 * Pair the removals and additions that are the same bytes under two names.
 *
 * The backend reports a rename as a delete plus an add and nothing links them
 * (docs/version-control.md §4.18: `summary.moves` is zero and `fromPath` is empty), so an
 * author who tidies `assets/content/` once produces several hundred rows of which none is
 * true - nothing was added and nothing was lost.
 *
 * Matching is on {@link probesMatch}, so it costs no reads at all: both sides' sizes and
 * content addresses came out of the tree walk.
 *
 * **Ambiguity is resolved by sorting, not by cleverness.** Several files really can hold
 * identical bytes - two empty placeholders, the same texture under two names - and there is no
 * fact anywhere that says which removal became which addition. Both lists are walked in path
 * order and paired greedily, which is arbitrary but *stable*: the same comparison answers the
 * same way every time, which is what stops a change list from reshuffling between two reads of
 * the same pair of versions.
 *
 * @returns added path -> the removed path it came from.
 */
export function pairMoves(
    removed: ReadonlyMap<string, ContentProbe>,
    added: ReadonlyMap<string, ContentProbe>,
): Map<string, string> {
    const byContent = new Map<string, string[]>();
    for (const path of [...removed.keys()].sort()) {
        const probe = removed.get(path);
        if (!probe?.hash) continue;
        const key = `${probe.hash}:${probe.size}`;
        byContent.set(key, [...(byContent.get(key) ?? []), path]);
    }

    const pairs = new Map<string, string>();
    for (const path of [...added.keys()].sort()) {
        const probe = added.get(path);
        if (!probe?.hash) continue;
        const candidates = byContent.get(`${probe.hash}:${probe.size}`);
        const source = candidates?.shift();
        // `probesMatch` rather than trusting the key: the key is built from the same two
        // fields, and going through the predicate keeps the definition of "same bytes" in one
        // place rather than in two spellings that can drift.
        if (source && probesMatch(removed.get(source), probe)) {
            pairs.set(path, source);
        }
    }
    return pairs;
}
