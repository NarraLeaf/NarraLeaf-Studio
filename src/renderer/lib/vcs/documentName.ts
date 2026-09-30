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
import { assetStorageIdFromShards } from "@shared/utils/assetStorageId";
import { AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";

/**
 * What an author calls the thing a changed file holds.
 *
 * Version control works from paths, and every surface it feeds used to draw one: the index listed a
 * project's stories as several rows all called `storydoc.json`, told apart by a dim uuid beside
 * them; the interface arrived as `uidoc.json` and `uigraphs.json`; the cast as `character.json`; an
 * imported picture as `assets/content/f5/e8/519a…`. None of those is a thing anybody made. The
 * author made **a scene called The Forest** and imported **a picture called Forest Clearing**, and
 * the file each is stored in is an implementation detail of Studio that they never chose and cannot
 * rename.
 *
 * So this is the layer that turns a path into a name, and the shape it answers in is the shape the
 * asset rows already had (`assetRows.ts`): a row's TITLE is the author's own word for the thing.
 * Category headings did the same thing one level up - they are named after the panel the author
 * edits that thing in, never after a directory (`changeCategory.ts`) - and this finishes the same
 * job on the rows underneath them.
 *
 * ## The three answers, and why there is no fourth
 *
 *  - **Its own name**, for a thing the author named: a story's title, a motion's name, an asset's
 *    name - read from the library that holds it, which for a deleted thing is the older version's.
 *  - **The name of its kind**, for a thing that has no name of its own because there is only ever
 *    one of it - "Project settings", "Variables", "Save fields", "Cast". Never the file name: an
 *    author who has never seen `save-schema.json` learns nothing from being shown it, and one who
 *    has learns only that Studio thinks in files.
 *  - **The name of its kind, said as a stand-in**, for a thing that HAS a name which could not be
 *    read - "Story", "Image asset" - and this is the one that must never be quietly turned into
 *    either of the other two.
 *
 * ## The honesty rule this module exists to keep
 *
 * A name can fail to resolve: the sibling library that holds it may be missing, unreadable, or past
 * the read ceiling. **When that happens no name is invented and none is borrowed** - and, since the
 * interface never shows a uuid, the identifier the path carries is not borrowed either. The thing is
 * called what it is ("Story", "Image asset"), which is true and is all this pass knows.
 *
 * What that costs is telling two of them apart, and a list is where that is paid back:
 * {@link numberRepeatedNames} numbers stand-ins that would otherwise read the same within one list,
 * so two unreadable stories are "Story 1" and "Story 2" rather than a column of identical rows. The
 * number is a position in the list and claims nothing about the thing, which is why it is only ever
 * put on a stand-in and never on an author's own name - two assets called `bg.png` are both called
 * that, and numbering them would be inventing a name.
 *
 * No React and no workspace, for the reason `changeIndex.ts` has none: it is the model behind every
 * surface that names a changed file (the comparison index, its detail line, the split tab's title,
 * the version rail's change list, the merge panel and the notice a conflicted sync leaves) and every
 * one of them has to agree with the others.
 */

/** An asset's name and type, as its library record gives them. */
export interface AssetNameEntry {
    /** The author's name for it. Empty when the record has none, which is a real state. */
    readonly name: string;
    /** The asset type the record is filed under - the shard's own type, not a field. */
    readonly type: string;
}

/**
 * What the naming layer has been told, beyond the path itself.
 *
 * Every name that lives in a sibling document rather than in the file being named. Each map is
 * keyed by the id the PATH carries, because the path is all a row has to look one up with.
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
    /** Motion names by animation id, as the motion library (`editor/story/animations/index.json`) gives them. */
    readonly animationNames: ReadonlyMap<string, string>;
    /**
     * Asset names by storage id, lower-cased, from every metadata shard.
     *
     * Lower-cased because a content path is: `assetStorageIdFromContentPath` accepts lower-case
     * shards only, while a shard's key is whatever was written into the JSON.
     */
    readonly assetNames: ReadonlyMap<string, AssetNameEntry>;
}

/** Nothing was read. Every document still gets a name; the ones with names of their own get a stand-in. */
export const NO_DOCUMENT_NAMES: DocumentNameContext = {
    storyTitles: new Map(),
    animationNames: new Map(),
    assetNames: new Map(),
};

/**
 * A qualifier on a kind's name: a fact the path states and the author chose.
 *
 * Either the text itself - a locale code, which is spelled the same in every language - or a key,
 * for a fact that has a word in the interface already: `image` in a shard's file name is the
 * "Images" the asset panel's own sidebar says.
 */
export type DocumentQualifier =
    | { readonly text: string }
    | { readonly key: TranslationKey };

/**
 * What to call one document.
 *
 * A union rather than a string, because the four cases are four different claims and a surface that
 * cannot tell them apart cannot draw them honestly. `renderDocumentName` is the one place they
 * become text, so no surface has to know which is which in order to be correct.
 */
export type DocumentName =
    /**
     * The author's own name for this thing.
     *
     * `within` is a file inside it, for a thing stored as a folder - a model bundle's texture - and
     * its path inside the folder is the author's own, copied verbatim from what they imported.
     */
    | { readonly source: "authored"; readonly text: string; readonly within?: string }
    /**
     * The name of the kind, for a thing with no name of its own.
     *
     * The qualifier is a fact the path states outright and that the author chose - a locale, an
     * asset type - so it is not a shortfall: `Translations (zh-CN)` is the complete answer.
     */
    | { readonly source: "kind"; readonly key: TranslationKey; readonly qualifier: DocumentQualifier | null }
    /**
     * A thing that has a name, whose name this pass could not read.
     *
     * Said as what it is. `ordinal` is only ever set by {@link numberRepeatedNames}, which is the
     * one place that can see whether a second stand-in on the same list would read the same.
     */
    | {
        readonly source: "unnamed";
        readonly key: TranslationKey;
        readonly within?: string;
        readonly ordinal?: number;
    }
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
 * What an asset's file is called when its record could not be read at all.
 *
 * Its type is on the record too, so this is the answer only when the record itself is missing -
 * which is the state a bad merge or a truncated read leaves behind.
 */
export const ASSET_CONTENT_NAME_KEY = "documentDiff.name.assetContent" as TranslationKey;

/**
 * What an asset is called when its record is there and gives it no name.
 *
 * A `Record` over the enum, so a new asset type is a compile error here rather than an asset that
 * falls back to "Asset file" while its type is sitting on the record. Literal keys rather than a
 * template, so `documentDiffKeys.test.ts` can see every one of them.
 */
const UNNAMED_ASSET_KEY: Record<AssetType, TranslationKey> = {
    [AssetType.Image]: "documentDiff.name.assetOfType.image",
    [AssetType.Audio]: "documentDiff.name.assetOfType.audio",
    [AssetType.Video]: "documentDiff.name.assetOfType.video",
    [AssetType.JSON]: "documentDiff.name.assetOfType.json",
    [AssetType.Font]: "documentDiff.name.assetOfType.font",
    [AssetType.Model]: "documentDiff.name.assetOfType.model",
    [AssetType.Other]: "documentDiff.name.assetOfType.other",
};

/** The asset panel's own word for each type - its sidebar's, so the two surfaces say one thing. */
const ASSET_TYPE_LABEL_KEY: Record<AssetType, TranslationKey> = {
    [AssetType.Image]: "assets.types.image",
    [AssetType.Audio]: "assets.types.audio",
    [AssetType.Video]: "assets.types.video",
    [AssetType.JSON]: "assets.types.json",
    [AssetType.Font]: "assets.types.font",
    [AssetType.Model]: "assets.types.model",
    [AssetType.Other]: "assets.types.other",
};

/** The same for the folder and order shards, which are filed by category rather than by type. */
const ASSET_CATEGORY_LABEL_KEY: Record<AssetCategory, TranslationKey> = {
    [AssetCategory.Image]: "assets.categories.image",
    [AssetCategory.Media]: "assets.categories.media",
    [AssetCategory.Data]: "assets.categories.data",
    [AssetCategory.Font]: "assets.categories.font",
    [AssetCategory.Model]: "assets.categories.model",
    [AssetCategory.Other]: "assets.categories.other",
};

const STORY_UNNAMED_KEY: TranslationKey = DOCUMENT_KIND_NAME_KEY.story;
const ANIMATION_UNNAMED_KEY: TranslationKey = "documentDiff.name.animation";

/**
 * The captured parameter that qualifies one document of a kind there are several of, and how.
 *
 * Only the ones an author would recognise. `project` captures the project's own file name and is
 * deliberately absent: there is exactly one project settings document, and qualifying it would put
 * the file name back on the row this whole module exists to take it off.
 */
const QUALIFIER_PARAMETER: Partial<Record<DocumentKind, QualifierRule>> = {
    localization: { parameter: "locale", read: "text" },
    voice: { parameter: "locale", read: "text" },
    "assets-metadata": { parameter: "type", read: "asset-type" },
    "assets-groups": { parameter: "category", read: "asset-category" },
};

/**
 * How a captured parameter becomes a qualifier.
 *
 * `text` for a fact spelled the same in every language. The two asset readings look the word up in
 * the asset panel's own vocabulary and fall back to the text for a shard the panel no longer draws -
 * a folder file left behind for a type that has since been merged into a category.
 */
interface QualifierRule {
    readonly parameter: string;
    readonly read: "text" | "asset-type" | "asset-category";
}

/** A document Studio writes that no spec claims yet, and what the author calls it. */
interface UnclaimedDocument {
    readonly pattern: DocumentPathPattern;
    readonly key: TranslationKey;
    /** How two of these are told apart, when there can be two. */
    readonly qualifier?: QualifierRule;
    /** The parameter carrying a motion's id, for the one kind here whose members have names. */
    readonly animationId?: string;
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
        key: ANIMATION_UNNAMED_KEY,
        animationId: "animationId",
    },
    {
        pattern: compileDocumentPathPattern("assets/assets.groups.<category>.json"),
        key: "documentDiff.name.assetsGroups",
        qualifier: { parameter: "category", read: "asset-category" },
    },
    {
        pattern: compileDocumentPathPattern("assets/assets.order.<category>.json"),
        key: "documentDiff.name.assetsOrder",
        qualifier: { parameter: "category", read: "asset-category" },
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
        // No spec claims a motion's file today (it is named below, from `UNCLAIMED_DOCUMENTS`), and
        // the day one does, its rows must not fall back to the kind's name while the motion library
        // is sitting right there.
        if (kind === "story-animation" && match.parameters.animationId !== undefined) {
            return animationName(match.parameters.animationId, context);
        }
        const rule = QUALIFIER_PARAMETER[kind];
        return {
            source: "kind",
            key: DOCUMENT_KIND_NAME_KEY[kind],
            qualifier: rule ? qualifierOf(rule, match.parameters[rule.parameter]) : null,
        };
    }

    for (const unclaimed of UNCLAIMED_DOCUMENTS) {
        const parameters = resolvePath(path, candidate => matchDocumentPath(unclaimed.pattern, candidate) ?? undefined);
        if (parameters) {
            if (unclaimed.animationId) {
                return animationName(parameters[unclaimed.animationId] ?? "", context);
            }
            return {
                source: "kind",
                key: unclaimed.key,
                qualifier: unclaimed.qualifier ? qualifierOf(unclaimed.qualifier, parameters[unclaimed.qualifier.parameter]) : null,
            };
        }
    }

    // An asset's bytes, stored under its id rather than beside its record - or, for a model bundle,
    // one file of the folder stored there. Which asset it is lives in a metadata shard, so the name
    // comes from the context, and never from the shard of an id the path is made of.
    const content = assetContentOf(path);
    if (content !== null) {
        return assetName(content.storageId, content.within, context);
    }

    return { source: "file", path: normalizeSeparators(path) };
}

/**
 * An asset's name, from its record; a stand-in when the record gives none.
 *
 * Exported for the comparison's asset fold, which names a record it has already split out of a
 * shard: that record's type is the shard's, and a blank name there is the same state as here.
 */
export function assetName(storageId: string, within: string | undefined, context: DocumentNameContext): DocumentName {
    const entry = context.assetNames.get(storageId.toLowerCase());
    if (entry && entry.name.trim().length > 0) {
        return within === undefined
            ? { source: "authored", text: entry.name }
            : { source: "authored", text: entry.name, within };
    }
    return unnamedAsset(entry?.type ?? null, within);
}

/** The stand-in for an asset whose name could not be read, by type when the type is known. */
export function unnamedAsset(type: string | null, within?: string): DocumentName {
    const key = type !== null && isAssetType(type) ? UNNAMED_ASSET_KEY[type] : ASSET_CONTENT_NAME_KEY;
    return within === undefined ? { source: "unnamed", key } : { source: "unnamed", key, within };
}

/**
 * A story's name, which is its title, which is not in the story document.
 *
 * It lives in `editor/story/index.json` - the library the story panel draws - so naming a story
 * means reading a sibling. See `nameSources.ts` for which SIDE of a comparison that sibling is read
 * from; by the time a title reaches here the decision is already made.
 */
function storyName(storyId: string, context: DocumentNameContext): DocumentName {
    const title = context.storyTitles.get(storyId);
    if (title !== undefined && title.trim().length > 0) {
        return { source: "authored", text: title };
    }
    return { source: "unnamed", key: STORY_UNNAMED_KEY };
}

/** A motion's name, from the motion library, on the same terms as a story's. */
function animationName(animationId: string, context: DocumentNameContext): DocumentName {
    const name = context.animationNames.get(animationId);
    if (name !== undefined && name.trim().length > 0) {
        return { source: "authored", text: name };
    }
    return { source: "unnamed", key: ANIMATION_UNNAMED_KEY };
}

/** A captured parameter as a qualifier, or null when the path captured nothing. */
function qualifierOf(rule: QualifierRule, value: string | undefined): DocumentQualifier | null {
    if (value === undefined || value.length === 0) {
        return null;
    }
    if (rule.read === "asset-category" && isAssetCategory(value)) {
        return { key: ASSET_CATEGORY_LABEL_KEY[value] };
    }
    // A folder or order shard named after a TYPE is one written before types were grouped into
    // categories, and the type's own word is still the right one for it.
    if ((rule.read === "asset-type" || rule.read === "asset-category") && isAssetType(value)) {
        return { key: ASSET_TYPE_LABEL_KEY[value] };
    }
    return { text: value };
}

function isAssetType(value: string): value is AssetType {
    return (Object.values(AssetType) as string[]).includes(value);
}

function isAssetCategory(value: string): value is AssetCategory {
    return (Object.values(AssetCategory) as string[]).includes(value);
}

/**
 * The asset a content path belongs to, and the file inside it for a bundle.
 *
 * `assets/content/<2>/<2>/<rest>` is one asset's bytes; anything deeper is a file of a model
 * bundle, which is stored as a folder at that same place. The id is the shards rejoined - never
 * looked up - and the lower-case rule is `assetStorageIdFromContentPath`'s: a mixed-case shard is a
 * path this scheme did not write.
 */
function assetContentOf(path: string): { storageId: string; within: string | undefined } | null {
    const segments = path.split(/[/\\]/).filter(segment => segment.length > 0);
    if (segments.length < 5 || segments[0] !== "assets" || segments[1] !== "content") {
        return null;
    }
    const [, , a, b, rest] = segments;
    if (a !== a.toLowerCase() || b !== b.toLowerCase() || rest !== rest.toLowerCase()) {
        return null;
    }
    const storageId = assetStorageIdFromShards(a, b, rest);
    if (storageId === null) {
        return null;
    }
    return { storageId, within: segments.length > 5 ? segments.slice(5).join("/") : undefined };
}

/**
 * What one name reads as, as ONE string.
 *
 * One string rather than a title and a qualifier side by side: a surface that took the parts
 * separately could draw the title and drop the rest, and a bundle's texture would read as the model
 * it belongs to.
 */
export function renderDocumentName(name: DocumentName, t: Translator["t"]): string {
    switch (name.source) {
        case "authored":
            return name.within === undefined
                ? name.text
                : t("documentDiff.name.qualified", { name: name.text, qualifier: name.within });
        case "file":
            return name.path;
        case "kind":
            return name.qualifier
                ? t("documentDiff.name.qualified", {
                    name: t(name.key),
                    qualifier: "key" in name.qualifier ? t(name.qualifier.key) : name.qualifier.text,
                })
                : t(name.key);
        case "unnamed": {
            const base = name.ordinal === undefined
                ? t(name.key)
                : t("documentDiff.name.numbered", { name: t(name.key), index: String(name.ordinal) });
            return name.within === undefined
                ? base
                : t("documentDiff.name.qualified", { name: base, qualifier: name.within });
        }
    }
}

/** Whether this name is the author's own word for the thing, rather than one Studio supplied. */
export function isAuthoredName(name: DocumentName): boolean {
    return name.source === "authored";
}

/**
 * One list's names, with the stand-ins that would read the same numbered apart.
 *
 * Only `unnamed` names are touched, and only where two or more on the SAME list share a key and a
 * `within` - one unreadable story among forty named ones stays "Story". The numbers follow the
 * list's own order, so the first such row is 1 wherever the list starts.
 *
 * Every surface that draws a list of changed files runs its names through this once, after it has
 * decided which files are on it; a name drawn on its own (a detail line, a tab title) carries the
 * number the list gave it, so the row that was pressed and the title it opened agree.
 */
export function numberRepeatedNames(names: readonly DocumentName[]): DocumentName[] {
    const groupKey = (name: DocumentName) =>
        name.source === "unnamed" ? `${name.key}${name.within ?? ""}` : null;
    const totals = new Map<string, number>();
    for (const name of names) {
        const key = groupKey(name);
        if (key !== null) {
            totals.set(key, (totals.get(key) ?? 0) + 1);
        }
    }
    const seen = new Map<string, number>();
    return names.map(name => {
        const key = groupKey(name);
        if (key === null || (totals.get(key) ?? 0) < 2 || name.source !== "unnamed") {
            return name;
        }
        const ordinal = (seen.get(key) ?? 0) + 1;
        seen.set(key, ordinal);
        return { ...name, ordinal };
    });
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
    return numberRepeatedNames(paths.slice(0, limit).map(path => documentNameOf(path, context)))
        .map(name => renderDocumentName(name, t))
        .join("\n");
}

/** A sibling library names are read from. See `nameSources.ts` for where each one lives. */
export type DocumentNameSource = "stories" | "animations" | "assets";

/**
 * Which sibling libraries naming these paths needs read.
 *
 * So a surface that lists three files reads the one library those three are named from rather than
 * every metadata shard in the project. `assets` covers every shard, because a content path does not
 * say which type its record is filed under. Answered by naming each path with nothing read and
 * seeing which stand-in comes back, so it cannot disagree with {@link documentNameOf} about which
 * paths have names that live elsewhere.
 */
export function documentNameSourcesFor(paths: readonly string[]): ReadonlySet<DocumentNameSource> {
    const sources = new Set<DocumentNameSource>();
    for (const path of paths) {
        const name = documentNameOf(path, NO_DOCUMENT_NAMES);
        if (name.source !== "unnamed") {
            continue;
        }
        if (name.key === STORY_UNNAMED_KEY) {
            sources.add("stories");
        } else if (name.key === ANIMATION_UNNAMED_KEY) {
            sources.add("animations");
        } else {
            sources.add("assets");
        }
    }
    return sources;
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
