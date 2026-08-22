import {
    buildDocumentDiff,
    countDocumentChanges,
    type DocumentChange,
    type DocumentDiff,
    type DocumentDiffTier,
} from "@shared/documents/diff";
import {
    assembleDocumentSet,
    documentSetPartsFrom,
    type AnyDocumentSetSpec,
} from "@shared/documents/documentSet";
import { diffJsonStructural } from "@shared/documents/jsonStructuralDiff";
import { resolveDocumentSpecForPath } from "@shared/documents/registry";
// Imported for its side effect, and this line is the reason the semantic tier exists at all:
// specs register themselves when this module is evaluated (see the note at the bottom of
// `specs/index.ts` for why registration is on import), and until now every importer of it was a
// RENDERER service. In the main process the registry was therefore empty and every lookup answered
// `undefined` - which is also the ordinary answer for a path no spec claims, so semantic diff would
// have degraded to generic JSON for the whole project with nothing anywhere reporting it.
// `documentRegistry.test.ts` asserts both halves: that this populates the registry, and that the
// main entry point statically reaches this module.
import "@shared/documents/specs";
import { DocumentCorruptError, type AnyDocumentSpec, type DocumentParseContext } from "@shared/documents/types";
import {
    contentClassIsReadable,
    contentClassOf,
    contentClassOfBytes,
    type ContentClass,
} from "@shared/vcs/contentClass";
import { contentProviderFor, type ContentSide } from "./contentDiff";

/**
 * Turning two versions of one file into changes an author can read.
 *
 * Pure strategy and nothing else: no Lore, no filesystem, no logging. It is handed
 * bytes and a spec and it answers a {@link DocumentDiff}. Everything about WHERE the
 * bytes came from - which revision, which working tree, which read failed - belongs to
 * `revisionDiff.ts` and `workingTreeDiff.ts`, and keeping it out of here is what lets
 * this be tested without a repository and reused by the resolve flow, which will hold
 * three sides rather than two.
 *
 * The resolution tiers, in the order they are tried:
 *
 * | tier | when | what the author gets |
 * |---|---|---|
 * | `semantic` | the spec implements `diff` | "scene Prologue gained 3 lines" |
 * | `summary` | a spec, but no `diff` | both sides summarised: "variables 12 -> 14" |
 * | `structural` | no spec, but both sides are JSON | the JSON paths whose values differ |
 * | content | an asset: a bitmap, sound, video, font or model | "1920x1080 -> 1280x720" |
 * | `opaque` | none of the above | added/removed/changed plus both sizes |
 *
 * **`content` is its own rung because reporting it as `opaque` put a false sentence on screen.**
 * `opaque`'s caption reads "Not read. Too large, not text, or unreadable. Only its size is
 * reported", and it sat directly above a row naming a bitmap's two resolutions. Both were true
 * of different things and the author had no way to tell which. So the rule is on the provider
 * rather than on the step: one that opens a header earns `content`, and one whose `headBytes`
 * is zero stays on `opaque`, where "only its size" is the whole truth.
 *
 * The content step reads no bytes of its own. It is handed a probe - the size and content
 * address the tree walk already produced - plus, where the caller could afford one, a few
 * kilobytes of header. See `contentDiff.ts` for why that split is the whole point.
 *
 * **Degrading is a normal outcome, never a failure.** A document a spec rejects as
 * corrupt falls to a lower tier and is reported through {@link DocumentDiffOptions.onDegrade};
 * it is not thrown (one throw here empties the whole change list, since every document
 * in a revision is diffed in one pass) and it is emphatically not quarantined - the
 * bytes came out of a revision, where they are the record of what the author committed.
 * Filing a revision's blob as corrupt would be filing a good file as bad, and there is
 * no way to un-file it.
 */

/**
 * Most changes anything will build for ONE document.
 *
 * Two hundred rows is already far more than a surface can show (the rail shows eight,
 * the tab pages), so this is not a display budget - it is the point past which building
 * more objects buys the author nothing and costs the main process real time.
 */
export const DOCUMENT_DIFF_CHANGE_LIMIT = 200;

/**
 * Largest single document either side may be before it is diffed as bytes.
 *
 * **Drawn from one data point, not measured across a corpus.** The only real fixture
 * anyone has profiled held 50 documents totalling 3.62 MiB
 * beside 73.78 MiB of assets - so the biggest document ever seen is a rounding error
 * against this, and nobody has yet opened a large story document from a real production.
 * It is a guardrail against parsing something enormous on the main process's only
 * thread, and it is meant to be re-set the first time a genuinely large project turns up
 * rather than defended as a measurement.
 */
export const DIFF_PARSE_BYTE_CEILING = 8 * 1024 * 1024;

/**
 * Total bytes one comparison will READ before the rest is reported without being opened.
 *
 * Same provenance and the same disclaimer as {@link DIFF_PARSE_BYTE_CEILING}.
 *
 * **It used to bound parsing rather than reading, and that was the defect.** The argument
 * was that a side is one batched call, so refusing half a batch would mean paying a tree walk
 * per piece - true of the old port, and it made the budget a thing that was checked once both
 * sides were already in main-process memory. It never prevented a read. Now the sizes come out
 * of the tree walk first (`revisionDiff.planReads`), the budget is spent against those, and no
 * second walk is needed because the walk and the reads are separate calls over one memo.
 */
export const DIFF_TOTAL_BYTE_BUDGET = 64 * 1024 * 1024;

/**
 * Largest file a working-tree comparison will pull **whole, from both sides** to decide whether
 * a removal and an addition are one rename.
 *
 * A judgement, not a measurement, and the same disclaimer as the two above. There is no cheaper
 * way to settle it: the recorded side has a content address and the working side has none, so
 * the only proof is the bytes, and half a proof is worse than none here - see the note on
 * `workingTreeDiff.ts`. Past this the two rows stand as they arrived.
 *
 * Set to the same 2 MiB as {@link CONTENT_HEAD_READ_CEILING} and for a related reason rather
 * than the same one: that is roughly where a file stops being a document or a sprite and starts
 * being a music track, a video or a model bundle. Below it a rename is the ordinary tidy-up this
 * pairing exists for; above it, folding a re-import into a "moved" row would cost hundreds of
 * megabytes on the chance that two large files are byte-identical.
 */
export const DIFF_MOVE_CONFIRM_BYTE_CEILING = 2 * 1024 * 1024;

/**
 * **Documents** one comparison will look inside at all.
 *
 * Past it every document is reported at tier 4 without being read. A comparison across
 * thousands of documents is an import or a restore rather than an edit, and there is nothing
 * useful to say about it document by document - the honest answer is the list of what
 * changed.
 *
 * **It used to count paths, and a document set is what showed that to be the wrong unit.** The
 * premise was that a file is a document, so two thousand files is two thousand documents and a
 * project past it is not being edited. Once one document can be many files the premise fails in
 * the direction that costs the most: four stories of five hundred and sixty scenes each are
 * 2,244 files and FOUR documents, and under the old rule every document in that project - every
 * character sheet, every translation, every asset - would come back uninspected because a story
 * the author had not touched happened to be large. The unit is now what
 * {@link import("@shared/documents/documentSet").foldDocumentSetPaths} answers with: a standalone
 * file is one, and a document set is one however many files it is. A project with no set
 * registered counts exactly what it counted before.
 *
 * The number is deliberately unchanged at 2,000. Raising it was the other way to absorb the same
 * arithmetic and it would have bought a project made of sets one more doubling before the same
 * thing happened again - the unit was wrong, not the number.
 */
export const DIFF_UNIT_LIMIT = 2000;

/**
 * Files one document set may be made of before a comparison stops assembling it.
 *
 * A set is read WHOLE or not at all - its `diff` is a whole-document function and there is no
 * half of it to run - so folding a set costs every member on both sides, including the ones that
 * did not change. That is the price of "this is one document", and this is where it stops being
 * worth paying: past it the set comes back as one row saying it changed and was not read, which
 * is a true sentence about a document with four thousand files in it, and the reason is reported
 * through {@link DocumentDiffOptions.onDegrade}.
 *
 * **One row, not a row per member.** Falling back to per-file rows would be the flood
 * {@link DIFF_UNIT_LIMIT} exists to prevent, arriving through the other door.
 *
 * A judgement on {@link DIFF_PARSE_BYTE_CEILING}'s terms rather than a measurement: the same
 * order as the whole-comparison budget above it, on the grounds that a document with more files
 * in it than a whole project's ordinary comparison is a restructure rather than an edit. The byte
 * ceiling applies to a set's TOTAL as well, and is the one that will bite first on real content.
 */
export const DOCUMENT_SET_MEMBER_LIMIT = 2000;

/** Label keys this module can produce. The `documentDiff.` namespace is D2's to translate. */
const LABEL_ADDED = "documentDiff.document.added";
const LABEL_REMOVED = "documentDiff.document.removed";
const LABEL_OPAQUE_CHANGED = "documentDiff.opaque.changed";
const LABEL_OPAQUE_UNREAD = "documentDiff.opaque.unread";
const LABEL_SUMMARY_TITLE = "documentDiff.summary.title";
const LABEL_SUMMARY_COUNT = "documentDiff.summary.count";
const LABEL_SUMMARY_OTHER = "documentDiff.summary.other";

export interface DocumentDiffRequest {
    /** Repository-relative, forward slashes. Only used to build a parse context's message. */
    readonly path: string;
    /** Bytes on the older side, or null when the document did not exist there. */
    readonly base: Buffer | null;
    readonly head: Buffer | null;
    /** The spec owning {@link path}, when one does - see {@link specForDocumentPath}. */
    readonly spec?: AnyDocumentSpec;
    /** Defaults to what {@link path} implies. Passed in where the caller already worked it out. */
    readonly contentClass?: ContentClass;
}

/**
 * A comparison of two versions of a file **whose bytes were never read**.
 *
 * The other door into this module, and the one the asset half of a project comes through. It
 * carries no `Buffer` for the whole file by construction: a side is a probe out of the tree
 * walk plus, at most, a header the caller could afford. See `contentDiff.ts`.
 */
export interface ContentDiffRequest {
    readonly path: string;
    /** Defaults to what {@link path} implies. */
    readonly contentClass?: ContentClass;
    readonly base: ContentSide | null;
    readonly head: ContentSide | null;
}

export interface DocumentDiffOptions {
    readonly limit?: number;
    /**
     * Told why a document came back at a lower tier than its spec promised.
     *
     * A port rather than a logger so this module keeps no dependencies, and it exists at
     * all because a silent degradation is indistinguishable from a document that simply
     * did not change much: the tier says which rung was reached, never which one was
     * missed.
     */
    readonly onDegrade?: (reason: string) => void;
}

/**
 * The spec owning a repository-relative path, or undefined when none does.
 *
 * Undefined is the ordinary answer - most of what a repository holds is the author's
 * assets - and it is also the answer for a path the registry refuses to look at (an
 * absolute one, or one with a `..` segment). Refusing loudly would turn one odd entry in
 * a tree into a failure to diff the revision at all.
 */
export function specForDocumentPath(path: string): AnyDocumentSpec | undefined {
    try {
        return resolveDocumentSpecForPath(path)?.spec;
    } catch {
        return undefined;
    }
}

/**
 * Largest asset a comparison will pull whole **just to read its header**.
 *
 * The number exists because the backend has no ranged fetch: `storageGet` answers with a whole
 * blob or nothing, so getting eight kilobytes of PNG header out of a revision costs the whole
 * PNG. Below this the trade is worth it - a sprite, a UI image, a short sound effect, most
 * fonts - and above it a comparison reports from the tree's own numbers instead. A music track
 * and a video are both comfortably above it, which is the intent.
 *
 * A working tree is not subject to it: `fs.read` takes a length there, so a header off disk
 * costs a header. The consequence is that the same file can produce a dimension row against
 * the working tree and only a size row between two revisions, which is a real asymmetry rather
 * than an inconsistency - one side can be read cheaply and the other cannot.
 */
export const CONTENT_HEAD_READ_CEILING = 2 * 1024 * 1024;

/**
 * Largest file either side of a comparison will hand the renderer **to draw**.
 *
 * A judgement on the same terms as the three ceilings above - nobody has measured a corpus of
 * project art, and this is meant to be re-set the first time a real production turns up rather
 * than defended as a measurement. 16 MiB is where a still stops being something an author put on
 * screen and starts being a source file they keep beside it: a 4096x4096 sprite sheet with alpha
 * lands under it, a layered master export does not. The bytes cross the process boundary
 * base64-encoded, so the transfer costs about a third more again, per side.
 *
 * It bounds the WORKING-TREE side only, and the asymmetry is the same one
 * {@link CONTENT_HEAD_READ_CEILING} describes with the sides the other way round: on disk a size
 * is known before a byte is read, so the refusal costs nothing, while `storageGet` answers with a
 * whole blob or nothing and a revision's size is only known once it has already been paid for.
 */
export const COMPARISON_PREVIEW_BYTE_CEILING = 16 * 1024 * 1024;

/**
 * How many bytes reading this path would cost, or **0 for do not read it**.
 *
 * The one place the question "is this worth reading" is answered, so both comparison flows
 * answer it the same way. The rule is that reading has to be able to change what the author is
 * told:
 *
 *  - A path a spec claims, or one whose class says a parser has a chance, is read - up to
 *    {@link DIFF_PARSE_BYTE_CEILING}, past which `diffDocumentBytes` would degrade to size
 *    alone anyway and the read would be pure waste. **That last clause is the old defect:**
 *    the ceiling was checked after both sides were already in memory.
 *  - An asset is read only when a header would say something and is affordable, i.e. its
 *    provider wants bytes and both sides are under {@link CONTENT_HEAD_READ_CEILING}.
 *  - Everything else is 0, and the content step describes it from the tree.
 *
 * `knownClass` is for a caller that has already settled the class from the file's own bytes,
 * which only the working-tree side can do - see {@link import("./workingTreeDiff").diffWorkingTree}.
 * Without it the name is the only evidence, and a name with no extension answers `unknown`,
 * which reads as "might be JSON" and buys the whole file on both sides.
 */
export function planPathRead(
    path: string,
    baseSize: number,
    headSize: number,
    knownClass?: ContentClass,
): number {
    const largest = Math.max(baseSize, headSize);
    if (largest === 0) {
        return 0;
    }
    const contentClass = knownClass ?? contentClassOf(path);
    if (specForDocumentPath(path) || contentClassIsReadable(contentClass)) {
        return largest <= DIFF_PARSE_BYTE_CEILING ? baseSize + headSize : 0;
    }
    if (contentProviderFor(path, contentClass).headBytes === 0 || largest > CONTENT_HEAD_READ_CEILING) {
        return 0;
    }
    return baseSize + headSize;
}

/**
 * What kind of thing a path holds, when both sides' bytes are already in hand.
 *
 * A path the NAME could not place is placed from its bytes, and doing it where the bytes already
 * are costs no read at all. It is also the only place the revision side can do it, having no
 * ranged fetch - and it is what stops every asset in a real project
 * (`assets/content/<shard>/<shard>/<id>`, no extension anywhere) from being described as two byte
 * counts. The newer side is asked first: it is what the file IS now.
 *
 * `declared` is for a caller that already settled the class some other way - the working-tree
 * comparison sniffs a bounded prefix off disk before it plans anything.
 */
export function classOfReadSides(
    path: string,
    head: Buffer | null,
    base: Buffer | null,
    declared?: ContentClass,
): ContentClass {
    const named = declared ?? contentClassOf(path);
    if (named !== "unknown") {
        return named;
    }
    return (head ? contentClassOfBytes(head) : null) ?? (base ? contentClassOfBytes(base) : null) ?? named;
}

/** Compare two versions of one document, degrading through the four tiers as needed. */
export function diffDocumentBytes(request: DocumentDiffRequest, options: DocumentDiffOptions = {}): DocumentDiff {
    const limit = options.limit ?? DOCUMENT_DIFF_CHANGE_LIMIT;
    const { base, head, spec } = request;

    if (!base && !head) {
        // Reachable: `changedPaths` reports directories too, and neither side holds bytes
        // for one. Nothing happened to a document that exists on neither side.
        return buildDocumentDiff([], { tier: "opaque", limit });
    }

    if (!base || !head) {
        return presenceDiff(request, base ? "removed" : "added", limit);
    }

    if (base.equals(head)) {
        // Claimed as opaque rather than as the tier a full comparison would have reached:
        // an empty list is the same list at every tier, and saying "semantic" here would
        // put a semantic badge on a document nothing ever looked inside.
        return buildDocumentDiff([], { tier: "opaque", limit });
    }

    if (base.length > DIFF_PARSE_BYTE_CEILING || head.length > DIFF_PARSE_BYTE_CEILING) {
        options.onDegrade?.(
            `${request.path} is ${Math.max(base.length, head.length)} bytes, over the ${DIFF_PARSE_BYTE_CEILING}`
            + " byte parse ceiling, so it is reported by size only",
        );
        return opaqueDiff(base, head, limit);
    }

    if (spec) {
        const parsedBase = tryParse(spec, request.path, base);
        const parsedHead = tryParse(spec, request.path, head);
        if (parsedBase.ok && parsedHead.ok) {
            if (spec.diff) {
                const semantic = trySpecDiff(spec, parsedBase.document, parsedHead.document, limit, options);
                if (semantic) {
                    return semantic;
                }
            } else {
                return summaryDiff(spec, parsedBase.document, parsedHead.document, limit);
            }
        } else {
            // The one honest failure path: a document its own spec cannot read still has to
            // appear in the change list, so it falls through to the generic tiers below.
            const rejected = parsedBase.ok ? parsedHead : parsedBase;
            options.onDegrade?.(
                `${request.path} could not be read as a ${spec.kind} document`
                + `${rejected.ok ? "" : ` (${rejected.reason})`}, so it is compared generically`,
            );
        }
    }

    const jsonBase = tryJson(base);
    const jsonHead = tryJson(head);
    if (jsonBase.ok && jsonHead.ok) {
        return diffJsonStructural(jsonBase.value, jsonHead.value, { limit });
    }

    // The content step, between structural and opaque. Only for the classes whose bytes are
    // NOT worth parsing - a `.txt` that reached here is a text file nobody could diff, and
    // handing it to a header reader would produce "Studio does not recognise this format"
    // about a format Studio recognises perfectly well.
    //
    const contentClass = classOfReadSides(request.path, head, base, request.contentClass);
    if (!contentClassIsReadable(contentClass)) {
        return diffDocumentContent({
            path: request.path,
            contentClass,
            // The whole file was read, so the header is certainly inside it.
            base: { probe: { size: base.length }, head: base },
            head: { probe: { size: head.length }, head },
        }, { limit });
    }

    return opaqueDiff(base, head, limit);
}

/** One side of a set comparison: the bytes of every file of the set that side holds. */
export interface DocumentSetSide {
    /** Keyed by repository-relative path. Absent paths are files that side does not have. */
    readonly parts: ReadonlyMap<string, Buffer>;
}

export interface DocumentSetDiffRequest {
    /** The manifest path - the set's one name, and where the resulting entry is reported. */
    readonly path: string;
    readonly spec: AnyDocumentSetSpec;
    /** The set instance's identity, e.g. `{storyId: "a"}`. */
    readonly key: Readonly<Record<string, string>>;
    readonly base: DocumentSetSide | null;
    readonly head: DocumentSetSide | null;
}

/**
 * Compare two versions of ONE document that is stored as several files.
 *
 * The whole reason the set layer exists ends here: both sides are assembled into whole documents
 * and handed to the spec's own `diff`, which has never heard of members and does not have to. So
 * a story split into five hundred scene files is compared by `diffStoryDocument` exactly as an
 * unsplit one is, with the same signature and the same answers.
 *
 * Three of the four tiers are reachable and the fourth is not, which is the one difference from
 * {@link diffDocumentBytes} worth stating: there is no `structural` rung for a set, because
 * "the JSON paths whose values differ" needs one JSON document per side and a set has N files.
 * Walking them file by file would produce a list addressed in a fourth scheme that neither
 * `diff`, `merge3` nor the resolver can act on - so a set that cannot be assembled falls
 * straight to `opaque`, and says so through `onDegrade`.
 */
export function diffDocumentSet(request: DocumentSetDiffRequest, options: DocumentDiffOptions = {}): DocumentDiff {
    const limit = options.limit ?? DOCUMENT_DIFF_CHANGE_LIMIT;
    const { spec, key, base, head } = request;
    const manifestPath = request.path;

    // A side holding member files but no manifest is a side that does not hold this document:
    // the manifest is the set's identity, and folding orphaned members into an invented empty
    // manifest would report a document that is not there as one that changed.
    const hasBase = Boolean(base?.parts.has(manifestPath));
    const hasHead = Boolean(head?.parts.has(manifestPath));
    if (!hasBase && !hasHead) {
        // Member files with no manifest on either side. Nothing here is a document, so there is
        // nothing to compare - but reporting an EMPTY list would say "nothing changed" about files
        // that demonstrably did, which is the one answer that is worse than saying nothing.
        const orphans = (base?.parts.size ?? 0) + (head?.parts.size ?? 0);
        if (orphans === 0) {
            return buildDocumentDiff([], { tier: "opaque", limit });
        }
        options.onDegrade?.(
            `${manifestPath} is missing on both sides, so its ${orphans} member file(s) are not a`
            + " document and are reported without being read",
        );
        return buildDocumentDiff(
            [{ path: [], kind: "changed", label: { key: LABEL_OPAQUE_UNREAD } }],
            { tier: "opaque", limit },
        );
    }

    const baseBytes = totalBytes(base);
    const headBytes = totalBytes(head);

    if (!hasBase || !hasHead) {
        const present = (hasHead ? head : base) as DocumentSetSide;
        const parsed = tryAssemble(spec, key, manifestPath, present, options);
        const summary = parsed.ok ? summarizeQuietly(spec, parsed.document) : undefined;
        return buildDocumentDiff(
            [{
                path: [],
                kind: hasHead ? "added" : "removed",
                label: {
                    key: hasHead ? LABEL_ADDED : LABEL_REMOVED,
                    params: { bytes: hasHead ? headBytes : baseBytes },
                },
                ...(summary?.title ? { subject: summary.title } : {}),
            }],
            { tier: summary ? "summary" : "opaque", limit },
        );
    }

    if (sameParts(base as DocumentSetSide, head as DocumentSetSide)) {
        // Same claim, same reason, as the byte-equal short circuit for one file: an empty list is
        // the same list at every tier, and a semantic badge on a document nothing looked inside
        // would be a claim about a comparison that did not happen.
        return buildDocumentDiff([], { tier: "opaque", limit });
    }

    // The ceiling is a per-DOCUMENT ceiling, so for a set it is the sum of its files. Checking it
    // per member would let a thousand small scenes past a guard that exists to keep one enormous
    // parse off the main process's only thread.
    if (baseBytes > DIFF_PARSE_BYTE_CEILING || headBytes > DIFF_PARSE_BYTE_CEILING) {
        options.onDegrade?.(
            `${manifestPath} and its members are ${Math.max(baseBytes, headBytes)} bytes, over the `
            + `${DIFF_PARSE_BYTE_CEILING} byte parse ceiling, so the document is reported by size only`,
        );
        return setSizeDiff(baseBytes, headBytes, limit);
    }

    const parsedBase = tryAssemble(spec, key, manifestPath, base as DocumentSetSide, options);
    const parsedHead = tryAssemble(spec, key, manifestPath, head as DocumentSetSide, options);
    if (!parsedBase.ok || !parsedHead.ok) {
        const rejected = parsedBase.ok ? parsedHead : parsedBase;
        options.onDegrade?.(
            `${manifestPath} could not be assembled as a ${spec.kind} document`
            + `${rejected.ok ? "" : ` (${rejected.reason})`}, so it is reported by size only`,
        );
        return setSizeDiff(baseBytes, headBytes, limit);
    }

    if (spec.diff) {
        const semantic = trySpecDiff(spec, parsedBase.document, parsedHead.document, limit, options);
        if (semantic) {
            return semantic;
        }
    }
    return summaryDiff(spec, parsedBase.document, parsedHead.document, limit);
}

/**
 * A set that changed and was not opened: two byte totals, and nothing invented.
 *
 * Separate from {@link opaqueDiff} only because the two sides are several files each, so there is
 * no Buffer to take a length from. The label is the same one, and it must be: an author reading
 * "changed, 12000 -> 12400 bytes" is being told the same kind of thing either way.
 */
function setSizeDiff(baseBytes: number, headBytes: number, limit: number): DocumentDiff {
    return buildDocumentDiff(
        [{
            path: [],
            kind: "changed",
            label: { key: LABEL_OPAQUE_CHANGED, params: { fromBytes: baseBytes, toBytes: headBytes } },
        }],
        { tier: "opaque", limit },
    );
}

function totalBytes(side: DocumentSetSide | null): number {
    let total = 0;
    for (const bytes of side?.parts.values() ?? []) {
        total += bytes.length;
    }
    return total;
}

function sameParts(base: DocumentSetSide, head: DocumentSetSide): boolean {
    if (base.parts.size !== head.parts.size) {
        return false;
    }
    for (const [path, bytes] of base.parts) {
        const other = head.parts.get(path);
        if (!other || !other.equals(bytes)) {
            return false;
        }
    }
    return true;
}

/**
 * Parse every file of one side and fold them into the whole document.
 *
 * Guarded end to end for {@link tryParse}'s reason and one of its own: `assemble` is a spec's code
 * running over files that came out of a repository, and it is the one place where a member file
 * from a future Studio meets a manifest from this one.
 */
function tryAssemble(
    spec: AnyDocumentSetSpec,
    key: Readonly<Record<string, string>>,
    manifestPath: string,
    side: DocumentSetSide,
    options: DocumentDiffOptions,
): ParseResult {
    const raw = new Map<string, unknown>();
    for (const [path, bytes] of side.parts) {
        try {
            raw.set(path, JSON.parse(bytes.toString("utf-8")));
        } catch (error) {
            return { ok: false, reason: `${path} is not valid JSON: ${messageOf(error)}` };
        }
    }

    try {
        const parts = documentSetPartsFrom(spec, key, raw);
        return { ok: true, document: assembleDocumentSet(spec, parts, parseContextFor(spec, manifestPath, Buffer.alloc(0))) };
    } catch (error) {
        options.onDegrade?.(`${manifestPath} could not be assembled: ${messageOf(error)}`);
        return { ok: false, reason: messageOf(error) };
    }
}

/**
 * Compare two versions of a file from their probes, without their bytes.
 *
 * Reported at the `opaque` tier for the reason set out at the top of this module: the tier
 * vocabulary is shared with a renderer that switches over it exhaustively, and the weakest rung
 * is the only one that cannot overclaim.
 */
export function diffDocumentContent(
    request: ContentDiffRequest,
    options: DocumentDiffOptions = {},
): DocumentDiff {
    const limit = options.limit ?? DOCUMENT_DIFF_CHANGE_LIMIT;
    const { base, head } = request;

    if (!base && !head) {
        return buildDocumentDiff([], { tier: "opaque", limit });
    }
    if (!base || !head) {
        const probe = (head ?? base) as ContentSide;
        return buildDocumentDiff(
            [{
                path: [],
                kind: base ? "removed" : "added",
                label: {
                    key: base ? LABEL_REMOVED : LABEL_ADDED,
                    params: { bytes: probe.probe.size },
                },
            }],
            { tier: "opaque", limit },
        );
    }

    const contentClass = request.contentClass ?? contentClassOf(request.path);
    const provider = contentProviderFor(request.path, contentClass);
    let changes: readonly DocumentChange[];
    try {
        changes = provider.describe(base, head);
    } catch (error) {
        // Same guard, same reason, as `trySpecDiff`: this runs inside the loop that builds a
        // whole comparison, and a header reader thrown off by a truncated or hostile file must
        // cost its own row rather than the other forty. The tier drops with it: nothing was
        // read, so the caption that says so is the true one.
        options.onDegrade?.(`the ${provider.id} content provider threw: ${messageOf(error)}`);
        return buildDocumentDiff(
            [{ path: [], kind: "changed", label: { key: LABEL_OPAQUE_UNREAD } }],
            { tier: "opaque", limit },
        );
    }
    // A provider that reads no header knows nothing this file did not already announce by
    // existing at a size, and `opaque`'s caption ("only its size is reported") is exactly that
    // claim. Only a provider that opens the header may say it compared what the file reports.
    return buildDocumentDiff(changes, { tier: provider.headBytes > 0 ? "content" : "opaque", limit });
}

/**
 * A document that exists on one side only.
 *
 * One row, whatever the tier could have been: the change the author made is "this
 * document appeared", and listing every field of a new file as an addition would spend a
 * whole budget restating one act. The summary is read where a spec can read it, because
 * "12 variables" beside the row is what makes it worth having.
 */
function presenceDiff(request: DocumentDiffRequest, kind: "added" | "removed", limit: number): DocumentDiff {
    const bytes = (request.head ?? request.base) as Buffer;
    // The ceiling applies here too, and this is the likeliest path to meet a large file: a
    // newly imported asset is an addition, and reading one for a title nobody asked for would
    // decode a whole video into a string to find out it is not a document.
    const parsed = request.spec && bytes.length <= DIFF_PARSE_BYTE_CEILING
        ? tryParse(request.spec, request.path, bytes)
        : undefined;
    const summary = parsed?.ok && request.spec ? summarizeQuietly(request.spec, parsed.document) : undefined;

    const change: DocumentChange = {
        path: [],
        kind,
        label: {
            key: kind === "added" ? LABEL_ADDED : LABEL_REMOVED,
            params: { bytes: bytes.length },
        },
        ...(summary?.title ? { subject: summary.title } : {}),
    };
    return buildDocumentDiff([change], { tier: summary ? "summary" : "opaque", limit });
}

/**
 * Tier 2: what the two sides say about themselves.
 *
 * Nearly free - `summarize` is what the history list already runs - and it is the reason
 * a spec is worth registering before anyone writes a `diff` for it.
 *
 * The last branch matters more than it looks: two documents with identical summaries and
 * different bytes DID change, and answering with an empty list would tell the author
 * nothing happened to a file they can see is dirty. One row saying "changed, and the
 * summary does not show how" is the truthful version of that.
 */
function summaryDiff(spec: AnyDocumentSpec, base: unknown, head: unknown, limit: number): DocumentDiff {
    const before = summarizeQuietly(spec, base);
    const after = summarizeQuietly(spec, head);
    if (!before || !after) {
        return buildDocumentDiff(
            [{ path: [], kind: "changed", label: { key: LABEL_SUMMARY_OTHER } }],
            { tier: "summary", limit },
        );
    }

    const changes: DocumentChange[] = [];
    if (before.title !== after.title) {
        changes.push({
            path: ["title"],
            kind: "changed",
            label: { key: LABEL_SUMMARY_TITLE, params: { from: before.title, to: after.title } },
            // The author's own words on both sides; the new one is what the row is about.
            subject: after.title || before.title,
        });
    }

    const counts = new Map(before.counts.map(count => [count.key, count.value]));
    const seen = new Set<string>();
    for (const count of after.counts) {
        seen.add(count.key);
        const was = counts.get(count.key);
        if (was === count.value) {
            continue;
        }
        changes.push(countChange(count.key, was, count.value));
    }
    for (const count of before.counts) {
        if (!seen.has(count.key)) {
            changes.push(countChange(count.key, count.value, undefined));
        }
    }

    // Sorted by the count's own key, which is stable across runs; the order `summarize`
    // happens to build its array in is not something a spec promises.
    changes.sort(compareChanges);
    if (changes.length === 0) {
        changes.push({ path: [], kind: "changed", label: { key: LABEL_SUMMARY_OTHER } });
    }
    return buildDocumentDiff(changes, { tier: "summary", limit });
}

/**
 * One `{key, value}` of a summary, as a change.
 *
 * `name` is the count's own key - itself a translation key, which is what
 * {@link DocumentSummaryCount} is defined to hold - so the surface resolves it rather
 * than printing `audioTracks` at the author.
 */
function countChange(key: string, from: number | undefined, to: number | undefined): DocumentChange {
    return {
        path: ["counts", key],
        kind: from === undefined ? "added" : to === undefined ? "removed" : "changed",
        label: {
            key: LABEL_SUMMARY_COUNT,
            params: {
                name: key,
                ...(from === undefined ? {} : { from }),
                ...(to === undefined ? {} : { to }),
            },
        },
    };
}

/**
 * A document that was NOT read, told apart from one that was read and not understood.
 *
 * Two things produce it and both are honest states rather than errors: a comparison over
 * more paths than {@link DIFF_PATH_LIMIT}, where reading everything is the wrong thing to
 * spend a project's open on; and a read that failed while the revision itself is fine -
 * measured, not hypothetical: content written by an ONLINE commit cannot be fetched back
 * by the process that wrote it, where the tree still answers with paths and addresses and
 * only `storageGet` fails (docs/version-control.md §4.29). Both must reach the author as
 * "changed, not inspected" rather than as an empty change list, which is what "nothing
 * changed" looks like.
 */
export function unreadDocumentDiff(kind: DocumentChange["kind"] = "changed"): DocumentDiff {
    return buildDocumentDiff(
        [{ path: [], kind, label: { key: LABEL_OPAQUE_UNREAD } }],
        { tier: "opaque", limit: 1 },
    );
}

/** Tier 4: it changed, and these are the two sizes. Everything else would be invented. */
function opaqueDiff(base: Buffer, head: Buffer, limit: number): DocumentDiff {
    return buildDocumentDiff(
        [{
            path: [],
            kind: "changed",
            label: { key: LABEL_OPAQUE_CHANGED, params: { fromBytes: base.length, toBytes: head.length } },
        }],
        { tier: "opaque", limit },
    );
}

/**
 * Run a spec's own diff, or answer undefined so the caller degrades.
 *
 * Guarded on both sides of the contract even though the contract says pure and
 * non-throwing: this runs inside the loop that builds a whole revision's change list, so
 * a spec that throws (or hands back something that is not a diff at all, which a
 * migration can produce without the compiler noticing) must cost its own document and
 * not the other forty. The budget is re-imposed for the same reason - a spec that
 * ignores `limit` would otherwise put ten thousand rows on an IPC message.
 */
function trySpecDiff(
    spec: AnyDocumentSpec,
    base: unknown,
    head: unknown,
    limit: number,
    options: DocumentDiffOptions,
): DocumentDiff | undefined {
    let produced: DocumentDiff;
    try {
        produced = spec.diff?.(base, head, { limit }) as DocumentDiff;
    } catch (error) {
        options.onDegrade?.(`the ${spec.kind} spec threw while diffing: ${messageOf(error)}`);
        return undefined;
    }

    if (!produced || !Array.isArray(produced.changes)) {
        options.onDegrade?.(`the ${spec.kind} spec returned no usable diff`);
        return undefined;
    }
    if (countDocumentChanges(produced.changes) <= limit) {
        return produced;
    }
    return buildDocumentDiff(produced.changes, {
        tier: isTier(produced.tier) ? produced.tier : "semantic",
        limit,
        total: Math.max(produced.total ?? 0, countDocumentChanges(produced.changes)),
    });
}

type ParseResult =
    | { ok: true; document: unknown }
    | { ok: false; reason: string };

/**
 * Parse with a spec, without any of `loadDocument`'s behaviour.
 *
 * Deliberately not `loadDocument`: that one quarantines what it cannot read, which is
 * right for the working tree and wrong here. These bytes are a REVISION's - the record
 * of what was committed - and a copy of them in `.nlstudio/quarantine` would tell the
 * author a file they cannot change is broken, with no way to withdraw the claim.
 */
function tryParse(spec: AnyDocumentSpec, path: string, bytes: Buffer): ParseResult {
    let raw: unknown;
    try {
        raw = JSON.parse(bytes.toString("utf-8"));
    } catch (error) {
        return { ok: false, reason: `not valid JSON: ${messageOf(error)}` };
    }
    try {
        return { ok: true, document: spec.parse(raw, parseContextFor(spec, path, bytes)) };
    } catch (error) {
        return { ok: false, reason: messageOf(error) };
    }
}

function parseContextFor(spec: AnyDocumentSpec, path: string, bytes: Buffer): DocumentParseContext {
    return {
        path,
        corrupt(reason: string, options?: { cause?: unknown }): never {
            throw new DocumentCorruptError({
                kind: spec.kind,
                path,
                reason,
                text: bytes.toString("utf-8"),
                cause: options?.cause,
            });
        },
    };
}

/** `summarize` is not on the no-throw contract that `diff` is, so it gets the same guard. */
function summarizeQuietly(spec: AnyDocumentSpec, document: unknown): { title: string; counts: readonly { key: string; value: number }[] } | undefined {
    try {
        const summary = spec.summarize(document);
        return summary && Array.isArray(summary.counts) ? summary : undefined;
    } catch {
        return undefined;
    }
}

function tryJson(bytes: Buffer): { ok: true; value: unknown } | { ok: false } {
    try {
        return { ok: true, value: JSON.parse(bytes.toString("utf-8")) };
    } catch {
        return { ok: false };
    }
}

/** Path order, so a list built from a map is the same list on every run. */
function compareChanges(a: DocumentChange, b: DocumentChange): number {
    const left = a.path.join("/");
    const right = b.path.join("/");
    return left < right ? -1 : left > right ? 1 : 0;
}

function isTier(value: unknown): value is DocumentDiffTier {
    return value === "semantic" || value === "summary" || value === "structural" || value === "opaque";
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
