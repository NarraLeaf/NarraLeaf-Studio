/**
 * Read a produced game package back and prove every asset it will ask for is inside it.
 *
 * ## Why this is not the question the packer already answered
 *
 * The packer decides what to carry by reading the ids written in the bytes it ships - a syntactic
 * sweep, complete for anything stored and blind to anything computed. A check built the same way
 * would agree with it by construction and would therefore prove nothing. So this asks the opposite
 * kind of question: it runs **the story compiler the shipped game runs**, over the documents the
 * package actually contains, and records every asset that compiler asks to resolve. Then it resolves
 * each one **through the package's own manifest and store**, the way the running game does.
 *
 * A demand the package cannot answer fails the build. That is the only way a trimming build can be
 * trusted: the alternative is a demo that plays until the scene where a picture is missing.
 *
 * ## What it cannot see
 *
 * The interior of a model bundle - the engine derives sibling URLs from the entry file while it
 * plays, and only the model's own manifest knows the file set - and any asset a plugin asks for
 * under an id it computes. Both are named here rather than papered over.
 */

import { compileStudioStoryToNlr } from "@/lib/ui-editor/runtime/game/storyCompiler";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import type { StoryDocument } from "@shared/types/story";
import { listScenesInDocumentOrder } from "@shared/types/story";

/** One asset the package will be asked for, and where the asking happens. */
export type ShippedAssetDemand = {
    assetId: string;
    /** Author-facing: the story or page whose content named it. */
    origin: string;
};

export type ShippedContentAuditFailure = {
    assetId: string;
    origin: string;
    /** `missing` = the manifest has no such asset; `unreadable` = it is listed and its bytes are not there. */
    reason: "missing" | "unreadable";
    detail?: string;
};

export type ShippedContentAuditResult = {
    checkedAssetCount: number;
    failures: ShippedContentAuditFailure[];
    /** Stories the compiler could not read; each is a failure of its own kind. */
    storyErrors: { story: string; message: string }[];
};

/**
 * How the audit reaches the package's bytes.
 *
 * Loose and sealed packages differ only in where an entry's bytes live, which is exactly what this
 * hides: the audit must not grow a second opinion about which of the two it is looking at.
 */
export type ShippedArtifactReader = {
    /** True when the entry is present with content. Throws only on an unexpected read failure. */
    entryExists(relativePath: string): Promise<boolean>;
    /**
     * Where this package keeps an asset's bytes, or null when it has no way to say.
     *
     * The two kinds of package answer differently, and the audit must ask rather than assume: a
     * sealed store derives the name from the asset id (it ships no manifest to look in), while a
     * loose one reads the path out of the manifest. Asking mirrors what the runtime does, which is
     * the point of the audit - resolving by any other route would prove something the game does not
     * do.
     */
    resolveEntryName(assetId: string): string | null;
};

/**
 * Every asset the compiled story asks to resolve, for every story in the package.
 *
 * The compiler visits every scene in a document whatever scene it is told to start at, so one
 * compile per story enumerates that story whole. It is handed a recorder in place of the runtime's
 * URL builder: what is wanted here is the id, and the running game's builder answers a URL for any
 * id at all - including one the package does not have, which is the case this exists to find.
 */
export async function collectStoryAssetDemands(pack: GameRuntimePackV1): Promise<{
    demands: ShippedAssetDemand[];
    storyErrors: { story: string; message: string }[];
}> {
    const demands: ShippedAssetDemand[] = [];
    const storyErrors: { story: string; message: string }[] = [];
    const library = pack.bundle.storyLibrary;
    // One pass per language, but only for a package that actually resolves an asset set: a set is
    // the one construct whose answer depends on the language the game is running in, so without one
    // every pass would enumerate the same ids and the extra compiles would buy nothing. With one,
    // a single pass would check whichever language it happened to run as and let the other ship
    // with no picture behind its lines.
    const locales = auditLocales(pack);
    for (const [storyId, document] of Object.entries(library?.documents ?? {})) {
        const startSceneId = pickCompileEntryScene(document);
        if (!startSceneId) {
            continue;
        }
        const storyName = library?.index.stories.find(story => story.id === storyId)?.name ?? storyId;
        for (const locale of locales) {
            try {
                await compileStudioStoryToNlr({
                    document,
                    sceneId: startSceneId,
                    characters: library?.characters,
                    animations: library?.animations,
                    blueprintDocument: pack.bundle.ui.localBlueprints,
                    persistentVariables: pack.bundle.ui.persistentVariables,
                    savedVariables: pack.bundle.ui.savedVariables,
                    localization: pack.bundle.localization
                        ? { ...pack.bundle.localization, getLocale: () => locale }
                        : undefined,
                    voice: pack.bundle.voice,
                    audioClips: pack.bundle.audio?.clips,
                    audioTracks: pack.bundle.audio?.tracks,
                    resolveAssetUrl: (assetId: string) => {
                        const trimmed = typeof assetId === "string" ? assetId.trim() : "";
                        if (trimmed) {
                            demands.push({ assetId: trimmed, origin: storyName });
                        }
                        // A URL rather than null: null makes the compiler note a diagnostic and carry on
                        // with nothing, and this pass wants it to keep walking.
                        return "audit://" + trimmed;
                    },
                } as Parameters<typeof compileStudioStoryToNlr>[0]);
            } catch (error) {
                storyErrors.push({
                    story: storyName,
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }
    return { demands, storyErrors };
}

/**
 * The languages this audit compiles as.
 *
 * The project's own list when any story resolves an asset set, and a single unnamed pass otherwise.
 * The check is asked of the package rather than of the project on purpose: what has to be proven is
 * that the bytes behind every language this *package* can be played in are in it.
 */
function auditLocales(pack: GameRuntimePackV1): string[] {
    const documents = pack.bundle.storyLibrary?.documents ?? {};
    const resolvesASet = Object.values(documents).some(document =>
        Object.values(document.scenes ?? {}).some(scene =>
            Object.values(scene.blocks ?? {}).some(block => block.assetVariants)));
    if (!resolvesASet) {
        return [""];
    }
    const localization = pack.bundle.localization;
    const codes = new Set<string>();
    if (localization?.sourceLocale) {
        codes.add(localization.sourceLocale);
    }
    for (const entry of localization?.locales ?? []) {
        codes.add(entry.code);
    }
    return codes.size > 0 ? [...codes] : [""];
}

/** The scene the audit compiles from; any scene enumerates the document, so this only has to exist. */
function pickCompileEntryScene(document: StoryDocument): string | null {
    const entry = document.entrySceneId;
    if (entry && document.scenes?.[entry]) {
        return entry;
    }
    return listScenesInDocumentOrder(document)[0]?.id ?? null;
}

/**
 * `elementId -> page name`, so a finding names the page an author can open rather than a uuid.
 *
 * An element no page's tree reaches gets no entry; the caller falls back to the element's own name.
 */
function mapElementsToSurfaces(uidoc: UIDocument): Map<string, string> {
    const owner = new Map<string, string>();
    for (const surface of uidoc.surfaces ?? []) {
        const name = surface.name || surface.id;
        const pending = [surface.rootElementId];
        while (pending.length > 0) {
            const elementId = pending.pop();
            if (!elementId || owner.has(elementId)) {
                continue;
            }
            owner.set(elementId, name);
            pending.push(...(uidoc.elements?.[elementId]?.childrenIds ?? []));
        }
    }
    return owner;
}

/** Literal property names that hold a library asset id, matched exactly rather than by suffix. */
const ASSET_ID_PROPERTY_NAMES = new Set(["assetId", "fontAssetId", "posterAssetId"]);

/**
 * Every asset named by any page in the package.
 *
 * Deliberately not filtered against the manifest. The runtime's own preloader filters, because a
 * preloader has nothing useful to do with an id it cannot resolve; here that id is precisely the
 * finding.
 */
export function collectSurfaceAssetDemands(uidoc: UIDocument): ShippedAssetDemand[] {
    const demands: ShippedAssetDemand[] = [];
    const seen = new Set<string>();
    const surfaceByElement = mapElementsToSurfaces(uidoc);
    const record = (value: unknown, origin: string): void => {
        const assetId = typeof value === "string" ? value.trim() : "";
        if (!assetId || seen.has(assetId)) {
            return;
        }
        seen.add(assetId);
        demands.push({ assetId, origin });
    };
    const walk = (value: unknown, origin: string, keyHint?: string): void => {
        if (keyHint !== undefined && ASSET_ID_PROPERTY_NAMES.has(keyHint)) {
            record(value, origin);
        }
        if (!value || typeof value !== "object") {
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                walk(item, origin);
            }
            return;
        }
        for (const [key, next] of Object.entries(value as Record<string, unknown>)) {
            walk(next, origin, key);
        }
    };
    for (const surface of uidoc.surfaces ?? []) {
        walk(surface, surface.name || surface.id);
    }
    // The whole element, not a chosen few of its fields: the walk is keyed on property names, and an
    // element carries asset ids in props, in style, in its value bindings and in `extra`. Naming the
    // fields here is how a widget family added later becomes an asset nobody checks.
    for (const element of Object.values(uidoc.elements ?? {})) {
        walk(element, surfaceByElement.get(element.id) ?? (element.name || element.id));
    }
    for (const component of uidoc.components ?? []) {
        const origin = component.name || component.id;
        for (const element of Object.values(component.elements ?? {})) {
            walk(element, origin);
        }
    }
    return demands;
}

/**
 * Resolve every demand against the package, the way the running game does: the manifest names an
 * entry, the store holds its bytes.
 */
export async function auditShippedContent(input: {
    pack: GameRuntimePackV1;
    reader: ShippedArtifactReader;
}): Promise<ShippedContentAuditResult> {
    const { pack, reader } = input;
    const story = await collectStoryAssetDemands(pack);
    const demands = [...story.demands, ...collectSurfaceAssetDemands(pack.bundle.ui.uidoc)];
    const failures: ShippedContentAuditFailure[] = [];
    const checked = new Set<string>();
    for (const demand of demands) {
        if (checked.has(demand.assetId)) {
            continue;
        }
        checked.add(demand.assetId);
        const entryName = reader.resolveEntryName(demand.assetId);
        if (!entryName) {
            failures.push({ assetId: demand.assetId, origin: demand.origin, reason: "missing" });
            continue;
        }
        try {
            if (!await reader.entryExists(entryName)) {
                failures.push({
                    assetId: demand.assetId,
                    origin: demand.origin,
                    reason: "unreadable",
                    detail: entryName,
                });
            }
        } catch (error) {
            failures.push({
                assetId: demand.assetId,
                origin: demand.origin,
                reason: "unreadable",
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return { checkedAssetCount: checked.size, failures, storyErrors: story.storyErrors };
}
