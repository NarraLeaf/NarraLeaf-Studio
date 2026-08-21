import {encodeCanonicalJson} from "./canonicalJson";
import {
    compileDocumentPathPattern,
    DocumentPathError,
    DocumentPathPattern,
    documentPathParameterNames,
    DocumentPathSegment,
    formatDocumentPath,
    matchDocumentPath,
    normalizeDocumentPath,
} from "./documentPath";
import {defineDocumentSpec, DocumentRegistry, DocumentSpecDefinition, resolveDocumentSpecForPath} from "./registry";
import {AnyDocumentSpec, DocumentParseContext, DocumentSpec} from "./types";

/**
 * One document that is stored as several files.
 *
 * **The gap this closes is that the document layer had no concept above a single file.** A spec
 * owns a path, `resolve()` maps one path to one spec, `merge3` takes one parsed value per side,
 * and the comparison budget is spent in paths. Every one of those is a fair model of a project
 * where a document is a file - and none of them survives a document being split into a manifest
 * plus a directory of members, which is where a story document is going (a `storydoc.json` of
 * chapters and scene stubs beside `scenes/<sceneId>.json`).
 *
 * Splitting it is not what this module does. This is the layer that has to exist first, and the
 * shape of it is decided by one requirement: **the format's own `diff`, `merge3` and `summarize`
 * must not know that the document was ever split.** `diffStoryDocument` needs a whole document to
 * answer anything at all - scene ordering, scene rank, the shared-scene set, the schema-version
 * gate are all whole-document facts - and a version of it that saw one scene at a time could not be
 * written, let alone written to keep its current signature. So a set spec is an ordinary
 * {@link DocumentSpec} over the WHOLE document, plus a {@link DocumentSetLayout} that says how the
 * whole is spread over files and how to put it back together.
 *
 * Three rules the rest of the layer is built on:
 *
 *  1. **Members are enumerated by PATH, never by the manifest's contents.** Every consumer has a
 *     list of paths in hand and none of them can afford to parse a manifest first: a revision
 *     comparison has two tree walks, a working-tree comparison has a status list plus one tree
 *     walk, and a merge has a directory of sidecars. A manifest-driven enumeration would also be a
 *     second source of truth for "which files is this document made of", and the two would
 *     disagree exactly when it mattered - a member file that no manifest lists is the shape a bad
 *     merge leaves behind. So: a path matching {@link DocumentSetLayout.memberPath} for a given set
 *     key is a member of that set, full stop, and {@link DocumentSetLayout.assemble} is handed
 *     whatever was found and gets to reject it.
 *  2. **A decision routes back to a member by disassembly, not by path arithmetic.** The author's
 *     answers are applied to the assembled document by the same `applyMergeDecisions` a single-file
 *     document uses - unchanged - and the settled document is then taken apart again. Whichever
 *     part a change lands in is the file that owns it, by construction. Deriving the owning file
 *     from a `DocumentChange.path` instead would be a third addressing scheme to keep in step with
 *     `diff` and `merge3`, and it could not express a change that legitimately touches two files
 *     (renaming a scene moves bytes in both the manifest's stub and the member).
 *  3. **A set is one unit of budget, one row, and one conflict.** Nothing downstream may spend a
 *     per-file allowance on a document's members or draw them as separate rows; see
 *     `DIFF_UNIT_LIMIT` in `vcs/diff/documentDiff.ts` for what that changed.
 */

/** The two roles a file can have inside a set. */
export type DocumentSetRole = "manifest" | "member";

/**
 * The document a set holds, taken apart into the values its files carry.
 *
 * Raw JSON on both sides of the boundary, not parsed documents: {@link DocumentSetLayout.assemble}
 * runs BEFORE `parse` (there is nothing to parse until the parts are folded together) and
 * {@link DocumentSetLayout.disassemble} runs after, producing what the encoder will write.
 */
export interface DocumentSetParts {
    readonly manifest: unknown;
    /** Keyed by member id - the value of the member path's own parameter, not a path. */
    readonly members: ReadonlyMap<string, unknown>;
}

export interface DocumentSetLayout<T> {
    /**
     * Where the manifest lives, e.g. `editor/story/stories/<storyId>/storydoc.json`.
     *
     * **It is also the set's name.** One manifest is one document: everything downstream that has
     * to report, key or select a set does it by this path, because it is the only path a set is
     * guaranteed to have exactly one of.
     */
    readonly manifestPath: string;
    /**
     * Where a member lives, e.g. `editor/story/stories/<storyId>/scenes/<sceneId>.json`.
     *
     * Must take every parameter the manifest takes plus exactly one more - the member's own id.
     * Fewer and two sets would share members; more and a member would need an identity the rest of
     * the layer has no way to carry.
     */
    readonly memberPath: string;

    /**
     * Fold the parts into the raw value {@link DocumentSpec.parse} is then handed.
     *
     * Called with whatever files were found (see rule 1 above), so it is where a set says what it
     * thinks of a member the manifest does not mention, or of a manifest that names a member with
     * no file. Both are ordinary answers - fold it in, drop it, or `context.corrupt(...)` - and the
     * choice belongs to the format, not here.
     *
     * Pure. It runs three times per merge and twice per comparison over documents that came out of
     * a repository.
     */
    assemble(parts: DocumentSetParts, context: DocumentParseContext): unknown;

    /**
     * Take a document apart into the parts its files carry. The inverse of {@link assemble}.
     *
     * The invariant, which `documentSet.test.ts` pins: for any `document` this spec's `parse` can
     * produce, `parse(assemble(disassemble(document)))` deep-equals `document`. Everything that
     * writes a set - the conflict resolver, and whatever adopts the format for its own saves -
     * rests on it, because a round trip that drops a field drops it from the author's project.
     */
    disassemble(document: T): DocumentSetParts;

    /** Canonical bytes for one part. Defaults to the canonical JSON encoder, like a plain spec. */
    serializePart?(part: unknown): string;
}

export interface DocumentSetSpec<T> extends DocumentSpec<T> {
    readonly set: DocumentSetLayout<T>;
}

/** A set spec whose document type is not known at the use site. See {@link AnyDocumentSpec}. */
export type AnyDocumentSetSpec = DocumentSetSpec<any>;

/** Where one path sits inside one set. */
export interface DocumentSetLocation {
    readonly spec: AnyDocumentSetSpec;
    /**
     * The set instance's identity - the manifest's own parameters, e.g. `{storyId: "a"}`.
     *
     * Two paths belong to the same document exactly when their specs and their keys are equal,
     * which is what {@link manifestPath} is the flattened spelling of.
     */
    readonly key: Readonly<Record<string, string>>;
    /** The manifest's path. The set's one name; see {@link DocumentSetLayout.manifestPath}. */
    readonly manifestPath: string;
    readonly role: DocumentSetRole;
    /** The member's own id, for `role: "member"` only. */
    readonly memberId?: string;
}

/**
 * Which set a repository-relative path belongs to, if any.
 *
 * A port rather than a direct registry call so a comparison can be driven over a registry a test
 * built, which is the only way to exercise this layer without registering a real document set - and
 * registering one is precisely what must not happen until the consumer that chunks the story lands.
 */
export type DocumentSetLookup = (relativePath: string) => DocumentSetLocation | undefined;

export interface DocumentSetSpecDefinition<T> extends Omit<DocumentSpecDefinition<T>, "paths" | "serialize"> {
    readonly manifestPath: string;
    readonly memberPath: string;
    assemble(parts: DocumentSetParts, context: DocumentParseContext): unknown;
    disassemble(document: T): DocumentSetParts;
    serializePart?(part: unknown): string;
}

/**
 * A spec that a set of files resolves, diffs and merges as.
 *
 * `paths` is derived rather than declared, so the manifest and the member family are the two
 * patterns the registry compares and `matches` answers for both - which is what makes a member path
 * resolve to the whole document rather than to nothing. `pathFor` addresses both too, by the
 * parameters it is handed: the set's own key builds the manifest, the key plus the member parameter
 * builds a member. That falls out of `selectPattern` and is asserted rather than assumed.
 */
export function defineDocumentSetSpec<T>(definition: DocumentSetSpecDefinition<T>): DocumentSetSpec<T> {
    const manifest = compileDocumentPathPattern(definition.manifestPath);
    const member = compileDocumentPathPattern(definition.memberPath);
    assertMemberExtendsManifest(definition.kind, manifest, member);

    const spec = defineDocumentSpec<T>({
        ...definition,
        paths: [manifest.source, member.source],
        // **A set has no single-file bytes, and saying so is the point.** The default encoder would
        // answer with the whole assembled document, which is a file that exists nowhere and which
        // `saveDocument` would happily write over the manifest, silently collapsing the set back
        // into one file. Callers that mean to write a set call `serializeDocumentSet`; the ones
        // that do not mean to, find out here rather than on the author's disk.
        serialize: () => {
            throw new DocumentSetWriteError(
                `The "${definition.kind}" document is stored as ${manifest.source} plus ${member.source}, `
                + "so it cannot be written to one path. Use serializeDocumentSet.",
            );
        },
    });

    return {
        ...spec,
        set: {
            manifestPath: manifest.source,
            memberPath: member.source,
            assemble: definition.assemble,
            disassemble: definition.disassemble,
            ...(definition.serializePart ? {serializePart: definition.serializePart} : {}),
        },
    };
}

/** Attempting to write a set as though it were one file. */
export class DocumentSetWriteError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DocumentSetWriteError";
    }
}

export function isDocumentSetSpec(spec: AnyDocumentSpec | undefined): spec is AnyDocumentSetSpec {
    return Boolean(spec && typeof (spec as AnyDocumentSetSpec).set === "object");
}

/**
 * The default {@link DocumentSetLookup}: ask the registry Studio itself uses.
 *
 * Undefined for everything today, and that is correct - no document set is registered yet. It never
 * throws, on `specForDocumentPath`'s terms: Lore reports absolute paths, and one odd entry in a tree
 * must not take out the comparison it appears in.
 */
export function documentSetAt(relativePath: string): DocumentSetLocation | undefined {
    let match: ReturnType<typeof resolveDocumentSpecForPath>;
    try {
        match = resolveDocumentSpecForPath(relativePath);
    } catch {
        return undefined;
    }
    return match && isDocumentSetSpec(match.spec)
        ? locationOf(match.spec, relativePath, match.parameters)
        : undefined;
}

/**
 * {@link documentSetAt} against an isolated registry, for a caller holding its own specs.
 *
 * A real {@link DocumentRegistry} rather than a loop over patterns, so a lookup built for a test
 * gets the same overlap refusal and the same most-specific-wins rule the default one applies. A
 * lookup that resolved differently from the registry would make every test of this layer a test of
 * something Studio does not do.
 */
export function documentSetLookupOver(specs: readonly AnyDocumentSpec[]): DocumentSetLookup {
    const registry = new DocumentRegistry();
    for (const spec of specs) {
        registry.register(spec);
    }
    return relativePath => {
        let match: ReturnType<DocumentRegistry["resolve"]>;
        try {
            match = registry.resolve(relativePath);
        } catch {
            return undefined;
        }
        return match && isDocumentSetSpec(match.spec)
            ? locationOf(match.spec, relativePath, match.parameters)
            : undefined;
    };
}

/** The manifest path of the set instance `key` names. */
export function documentSetManifestPath(
    spec: AnyDocumentSetSpec,
    key: Readonly<Record<string, string>>,
): string {
    return spec.pathFor(key);
}

/** The path of one member of the set instance `key` names. */
export function documentSetMemberPath(
    spec: AnyDocumentSetSpec,
    key: Readonly<Record<string, string>>,
    memberId: string,
): string {
    return spec.pathFor({...key, [memberParameterOf(spec)]: memberId});
}

/** The name of the member path's own parameter, e.g. `"sceneId"`. */
export function memberParameterOf(spec: AnyDocumentSetSpec): string {
    const manifest = new Set(documentPathParameterNames(compileDocumentPathPattern(spec.set.manifestPath)));
    const extra = documentPathParameterNames(compileDocumentPathPattern(spec.set.memberPath))
        .filter(name => !manifest.has(name));
    // `defineDocumentSetSpec` has already refused anything else; this is the post-condition.
    return extra[0];
}

/**
 * One thing a comparison, an index or a conflict list is about.
 *
 * The unit the whole layer counts in. A file that no set claims is its own unit; every path of one
 * set is one unit however many files that is. See `DIFF_UNIT_LIMIT`.
 */
export type DocumentUnit =
    | {readonly kind: "file"; readonly path: string}
    | {
        readonly kind: "set";
        readonly spec: AnyDocumentSetSpec;
        readonly key: Readonly<Record<string, string>>;
        /** The set's name, and this unit's identity. May not itself be among {@link paths}. */
        readonly path: string;
        /** The paths handed in that folded into this unit, sorted. Never empty. */
        readonly paths: readonly string[];
    };

/**
 * Fold a list of paths into the documents they belong to.
 *
 * **Reads nothing and parses nothing** - it is path arithmetic over the registry - which is what
 * lets it run before a budget is spent rather than after. A comparison that folded after reading
 * would have already paid for what the fold exists to avoid.
 *
 * Sorted by each unit's identity path, so the answer does not depend on the order the paths
 * arrived in. That matters more than it looks: the unit order is the order a budget is spent, so an
 * unstable one would make WHICH documents get compared depend on tree-walk order.
 */
export function foldDocumentSetPaths(
    paths: readonly string[],
    lookup: DocumentSetLookup = documentSetAt,
): readonly DocumentUnit[] {
    const files: string[] = [];
    const sets = new Map<string, {spec: AnyDocumentSetSpec; key: Readonly<Record<string, string>>; paths: string[]}>();

    for (const path of paths) {
        // Guarded even though both lookups here answer rather than throw: this runs over the whole
        // changed list of a comparison, and one odd path - an absolute one out of Lore, a name from
        // a future layout - must cost its own row rather than the other two thousand.
        let location: DocumentSetLocation | undefined;
        try {
            location = lookup(path);
        } catch {
            location = undefined;
        }
        if (!location) {
            files.push(path);
            continue;
        }
        const existing = sets.get(location.manifestPath);
        if (existing) {
            existing.paths.push(path);
            continue;
        }
        sets.set(location.manifestPath, {spec: location.spec, key: location.key, paths: [path]});
    }

    const units: DocumentUnit[] = files.map(path => ({kind: "file", path}));
    for (const [path, entry] of sets) {
        units.push({kind: "set", spec: entry.spec, key: entry.key, path, paths: [...entry.paths].sort(compare)});
    }
    return units.sort((a, b) => compare(a.path, b.path));
}

/**
 * Every path of a set instance that exists among `candidates`, manifest first.
 *
 * The other half of rule 1: a fold groups the paths that CHANGED, and assembling needs the paths
 * that EXIST. Both callers have a listing in hand - two tree walks for a revision comparison, a
 * tree walk plus a status list for a working-tree one - so this is a filter rather than a walk.
 */
export function documentSetPathsAmong(
    spec: AnyDocumentSetSpec,
    key: Readonly<Record<string, string>>,
    candidates: Iterable<string>,
): readonly string[] {
    const manifestPath = documentSetManifestPath(spec, key);
    const memberPattern = compileDocumentPathPattern(spec.set.memberPath);
    const members: string[] = [];
    let hasManifest = false;

    for (const candidate of candidates) {
        let normalized: string;
        try {
            normalized = normalizeDocumentPath(candidate);
        } catch {
            continue;
        }
        if (normalized === manifestPath) {
            hasManifest = true;
            continue;
        }
        const parameters = matchDocumentPath(memberPattern, normalized);
        if (parameters && Object.keys(key).every(name => parameters[name] === key[name])) {
            members.push(normalized);
        }
    }

    members.sort(compare);
    return hasManifest ? [manifestPath, ...members] : members;
}

/**
 * Where to look for a set's member files, for a caller whose only listing is a directory.
 *
 * The merge is that caller: it has the working tree and nothing else - no tree walk, no status
 * list - and rule 1 says members are enumerated by path, so it has to read a directory. Which
 * directory is decided here rather than there, because the answer is the member pattern's
 * business: every segment before the member's own parameter is either a literal or one of the
 * manifest's parameters, so the directory is fully determined by the set key.
 *
 * `pathOf` turns one directory entry into the member path it would be, or `undefined` for an entry
 * that is not a member of this set - a `.png` beside the pages, a temporary file, the wrong shape
 * entirely. Callers must not build member paths any other way: an id carrying a separator would
 * otherwise produce a path this very pattern does not recognise.
 */
export function documentSetMemberScan(
    spec: AnyDocumentSetSpec,
    key: Readonly<Record<string, string>>,
): {readonly directory: string; pathOf(entryName: string): string | undefined} {
    const pattern = compileDocumentPathPattern(spec.set.memberPath);
    const parameter = memberParameterOf(spec);
    const at = pattern.segments.findIndex(segment => segment.kind === "parameter" && segment.name === parameter);
    if (at < 0) {
        // `defineDocumentSetSpec` refuses a member family without exactly one id of its own, so this
        // is a spec assembled by hand. Loud, because the quiet version is `slice(0, -1)` silently
        // dropping the last segment and a merge then listing the wrong directory.
        throw new DocumentPathError(
            `The "${spec.kind}" document set's member path "${pattern.source}" has no member parameter.`,
        );
    }
    const before = pattern.segments.slice(0, at).map(segment => resolveSegment(segment, key));
    const after = pattern.segments.slice(at + 1).map(segment => resolveSegment(segment, key));

    return {
        directory: before.join("/"),
        pathOf(entryName: string): string | undefined {
            const candidate = [...before, entryName, ...after].join("/");
            // **A manifest is not one of its own members**, and it CAN match the member pattern:
            // `<id>/index.json` beside `<id>/<name>.json` is a legal layout, because the literal is
            // the more specific of the two and the registry lets the specific one win for its own
            // path. The other two readers of a set's files - `documentSetPathsAmong` and
            // `documentSetPartsFrom` - both take the manifest out by name; this one did not, so a
            // scan of that layout answered with the manifest twice.
            if (candidate === documentSetManifestPath(spec, key)) {
                return undefined;
            }
            const parameters = matchDocumentPath(pattern, candidate);
            if (!parameters || Object.keys(key).some(name => parameters[name] !== key[name])) {
                return undefined;
            }
            return candidate;
        },
    };
}

function resolveSegment(segment: DocumentPathSegment, key: Readonly<Record<string, string>>): string {
    if (segment.kind === "literal") {
        return segment.text;
    }
    const value = key[segment.name];
    if (typeof value !== "string" || value.length === 0) {
        throw new DocumentPathError(`Cannot locate a member: <${segment.name}> is missing from the set's key.`);
    }
    return `${segment.prefix}${value}${segment.suffix}`;
}

/**
 * The parts a set's files carry, keyed the way {@link DocumentSetLayout.assemble} wants them.
 *
 * `raw` is the JSON already parsed out of each file's bytes; a path with no entry is a file that
 * was not there. Throws {@link DocumentSetIncompleteError} when the manifest is one of them - a set
 * with no manifest is not a document at all, and folding its members into an invented empty one
 * would be exactly the add/add mistake `merge3`'s contract refuses.
 */
export function documentSetPartsFrom(
    spec: AnyDocumentSetSpec,
    key: Readonly<Record<string, string>>,
    raw: ReadonlyMap<string, unknown>,
): DocumentSetParts {
    const manifestPath = documentSetManifestPath(spec, key);
    if (!raw.has(manifestPath)) {
        throw new DocumentSetIncompleteError(manifestPath);
    }

    const memberPattern = compileDocumentPathPattern(spec.set.memberPath);
    const parameter = memberParameterOf(spec);
    const members = new Map<string, unknown>();
    for (const [path, value] of raw) {
        if (path === manifestPath) {
            continue;
        }
        const parameters = matchDocumentPath(memberPattern, path);
        if (parameters && Object.keys(key).every(name => parameters[name] === key[name])) {
            members.set(parameters[parameter], value);
        }
    }

    return {manifest: raw.get(manifestPath), members};
}

/** A set whose manifest is not among the files that were read. */
export class DocumentSetIncompleteError extends Error {
    constructor(readonly manifestPath: string) {
        super(`The document set at ${manifestPath} has no manifest, so its members cannot be assembled.`);
        this.name = "DocumentSetIncompleteError";
    }
}

/**
 * Fold the parts and parse the result - the whole document, as the format's own `diff`, `merge3`
 * and `summarize` expect to see it.
 *
 * Throws whatever `assemble` or `parse` throw, which for a well-behaved spec is a
 * `DocumentCorruptError` naming the reason. Callers that must not throw wrap it, exactly as they
 * already wrap a single file's `parse`.
 */
export function assembleDocumentSet<T>(
    spec: DocumentSetSpec<T>,
    parts: DocumentSetParts,
    context: DocumentParseContext,
): T {
    return spec.parse(spec.set.assemble(parts, context), context);
}

/**
 * The bytes each of a set's files should hold, keyed by repository-relative path.
 *
 * The one way to write a set. Every part is serialized before anything is handed back, so a
 * document the encoder rejects cannot half-replace a good set on disk - the same order
 * `saveDocument` takes for one file, for the same reason.
 */
export function serializeDocumentSet<T>(
    spec: DocumentSetSpec<T>,
    key: Readonly<Record<string, string>>,
    document: T,
): ReadonlyMap<string, string> {
    const parts = spec.set.disassemble(document);
    const encode = spec.set.serializePart ?? encodeCanonicalJson;
    const bytes = new Map<string, string>();
    bytes.set(documentSetManifestPath(spec, key), encode(parts.manifest));
    for (const [memberId, value] of parts.members) {
        bytes.set(documentSetMemberPath(spec, key, memberId), encode(value));
    }
    return bytes;
}

function locationOf(
    spec: AnyDocumentSetSpec,
    relativePath: string,
    parameters: Readonly<Record<string, string>>,
): DocumentSetLocation {
    const parameter = memberParameterOf(spec);
    const memberId = parameters[parameter];
    const key = Object.fromEntries(Object.entries(parameters).filter(([name]) => name !== parameter));
    return {
        spec,
        key,
        manifestPath: documentSetManifestPath(spec, key),
        role: memberId === undefined ? "manifest" : "member",
        ...(memberId === undefined ? {} : {memberId}),
    };
}

/**
 * A member family has to be the manifest's parameters plus exactly one.
 *
 * Refused at definition time rather than left to surface as a wrong answer: a member pattern
 * missing one of the manifest's parameters makes two different documents share members, and one
 * with two extra parameters gives a member an identity that nothing downstream - not
 * `DocumentSetLocation.memberId`, not `DocumentSetParts.members`, not a decision's route home - has
 * anywhere to put.
 */
function assertMemberExtendsManifest(
    kind: string,
    manifest: DocumentPathPattern,
    member: DocumentPathPattern,
): void {
    const manifestNames = documentPathParameterNames(manifest);
    const memberNames = documentPathParameterNames(member);
    const missing = manifestNames.filter(name => !memberNames.includes(name));
    const extra = memberNames.filter(name => !manifestNames.includes(name));

    if (missing.length > 0) {
        throw new DocumentPathError(
            `The "${kind}" document set's member path "${member.source}" does not take `
            + `${missing.map(name => `<${name}>`).join(", ")}, so two different sets would share members.`,
        );
    }
    if (extra.length !== 1) {
        throw new DocumentPathError(
            `The "${kind}" document set's member path "${member.source}" must take exactly one parameter `
            + `beyond the manifest's, naming which member it is; it takes ${extra.length}`
            + `${extra.length === 0 ? "" : ` (${extra.map(name => `<${name}>`).join(", ")})`}.`,
        );
    }
    // `pathFor` picks a pattern by exactly which parameters it was handed, so a member family whose
    // parameters cannot be told apart from the manifest's would make `documentSetMemberPath` build
    // the manifest instead. Proven here rather than trusted.
    const probe = Object.fromEntries(manifestNames.map(name => [name, "x"]));
    const built = formatDocumentPath(member, {...probe, [extra[0]]: "y"});
    if (matchDocumentPath(member, built) === null) {
        throw new DocumentPathError(
            `The "${kind}" document set's member path "${member.source}" does not read back as its own member.`,
        );
    }
}

function compare(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
