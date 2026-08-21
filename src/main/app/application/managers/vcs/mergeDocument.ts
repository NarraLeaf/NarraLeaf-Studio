import fs from "fs";
import path from "path";
import type { DocumentMergeDecision } from "@shared/documents/diff";
import {
    assembleDocumentSet,
    documentSetAt,
    DocumentSetIncompleteError,
    documentSetManifestPath,
    documentSetMemberScan,
    documentSetPartsFrom,
    serializeDocumentSet,
    type AnyDocumentSetSpec,
    type DocumentSetLocation,
    type DocumentSetLookup,
} from "@shared/documents/documentSet";
import {
    applyMergeDecisions,
    type DocumentMergeSideName,
} from "@shared/documents/mergeApply";
import { DocumentCorruptError, type AnyDocumentSpec, type DocumentParseContext } from "@shared/documents/types";
import type { VcsMergeDocument, VcsMergeDocumentBlocker } from "@shared/types/vcs";
import { DIFF_PARSE_BYTE_CEILING, specForDocumentPath } from "./diff/documentDiff";

/**
 * The second tier of conflict resolution: settling one document one change at a time.
 *
 * **Everything it needs is already on disk.** A conflicted merge leaves `<path>~base`, `~mine` and
 * `~theirs` beside the file, each a complete and individually parseable copy of one side (docs
 * §4.23) - so the three inputs of a three-way merge are three files, and nothing here has to walk
 * the revision graph, ask the backend for a base, or read the conflicted file itself (which has
 * diff3 markers in it and is not valid JSON). That is also why this module touches no Lore at all:
 * it is `fs` plus the document registry, and the only reason it is reached through `backend.ts`
 * like the rest of `vcs/` is that `merge.ts` next door is the one that settles what it composes.
 *
 * **Reading and writing are one function each and they recompute rather than remember.** The
 * renderer is handed a decision list and hands back a side per decision; the decision list is
 * built again here from the same three files before anything is applied. `merge3` is contractually
 * pure and its inputs are files, so the two runs agree - and the alternative, letting a renderer
 * post the merged document back, would let a window write bytes neither side ever held.
 *
 * **Every refusal is a value, not a throw.** `no-spec`, `no-merge3`, `read-only`, `too-large`,
 * `too-many` and `unreadable` are all ordinary answers about ordinary files, and the surface has
 * to say which one it got: a document that falls back to tier one has to look different from one
 * whose per-change list is empty because the merge settled everything.
 *
 * **The write goes to the working tree and stops there.** Settling and recording belong to
 * `merge.ts` and `VcsManager.completeMerge`, which take the bytes this leaves behind with the
 * PLAIN `branch_merge_resolve` verb - measured to commit the working tree byte for byte (§4.25) -
 * and close the merge on offline globals (§4.29).
 */

/**
 * What the merge left beside a conflicted file. The same three names `merge.ts` copies from.
 *
 * Kept here rather than imported so this module does not pull in the one that loads the native
 * binding; they are three string constants and the pair is pinned by `merge.integration.test.ts`,
 * which asserts the on-disk names directly.
 */
const SIDECAR = { base: "~base", mine: "~mine", theirs: "~theirs" } as const;

/**
 * Most decisions one document's list will carry.
 *
 * Not a display budget: a decision carries both sides' whole values, so a translation library
 * where two people worked through a hundred keys each is already a large IPC message, and one
 * where they worked through ten thousand is a message nothing can draw and nobody can answer.
 *
 * **Past it the document falls back to tier one rather than being truncated**, and that asymmetry
 * with the diff lists is the point: a truncated change list is a lesser view of the same facts,
 * while a truncated decision list cannot be applied at all - the changes it left out would have to
 * be settled by something other than the author, which is the failure the whole tier exists to
 * avoid.
 */
export const MERGE_DECISION_LIMIT = 500;

/**
 * Read the three sides of one conflicted document and merge them.
 *
 * Repository-relative in, and every failure comes back as a {@link VcsMergeDocumentBlocker} - the
 * caller's next move is the same in all of them (draw the tier-one row and say why), and an
 * exception here would take the whole panel down over one file the author could still resolve
 * whole.
 */
export async function readMergeDocument(
    root: string,
    relativePath: string,
    sets: DocumentSetLookup = documentSetAt,
): Promise<VcsMergeDocument> {
    const composed = composeMerge(root, relativePath, sets);
    if (composed.blocked !== undefined) {
        return {
            path: relativePath,
            decisions: [],
            conflicts: 0,
            blocked: composed.blocked,
            ...(composed.detail ? { detail: composed.detail } : {}),
        };
    }

    const { spec, merge, set } = composed;
    // Every conflicted file this one answer settles. For a single-file document that is the path
    // itself and the field is absent; for a set it is every member the backend could not settle,
    // and the caller MUST hand all of them to the resolve verb - settling only the path the author
    // clicked would leave the rest in conflict and the commit would be refused naming one of them
    // (§4.32), with the paths that DID settle already written and their sidecars gone.
    const members = set ? { members: set.conflicted } : {};
    const decisions = merge.decisions as DocumentMergeDecision[];
    if (decisions.length > MERGE_DECISION_LIMIT) {
        return {
            path: relativePath,
            documentKind: spec.kind,
            ...members,
            decisions: [],
            conflicts: 0,
            blocked: "too-many",
            detail: `${decisions.length} changes, over the ${MERGE_DECISION_LIMIT} this can settle one at a time`,
        };
    }

    // **The serialize probe, and it is the honest half of constraint one.** `assetsMetadataSpec`
    // implements `merge3` and refuses to `serialize` - deliberately, because `AssetsService` still
    // owns writing that shard and the asset services still assign `undefined` where the canonical
    // encoder requires an absent key. So its per-change result could be composed and never
    // written. Probing rather than listing the specs that can write means a spec becomes
    // resolvable the day its own migration lands, with nothing here to remember to update - and
    // the reason reaches the author as words rather than as a control that is quietly missing.
    try {
        // A set answers the probe with its files' bytes rather than one file's: `serialize` on a
        // set spec throws by design, so probing THAT would report every set as read-only.
        if (set) {
            serializeDocumentSet(set.spec, set.key, merge.document);
        } else {
            spec.serialize(merge.document);
        }
    } catch (error) {
        return {
            path: relativePath,
            documentKind: spec.kind,
            ...members,
            decisions: [],
            conflicts: 0,
            blocked: "read-only",
            detail: messageOf(error),
        };
    }

    return {
        path: relativePath,
        documentKind: spec.kind,
        ...members,
        decisions,
        conflicts: merge.conflicts,
    };
}

/**
 * Compose the author's answers into the working tree, and stop.
 *
 * Nothing is settled or recorded here - `VcsManager.completeMerge` does both, in the one queued
 * act that also flushes the renderer's pending saves first. **The order is not negotiable**: the
 * conflicted paths are being read out of their `~mine` copies while the merge is open (§4.33), so
 * an auto-save landing after this would put the author's pre-merge document straight back over the
 * bytes this just wrote.
 *
 * Throws, unlike {@link readMergeDocument}: by the time this runs the author has pressed the
 * button, and a document that cannot be composed must stop the merge with a sentence naming it
 * rather than be quietly left holding base.
 */
export async function resolveDocumentChanges(
    root: string,
    relativePath: string,
    choices: Readonly<Record<string, DocumentMergeSideName>>,
    sets: DocumentSetLookup = documentSetAt,
): Promise<readonly string[]> {
    const composed = composeMerge(root, relativePath, sets);
    if (composed.blocked !== undefined) {
        throw new Error(
            `${relativePath} cannot be settled change by change (${composed.blocked}`
            + `${composed.detail ? `: ${composed.detail}` : ""}).`,
        );
    }

    const { spec, merge, set } = composed;
    const settled = applyMergeDecisions(set?.manifestPath ?? relativePath, merge.document, merge.decisions, choices);

    if (!set) {
        // A plain write, for the reason `merge.ts` gives for its plain copy: the operation as a
        // whole spans several files and is not atomic anyway, and the merge's own three copies are
        // still on disk beside this one until the commit removes them.
        fs.writeFileSync(absoluteWithin(root, relativePath), spec.serialize(settled), "utf-8");
        return [relativePath];
    }

    writeDocumentSet(root, set, settled);
    return set.conflicted;
}

/**
 * Put a settled set back onto disk, one file at a time, and say nothing about which change went
 * where.
 *
 * **This is where a decision routes home, and it does it by taking the document apart rather than
 * by reading a change's path.** `applyMergeDecisions` has already produced one whole document; the
 * file that owns a change is whichever part `disassemble` puts it in, so a change touching two
 * files moves two files and nothing here had to know that could happen.
 *
 * Only the parts whose bytes actually moved are written. A set is written in canonical form and
 * the service that owns the format may not be - the story service writes
 * `JSON.stringify(document, null, 2)` - so rewriting every member would turn one settled scene
 * into a whole-document rewrite in the author's next commit.
 *
 * A member the settled document no longer holds is **deleted**, because the alternative is worse:
 * members are enumerated by path, so a file left behind would be folded straight back in and the
 * author's accepted deletion would silently undo itself. Its sidecars are left alone - the commit
 * removes them - and the deleted path stays in {@link ComposedSet.conflicted} so the caller still
 * settles it with the backend.
 */
function writeDocumentSet(root: string, set: ComposedSet, settled: unknown): void {
    const bytes = serializeDocumentSet(set.spec, set.key, settled);
    for (const [relative, text] of bytes) {
        const absolute = absoluteWithin(root, relative);
        if (readSide(absolute)?.toString("utf-8") === text) {
            continue;
        }
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, text, "utf-8");
    }
    for (const relative of set.files) {
        if (bytes.has(relative)) {
            continue;
        }
        try {
            fs.rmSync(absoluteWithin(root, relative));
        } catch {
            // Already gone, or not ours to remove. The settle below still names the path, which is
            // the half that has to happen.
        }
    }
}

interface ComposedMerge {
    readonly document: unknown;
    readonly decisions: readonly DocumentMergeDecision[];
    readonly conflicts: number;
}

/** What a set-shaped merge composed itself from, kept so the write can route back to it. */
interface ComposedSet {
    readonly spec: AnyDocumentSetSpec;
    readonly key: Readonly<Record<string, string>>;
    readonly manifestPath: string;
    /** Every file of the set found on disk, repository-relative. */
    readonly files: readonly string[];
    /** The subset the backend could not settle - the paths a resolve verb has to be given. */
    readonly conflicted: readonly string[];
}

type Composed =
    | { spec: AnyDocumentSpec; merge: ComposedMerge; set?: ComposedSet; blocked?: undefined }
    | { blocked: VcsMergeDocumentBlocker; detail?: string };

/**
 * The shared half: find the spec, read the three copies, parse them, merge.
 *
 * `~base` is optional and its absence is add/add rather than an empty document - which is the
 * distinction `mergeKeyed` refuses to blur, because without a base "the other side does not have
 * this key" and "the other side removed it" are the same observation.
 */
function composeMerge(root: string, relativePath: string, sets: DocumentSetLookup): Composed {
    const location = safeLookup(sets, relativePath);
    if (location) {
        return composeSetMerge(root, location);
    }

    const spec = specForDocumentPath(relativePath);
    if (!spec) {
        return { blocked: "no-spec" };
    }
    if (!spec.merge3) {
        return { blocked: "no-merge3" };
    }

    let absolute: string;
    try {
        absolute = absoluteWithin(root, relativePath);
    } catch (error) {
        return { blocked: "unreadable", detail: messageOf(error) };
    }

    const mine = readSide(`${absolute}${SIDECAR.mine}`);
    const theirs = readSide(`${absolute}${SIDECAR.theirs}`);
    if (!mine || !theirs) {
        // Both are written by the same merge, so one without the other means something removed it
        // - and the path only reached here because `findConflictedPaths` saw both.
        return { blocked: "unreadable", detail: `the merge's copy of ${mine ? "their" : "your"} side is missing` };
    }
    const base = readSide(`${absolute}${SIDECAR.base}`);

    for (const bytes of [base, mine, theirs]) {
        if (bytes && bytes.length > DIFF_PARSE_BYTE_CEILING) {
            return { blocked: "too-large", detail: `${bytes.length} bytes` };
        }
    }

    const parsedMine = parseSide(spec, relativePath, mine);
    if (!parsedMine.ok) return { blocked: "unreadable", detail: parsedMine.reason };
    const parsedTheirs = parseSide(spec, relativePath, theirs);
    if (!parsedTheirs.ok) return { blocked: "unreadable", detail: parsedTheirs.reason };
    // A `~base` that exists and cannot be parsed is NOT downgraded to add/add: that would turn an
    // unreadable ancestor into "the two sides share nothing", which reads every key one side lacks
    // as an addition rather than as a removal - silently, and in the author's favour every time.
    const parsedBase = base ? parseSide(spec, relativePath, base) : undefined;
    if (parsedBase && !parsedBase.ok) return { blocked: "unreadable", detail: parsedBase.reason };

    try {
        // Guarded even though `merge3` is contractually pure and non-throwing, for the reason
        // `documentDiff.trySpecDiff` is: this runs over documents that came out of a repository,
        // so the shapes a current Studio would never produce are exactly the ones it meets.
        const merge = spec.merge3(parsedBase?.document, parsedMine.document, parsedTheirs.document);
        if (!merge || !Array.isArray(merge.decisions)) {
            return { blocked: "unreadable", detail: `the ${spec.kind} spec returned no usable merge` };
        }
        return { spec, merge };
    } catch (error) {
        return { blocked: "unreadable", detail: `the ${spec.kind} spec threw while merging: ${messageOf(error)}` };
    }
}

/**
 * The same three-way merge, over a document that is several files.
 *
 * **The three sides are still on disk and still complete; there are just N of each.** A conflicted
 * merge leaves `~base`/`~mine`/`~theirs` beside every file it could NOT settle (§4.23) and leaves
 * the automerged result in place for every file it could. So the rule for building a side is:
 *
 *  - a file with `~mine` and `~theirs` beside it contributes those two, and `~base` where the
 *    merge wrote one;
 *  - **a file with no sidecars contributes its working bytes to all three sides.** It is already
 *    settled - automerged, or never touched - and giving all three sides the same value is what
 *    says so: `merge3` sees nothing to decide there and the bytes stay exactly as the backend left
 *    them, which is what the commit records byte for byte (§4.25).
 *
 * Using the automerged bytes as that file's BASE is a small fiction - base is where the two sides
 * started, and the automerged value is neither. It is a safe one and only there: all three sides
 * agree, so no decision can arise from it and nothing about the merged document depends on which
 * of the three it came from.
 *
 * **A missing base is add/add for the whole document**, exactly as it is for one file. It happens
 * when the manifest itself is conflicted with no `~base` beside it - both authors created this
 * document independently - and `documentSetPartsFrom` is what says so, by refusing to assemble a
 * set with no manifest. A `~base` that exists and cannot be PARSED is not downgraded to that, for
 * `composeMerge`'s reason: it would read every key one side lacks as an addition rather than as a
 * removal, silently and in the author's favour every time.
 */
function composeSetMerge(root: string, location: DocumentSetLocation): Composed {
    const spec = location.spec;
    if (!spec.merge3) {
        return { blocked: "no-merge3" };
    }

    let files: readonly string[];
    try {
        files = documentSetFilesOnDisk(root, spec, location.key);
    } catch (error) {
        return { blocked: "unreadable", detail: messageOf(error) };
    }

    const sides = new Map<DocumentSetSideName, Map<string, Buffer>>([
        ["base", new Map()],
        ["mine", new Map()],
        ["theirs", new Map()],
    ]);
    const conflicted: string[] = [];

    for (const relative of files) {
        const absolute = absoluteWithin(root, relative);
        const mine = readSide(`${absolute}${SIDECAR.mine}`);
        const theirs = readSide(`${absolute}${SIDECAR.theirs}`);
        if (mine && theirs) {
            conflicted.push(relative);
            const base = readSide(`${absolute}${SIDECAR.base}`);
            if (base) sides.get("base")?.set(relative, base);
            sides.get("mine")?.set(relative, mine);
            sides.get("theirs")?.set(relative, theirs);
            continue;
        }
        if (mine || theirs) {
            // Both are written by the same merge, so one without the other means something removed
            // it. Refusing is right: settling the document anyway would record this file with the
            // conflict markers still in it.
            return { blocked: "unreadable", detail: `the merge's copy of ${mine ? "their" : "your"} side of ${relative} is missing` };
        }
        const working = readSide(absolute);
        if (!working) {
            continue;
        }
        for (const side of sides.values()) side.set(relative, working);
    }

    if (conflicted.length === 0) {
        return { blocked: "unreadable", detail: "no file of this document has the merge's copies beside it" };
    }
    // **Per SIDE, not across all three**, which is the rule the single-file path above applies: it
    // checks `base`, `mine` and `theirs` separately. The ceiling bounds one parse of one document,
    // and for a set a side is the sum of its files.
    for (const [name, bytes] of sides) {
        let total = 0;
        for (const buffer of bytes.values()) total += buffer.length;
        if (total > DIFF_PARSE_BYTE_CEILING) {
            return { blocked: "too-large", detail: `${total} bytes across ${bytes.size} files on the ${name} side` };
        }
    }

    const parsed = new Map<DocumentSetSideName, unknown>();
    for (const [name, bytes] of sides) {
        const raw = new Map<string, unknown>();
        for (const [relative, buffer] of bytes) {
            try {
                raw.set(relative, JSON.parse(buffer.toString("utf-8")));
            } catch (error) {
                // Named by file and by side rather than by sidecar: these bytes came from `~base`
                // for a conflicted file and from the working file for a settled one, so naming a
                // suffix here would point the author at a file that may not exist.
                return { blocked: "unreadable", detail: `${relative} is not valid JSON on ${SIDE_WORD[name]}: ${messageOf(error)}` };
            }
        }
        try {
            const parts = documentSetPartsFrom(spec, location.key, raw);
            // No single byte string to carry: a set is N files. The text on a `DocumentCorruptError`
            // exists for quarantine, and nothing on this path quarantines - these bytes are the
            // merge's own copies of two recorded sides.
            parsed.set(name, assembleDocumentSet(spec, parts, parseContextFor(spec, location.manifestPath, Buffer.alloc(0))));
        } catch (error) {
            if (name === "base" && error instanceof DocumentSetIncompleteError) {
                // No manifest on the base side: both authors made this document independently.
                continue;
            }
            return { blocked: "unreadable", detail: messageOf(error) };
        }
    }

    const mine = parsed.get("mine");
    const theirs = parsed.get("theirs");
    if (mine === undefined || theirs === undefined) {
        return { blocked: "unreadable", detail: `the ${mine === undefined ? "your" : "their"} side of this document has no manifest` };
    }

    try {
        const merge = spec.merge3(parsed.get("base"), mine, theirs);
        if (!merge || !Array.isArray(merge.decisions)) {
            return { blocked: "unreadable", detail: `the ${spec.kind} spec returned no usable merge` };
        }
        return {
            spec,
            merge,
            set: {
                spec,
                key: location.key,
                manifestPath: location.manifestPath,
                files,
                conflicted: conflicted.sort(),
            },
        };
    } catch (error) {
        return { blocked: "unreadable", detail: `the ${spec.kind} spec threw while merging: ${messageOf(error)}` };
    }
}

type DocumentSetSideName = "base" | "mine" | "theirs";

/** The backend's three sides in the vocabulary a blocked reason is read in. */
const SIDE_WORD: Readonly<Record<DocumentSetSideName, string>> = {
    base: "the version both sides started from",
    mine: "your side",
    theirs: "their side",
};

/**
 * Every file of one set that is on disk, manifest first.
 *
 * A `readdir` rather than a walk, and the directory is the member pattern's business rather than
 * this module's - see {@link documentSetMemberScan}. Nothing here parses the manifest to find out
 * what its members are: rule 1 of the set model is that members are enumerated by path, and a
 * conflicted manifest is not parseable in the first place.
 */
function documentSetFilesOnDisk(
    root: string,
    spec: AnyDocumentSetSpec,
    key: Readonly<Record<string, string>>,
): readonly string[] {
    const manifestPath = documentSetManifestPath(spec, key);
    const scan = documentSetMemberScan(spec, key);
    let entries: string[];
    try {
        entries = fs.readdirSync(absoluteWithin(root, scan.directory));
    } catch {
        // No member directory at all is an ordinary answer: a set whose manifest is the only file
        // it has yet. It is not an ordinary answer for a MISSING manifest, and the assemble below
        // is what says so.
        entries = [];
    }

    const members = entries
        .map((entry) => scan.pathOf(entry))
        .filter((relative): relative is string => relative !== undefined && fs.existsSync(absoluteWithin(root, relative)))
        .sort();
    return fs.existsSync(absoluteWithin(root, manifestPath)) ? [manifestPath, ...members] : members;
}

/** Never throws: a lookup is asked about paths the backend chose, including ones it cannot parse. */
function safeLookup(sets: DocumentSetLookup, relativePath: string): DocumentSetLocation | undefined {
    try {
        return sets(relativePath);
    } catch {
        return undefined;
    }
}

/** Absolute, and inside the repository. Same guard `repositoryPath` applies (docs §4.16). */
function absoluteWithin(root: string, relativePath: string): string {
    const absolute = path.resolve(root, relativePath);
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Path escapes the repository: ${relativePath}`);
    }
    return absolute;
}

/** One side's bytes, or null when the merge did not leave that side here. */
function readSide(file: string): Buffer | null {
    try {
        return fs.readFileSync(file);
    } catch {
        return null;
    }
}

type ParsedSide =
    | { ok: true; document: unknown }
    | { ok: false; reason: string };

/**
 * Parse one side, without `loadDocument`'s quarantine.
 *
 * These bytes are the merge's own copy of a recorded side, so filing them as corrupt would file a
 * good file as bad - the same reason `documentDiff.tryParse` avoids it for a revision's blobs.
 */
function parseSide(spec: AnyDocumentSpec, relativePath: string, bytes: Buffer): ParsedSide {
    let raw: unknown;
    try {
        raw = JSON.parse(bytes.toString("utf-8"));
    } catch (error) {
        return { ok: false, reason: `not valid JSON: ${messageOf(error)}` };
    }
    try {
        return { ok: true, document: spec.parse(raw, parseContextFor(spec, relativePath, bytes)) };
    } catch (error) {
        return { ok: false, reason: messageOf(error) };
    }
}

function parseContextFor(spec: AnyDocumentSpec, relativePath: string, bytes: Buffer): DocumentParseContext {
    return {
        path: relativePath,
        corrupt(reason: string, options?: { cause?: unknown }): never {
            throw new DocumentCorruptError({
                kind: spec.kind,
                path: relativePath,
                reason,
                text: bytes.toString("utf-8"),
                cause: options?.cause,
            });
        },
    };
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
