import {
    compileDocumentPathPattern,
    matchDocumentPath,
    type DocumentPathPattern,
} from "@shared/documents/documentPath";
import { resolveDocumentSpecForPath } from "@shared/documents/registry";
// Imported for the registration inside it, and it is not optional: `resolveDocumentSpecForPath`
// answers out of the registry, and a process that reaches this module without the specs having
// been registered gets `undefined` for every path - which would name every document in the project
// after the file it is stored in, silently and everywhere at once.
import "@shared/documents/specs";
import type { DocumentKind } from "@shared/documents/types";
import type { TranslationKey, Translator } from "@shared/i18n";
import { assetStorageIdFromContentPath } from "@shared/utils/assetStorageId";

/**
 * What an author calls the thing a changed file holds.
 *
 * Version control works from paths, and every surface it feeds used to draw one: the index listed a
 * project's stories as several rows all called `storydoc.json`, told apart by a dim uuid beside
 * them; the interface arrived as `uidoc.json` and `uigraphs.json`; the cast as `character.json`.
 * None of those is a thing anybody made. The author made **a scene called The Forest**, and the file
 * it is stored in is an implementation detail of Studio that they never chose and cannot rename.
 *
 * So this is the layer that turns a path into a name, and the shape it answers in is the shape the
 * asset rows already had (`assetRows.ts`): a row's TITLE is the author's own word for the thing, and
 * the path it is stored at goes in the tooltip. Category headings did the same thing one level up -
 * they are named after the panel the author edits that thing in, never after a directory
 * (`changeCategory.ts`) - and this finishes the same job on the rows underneath them.
 *
 * ## The three answers, and why there is no fourth
 *
 *  - **Its own name**, for a thing the author named: a story's title, an asset's name.
 *  - **The name of its kind**, for a thing that has no name of its own because there is only ever
 *    one of it - "Project settings", "Variables", "Save fields", "Cast". Never the file name: an
 *    author who has never seen `save-schema.json` learns nothing from being shown it, and one who
 *    has learns only that Studio thinks in files.
 *  - **The name of its kind plus what tells two of them apart**, for a thing that HAS a name which
 *    could not be read - and this is the one that must never be quietly turned into either of the
 *    other two.
 *
 * ## The honesty rule this module exists to keep
 *
 * A name can fail to resolve: the sibling index that holds it may be missing from the comparison,
 * unreadable, or dropped by the read budget. **When that happens no name is invented and none is
 * borrowed.** Two stories whose titles cannot be read must not become two rows reading "Story",
 * because an author cannot act on a list they cannot tell apart - and must not become two rows
 * reading `storydoc.json` either, which is the failure this module replaces. They become "Story"
 * plus the identifier the path already carries, which is not a name, does not read as one, and is
 * different for every story in the project. {@link DocumentName} keeps that case as a `source` of
 * its own so a surface can see it, and `renderDocumentName` folds the identifier into the label
 * rather than handing it back separately - a caller that drew only half would be back to two
 * identical rows.
 *
 * No React and no workspace, for the reason `changeIndex.ts` has none: it is the model behind four
 * surfaces (the comparison index, its detail line, the split tab's title and the version rail's
 * change list) and every one of them has to agree with the others.
 */

/**
 * What the naming layer has been told, beyond the path itself.
 *
 * One field today, and the interface exists rather than a bare map because the next name that lives
 * in a sibling document - an animation's, a variant's - arrives here and not at four call sites.
 */
export interface DocumentNameContext {
    /**
     * Story titles by story id, as the story index gives them.
     *
     * A story missing from this map cannot be named, and that is reported rather than papered over.
     * The map does not distinguish "the index was never read" from "the index does not name this
     * story" on purpose: both mean this pass has no title, and a surface that told them apart would
     * have to word the difference for an author who cannot act on either one.
     */
    readonly storyTitles: ReadonlyMap<string, string>;
}

/** Nothing was read. Every document still gets a name; the ones with titles get the honest fallback. */
export const NO_DOCUMENT_NAMES: DocumentNameContext = { storyTitles: new Map() };

/**
 * What to call one document.
 *
 * A union rather than a string, because the four cases are four different claims and a surface that
 * cannot tell them apart cannot draw them honestly. `renderDocumentName` is the one place they
 * become text, so no surface has to know which is which in order to be correct.
 */
export type DocumentName =
    /** The author's own name for this thing. */
    | { readonly source: "authored"; readonly text: string }
    /**
     * The name of the kind, for a thing with no name of its own.
     *
     * The qualifier is a fact the path states outright and that the author chose - a locale, an
     * asset type - so it is not a shortfall: `Translations (zh-CN)` is the complete answer.
     */
    | { readonly source: "kind"; readonly key: TranslationKey; readonly qualifier: string | null }
    /**
     * A thing that has a name, whose name this pass could not read.
     *
     * The qualifier is mandatory here, and it is what stops two of these collapsing into one
     * unreadable row. It is an identifier rather than a word, which is the point: it can be
     * compared, searched for and matched against the tooltip's path, and it cannot be mistaken for
     * something the author typed.
     */
    | { readonly source: "unnamed"; readonly key: TranslationKey; readonly qualifier: string }
    /**
     * A file no document format claims - a script, a note, an icon the author dropped in.
     *
     * The whole repository-relative path rather than its last segment. Studio has no concept for
     * this file, so its path is the only name it has, and two `build.js` in two directories are two
     * files that an author has to be able to tell apart.
     */
    | { readonly source: "file"; readonly path: string };

/**
 * Every document format, and what the author calls it.
 *
 * A `Record` over the whole union rather than a lookup with a fallback, for the reason
 * `CHANGE_CATEGORY_BY_DOCUMENT_KIND` is one: adding a member to {@link DocumentKind} fails to
 * compile here, which is the only thing that stops a new format arriving in front of an author
 * wearing its file name.
 */
export const DOCUMENT_KIND_NAME_KEY: Record<DocumentKind, TranslationKey> = {
    project: "documentDiff.name.project",
    "story-index": "documentDiff.name.storyIndex",
    story: "documentDiff.name.story",
    "story-animation-index": "documentDiff.name.animationIndex",
    "story-animation": "documentDiff.name.animation",
    "ui-document": "documentDiff.name.uiDocument",
    "ui-graphs": "documentDiff.name.uiGraphs",
    variables: "documentDiff.name.variables",
    "audio-tracks": "documentDiff.name.audioTracks",
    brand: "documentDiff.name.brand",
    "app-tags": "documentDiff.name.appTags",
    dlc: "documentDiff.name.dlc",
    dictionary: "documentDiff.name.dictionary",
    "transform-presets": "documentDiff.name.transformPresets",
    "save-schema": "documentDiff.name.saveSchema",
    "asset-sets": "documentDiff.name.assetSets",
    localization: "documentDiff.name.localization",
    "localization-keys": "documentDiff.name.localizationKeys",
    voice: "documentDiff.name.voice",
    "assets-metadata": "documentDiff.name.assetsMetadata",
    "assets-groups": "documentDiff.name.assetsGroups",
    characters: "documentDiff.name.characters",
};

/**
 * What a content file with no asset record beside it is called.
 *
 * Exported so `assetRows.ts`'s orphan label and this module cannot end up naming the same file two
 * ways: an unpaired content file is drawn by whichever of the two has the stronger claim, and both
 * of them qualify the row with the storage id, so the two spellings agree line for line.
 */
export const ASSET_CONTENT_NAME_KEY = "documentDiff.name.assetContent" as TranslationKey;

/**
 * The captured parameter that identifies one document of a kind there are several of.
 *
 * Only the ones an author would recognise. `project` captures the project's own file name and is
 * deliberately absent: there is exactly one project settings document, and qualifying it would put
 * the file name back on the row this whole module exists to take it off.
 */
const QUALIFIER_PARAMETER: Partial<Record<DocumentKind, string>> = {
    localization: "locale",
    voice: "locale",
    "assets-metadata": "type",
};

/** A document Studio writes that no spec claims yet, and what the author calls it. */
interface UnclaimedDocument {
    readonly pattern: DocumentPathPattern;
    readonly key: TranslationKey;
    /** The captured parameter that tells two of these apart, when there can be two. */
    readonly qualifier?: string;
}

/**
 * The documents the registry does not answer for, in order of specificity.
 *
 * Not every file Studio writes has a document spec - the animation library and the asset browser's
 * own shards have none - and a path a spec does not claim would otherwise fall through to being
 * named after itself, which is exactly the four rows the version rail was drawing.
 *
 * The story index used to be the first entry here and is now claimed by `storyIndexSpec`, which
 * answers with the same key one step earlier. Its name is therefore in `DOCUMENT_KIND_NAME_KEY`
 * only, and the two spellings cannot drift because there is no longer a second one.
 *
 * **First match wins, so the order is load-bearing**: `editor/story/animations/index.json` is also
 * a `<animationId>.json`, and the animation list is not an animation.
 */
const UNCLAIMED_DOCUMENTS: readonly UnclaimedDocument[] = [
    {
        pattern: compileDocumentPathPattern("editor/story/animations/index.json"),
        key: "documentDiff.name.animationIndex",
    },
    {
        pattern: compileDocumentPathPattern("editor/story/animations/<animationId>.json"),
        key: "documentDiff.name.animation",
        qualifier: "animationId",
    },
    {
        pattern: compileDocumentPathPattern("assets/assets.groups.<category>.json"),
        key: "documentDiff.name.assetsGroups",
        qualifier: "category",
    },
    {
        pattern: compileDocumentPathPattern("assets/assets.order.<category>.json"),
        key: "documentDiff.name.assetsOrder",
        qualifier: "category",
    },
];

/**
 * What to call the document at `path`.
 *
 * Total: every path gets an answer, because a comparison that lists a file the author changed and
 * cannot say anything about it is worse than one that names it after its own path.
 */
export function documentNameOf(path: string, context: DocumentNameContext): DocumentName {
    const match = resolvePath(path, resolveDocumentSpecForPath);
    if (match) {
        const kind = match.spec.kind;
        if (kind === "story") {
            return storyName(match.parameters.storyId ?? "", context);
        }
        const parameter = QUALIFIER_PARAMETER[kind];
        return {
            source: "kind",
            key: DOCUMENT_KIND_NAME_KEY[kind],
            qualifier: parameter ? match.parameters[parameter] ?? null : null,
        };
    }

    for (const unclaimed of UNCLAIMED_DOCUMENTS) {
        const parameters = resolvePath(path, candidate => matchDocumentPath(unclaimed.pattern, candidate) ?? undefined);
        if (parameters) {
            return {
                source: "kind",
                key: unclaimed.key,
                qualifier: unclaimed.qualifier ? parameters[unclaimed.qualifier] ?? null : null,
            };
        }
    }

    // An asset's bytes, stored under its id rather than beside its record. Which asset it belongs to
    // is in a metadata shard that this pass has not read - `assetRows.ts` is what pairs the two when
    // the comparison carries both - so the honest answer is what the file is plus the id it is filed
    // under, and never the shard of that id the path ends in.
    const storageId = assetStorageIdFromContentPath(path);
    if (storageId !== null) {
        return { source: "kind", key: ASSET_CONTENT_NAME_KEY, qualifier: storageId };
    }

    return { source: "file", path: normalizeSeparators(path) };
}

/**
 * A story's name, which is its title, which is not in the story document.
 *
 * It lives in `editor/story/index.json` - the library the story panel draws - so naming a story
 * means reading a sibling. See `storyTitles.ts` for which SIDE of a comparison that sibling is read
 * from; by the time a title reaches here the decision is already made.
 */
function storyName(storyId: string, context: DocumentNameContext): DocumentName {
    const title = context.storyTitles.get(storyId);
    if (title !== undefined && title.trim().length > 0) {
        return { source: "authored", text: title };
    }
    return { source: "unnamed", key: DOCUMENT_KIND_NAME_KEY.story, qualifier: storyId };
}

/**
 * What one name reads as, as ONE string.
 *
 * One string rather than a title and a qualifier side by side, and that is the honesty rule in the
 * type system: an unnamed thing is told apart from its neighbours by the qualifier alone, so a
 * surface that took the two separately could draw the title and drop the rest - and a project's
 * unnamed stories would be a column of identical rows again. Where a surface has room for the path
 * as well, the path is a second element beside this one, never a replacement for the qualifier.
 */
export function renderDocumentName(name: DocumentName, t: Translator["t"]): string {
    switch (name.source) {
        case "authored":
            return name.text;
        case "file":
            return name.path;
        case "kind":
            return name.qualifier
                ? t("documentDiff.name.qualified", { name: t(name.key), qualifier: name.qualifier })
                : t(name.key);
        case "unnamed":
            return t("documentDiff.name.qualified", { name: t(name.key), qualifier: name.qualifier });
    }
}

/** Whether this name is the author's own word for the thing, rather than one Studio supplied. */
export function isAuthoredName(name: DocumentName): boolean {
    return name.source === "authored";
}

/**
 * A few documents, named, one per line - for a place with room for a short list and no columns.
 *
 * The notice a conflicted sync leaves is the caller this exists for, and it exists because that
 * notice used to print repository paths at an author while the panel it sends them to called the
 * same files by their titles. One of the two was Studio talking about its own storage, and it was
 * the one that arrived first.
 *
 * The limit is the caller's, and truncation is silent HERE on purpose: this returns lines, and how
 * to say "and more" belongs to the surface that knows how much room it has. Every caller so far
 * pairs it with a count of the whole set, so nothing is hidden by the pairing.
 */
export function listDocumentNames(
    paths: readonly string[],
    context: DocumentNameContext,
    t: Translator["t"],
    limit: number,
): string {
    return paths
        .slice(0, limit)
        .map(path => renderDocumentName(documentNameOf(path, context), t))
        .join("\n");
}

/**
 * Run a path matcher that refuses paths it cannot read.
 *
 * `normalizeDocumentPath` throws on an absolute path, a `..` segment or an empty one, and every
 * matcher here goes through it. A comparison should never carry such a path - the producer reports
 * repository-relative ones - but this module also names paths that arrive from the version rail's
 * own status scan, and a naming layer is the wrong place for a surface to fall over.
 */
function resolvePath<T>(path: string, matcher: (candidate: string) => T | undefined): T | undefined {
    try {
        return matcher(path);
    } catch {
        return undefined;
    }
}

/** Windows separators are accepted for the reason `normalizeDocumentPath` accepts them. */
function normalizeSeparators(path: string): string {
    return path.replace(/\\/g, "/");
}
