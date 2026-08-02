import type {DocumentMergeDecision} from "./diff";

/**
 * Turning a list of per-change choices back into one document.
 *
 * The other half of {@link DocumentMerge3}: `merge3` says what the two sides did with each
 * addressable thing, this puts the author's answers back where they came from. Both halves have
 * to agree about addressing or the whole tier is unsound, which is why this is written once and
 * keyed off `DocumentMergeDecision.path` rather than off anything a caller invents.
 *
 * **Shared rather than main-process, because both processes need the same key.** The renderer
 * records a choice against a decision it was handed; the main process applies it against a
 * decision list it recomputed. If the two spelled a path differently the choice would silently
 * land on nothing - the author would press "keep theirs", the merge would take base, and the only
 * evidence would be in a file nobody re-reads.
 *
 * Nothing here knows any format. It walks plain JSON, because that is what a parsed document is by
 * the time it has come back from a spec, and because a per-format applier would be one more place
 * for the two halves to disagree.
 */

/** Which side of the merge one decision was settled with. */
export type DocumentMergeSideName = "mine" | "theirs";

/**
 * A decision's transportable identity.
 *
 * `JSON.stringify` rather than a joined string, and that is not fussiness: a path segment is a
 * document's own key - a translation unit id, an asset id - and those legitimately contain the
 * separators anyone would reach for first (`key:ui/menu/start` is a valid unit id). A joined key
 * would make two different decisions collide, and a collision here settles a path with the side
 * the author chose for a DIFFERENT one.
 */
export function mergeDecisionKey(path: readonly string[]): string {
    return JSON.stringify(path);
}

/**
 * A conflict the author never answered.
 *
 * Thrown rather than defaulted, and this is the single rule the tier rests on: every other outcome
 * of "no choice recorded" ends with a side being taken that nobody picked, in a file the author
 * will not re-read. The whole-document tier has the same guard one level up, where the backend
 * refuses the commit and names the path.
 */
export class MergeChangeUndecidedError extends Error {
    constructor(readonly documentPath: string, readonly changePath: readonly string[]) {
        super(`No side was chosen for ${changePath.join(" / ")} in ${documentPath}`);
        this.name = "MergeChangeUndecidedError";
    }
}

/** A decision that names a place the merged document does not have. */
export class MergeChangeUnaddressableError extends Error {
    constructor(readonly documentPath: string, readonly changePath: readonly string[], reason: string) {
        super(`${changePath.join(" / ")} cannot be settled in ${documentPath}: ${reason}`);
        this.name = "MergeChangeUnaddressableError";
    }
}

/**
 * Apply one side per decision to the document `merge3` handed back.
 *
 * **Every decision is applied, including the automatic ones.** `merge3` has already put the
 * auto-merged value in place, so re-applying it is a no-op - but writing it explicitly is what
 * makes the result a function of the decision list and the choices alone, rather than of the
 * merged document having been built correctly as well. The author flipping an `auto-*` row is then
 * the same operation as answering a conflict, not a second one.
 *
 * A choice is looked up by {@link mergeDecisionKey}. A decision with no choice falls back to the
 * side its outcome names; `conflict` names neither, so it throws.
 *
 * The document is copied before anything is written to it. The caller's copy came out of `merge3`
 * and may share structure with the parsed sides - a spec is free to hand back the very objects it
 * was given - so writing in place could mutate `mine` and make a second apply produce different
 * bytes from the same inputs.
 */
export function applyMergeDecisions<T>(
    documentPath: string,
    document: T,
    decisions: readonly DocumentMergeDecision[],
    choices: Readonly<Record<string, DocumentMergeSideName>>,
): T {
    const result = structuredClone(document) as unknown;

    for (const entry of decisions) {
        const chosen = choices[mergeDecisionKey(entry.path)] ?? defaultSide(entry);
        if (!chosen) {
            throw new MergeChangeUndecidedError(documentPath, entry.path);
        }
        const side = chosen === "mine" ? entry.mine : entry.theirs;
        if (entry.path.length === 0) {
            // A whole-document decision: the spec said it cannot merge this at all. There is
            // nothing to walk into, and the answer is the side itself.
            if (!side.present) {
                throw new MergeChangeUnaddressableError(documentPath, entry.path, "the chosen side has no document");
            }
            return structuredClone(side.value) as T;
        }
        if (side.present) {
            setAt(documentPath, result, entry.path, structuredClone(side.value));
        } else {
            removeAt(documentPath, result, entry.path);
        }
    }

    return result as T;
}

/** The side an outcome already settled on, or undefined when it is still the author's. */
function defaultSide(entry: DocumentMergeDecision): DocumentMergeSideName | undefined {
    if (entry.outcome === "auto-mine") return "mine";
    if (entry.outcome === "auto-theirs") return "theirs";
    return undefined;
}

/**
 * The container a path's last segment lives in, refusing rather than creating one.
 *
 * A missing container means the decision list and the merged document disagree about the shape of
 * this format, which is a defect in the spec rather than something to paper over: creating the
 * objects on the way down would write a decision into a place the document does not have and the
 * spec's own `serialize` would then either drop it or refuse.
 */
function containerAt(documentPath: string, root: unknown, path: readonly string[]): Record<string, unknown> | unknown[] {
    let current: unknown = root;
    for (let index = 0; index < path.length - 1; index += 1) {
        const segment = path[index];
        if (Array.isArray(current)) {
            current = current[elementIndex(documentPath, path, segment, current.length)];
        } else if (isRecord(current)) {
            current = current[segment];
        } else {
            throw new MergeChangeUnaddressableError(documentPath, path, `"${segment}" is not inside a collection`);
        }
        if (current === undefined || current === null) {
            throw new MergeChangeUnaddressableError(documentPath, path, `"${segment}" does not exist`);
        }
    }
    if (!Array.isArray(current) && !isRecord(current)) {
        throw new MergeChangeUnaddressableError(documentPath, path, "the path does not name a collection");
    }
    return current;
}

function setAt(documentPath: string, root: unknown, path: readonly string[], value: unknown): void {
    const container = containerAt(documentPath, root, path);
    const last = path[path.length - 1];
    if (Array.isArray(container)) {
        // Bounded by the current length +1: an index past the end would leave holes, which JSON
        // writes as `null` and no spec means.
        container[elementIndex(documentPath, path, last, container.length + 1)] = value;
        return;
    }
    container[last] = value;
}

/**
 * Remove what a side does not hold.
 *
 * **Refused inside an array, deliberately.** Deleting element 3 renumbers everything after it, so
 * the remaining decisions in the same list - addressed by index - would settle the wrong elements,
 * and the ones already applied would have moved. No spec produces indexed decisions today
 * (`mergeKeyed` is the only producer and it is keyed by id); the day one does, this has to be a
 * designed answer rather than a silent renumbering.
 */
function removeAt(documentPath: string, root: unknown, path: readonly string[]): void {
    const container = containerAt(documentPath, root, path);
    if (Array.isArray(container)) {
        throw new MergeChangeUnaddressableError(
            documentPath,
            path,
            "removing one element of a list would renumber the others, so it is not settled one change at a time",
        );
    }
    delete container[path[path.length - 1]];
}

function elementIndex(documentPath: string, path: readonly string[], segment: string, limit: number): number {
    const index = Number(segment);
    if (!Number.isInteger(index) || index < 0 || index >= limit) {
        throw new MergeChangeUnaddressableError(documentPath, path, `"${segment}" is not a position in this list`);
    }
    return index;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
