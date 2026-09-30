import type { StoryDocument, StoryVariableRef } from "@shared/types/story";
import { storyVariableRefKey } from "@shared/types/story";
import type { NarralangLookups } from "@/lib/story/narralang/narralangPrinter";
import type { NarralangAppearanceRef, NarralangParseLookups, NarralangResolution } from "@/lib/story/narralang/narralangParse";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { AssetSetService } from "@/lib/workspace/services/assets/AssetSetService";
import type { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { readableAccentColor } from "../scene-editor/storySceneBlockUtils";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";

/**
 * Everything the NarraLang printer and parser have to ask about the project - one axis at a time,
 * each read in BOTH directions from a single list of pairs.
 *
 * ## Why one function and not two
 *
 * The printer resolves an id to a name; the parser resolves that name back to the id. They are one
 * table used twice, and a project reference that only one of them knows is a script that prints a
 * word it then refuses to read. That is not hypothetical: while the two were built apart, the
 * printer named an asset SET (`resolveAssetDisplayName` asks the set registry after the library) and
 * the parser did not - so a row naming a set printed fine and came back as an unknown name.
 *
 * Building both from one pass is what stops that recurring. An axis is declared once, inside
 * {@link narralangReferences}; the pairs it loads answer both questions; and
 * {@link NARRALANG_REFERENCE_FIELDS} states which field of each table it fills, so "a reference this
 * project can name" is a property of one list rather than an agreement between two.
 *
 * ## Why three outcomes on the way back and not two
 *
 * A name that two things answer to is not a name that nothing answers to. Collapsing them would bind
 * a row to whichever entry the registry happened to list first - silently, and differently on the
 * next launch. So every axis counts its candidates and says `"ambiguous"` at two, which the parser
 * turns into a diagnostic against the line and refuses to commit.
 *
 * Names are matched exactly, with no case folding and no trimming. The printer quotes and escapes a
 * name so that it comes back through the lexer unchanged (`narralangName`), so anything looser here
 * would accept text the printer would never produce and resolve it to a row the author did not name.
 *
 * ## Read at call time, never subscribed to
 *
 * The printer is pure and the callers re-run it when the document changes, so the freshest registry
 * is simply the one present when the caller asked. Each axis loads its pairs on first use of either
 * direction, so a caller that only prints never pays for the tables only a parse reads.
 */

/** The reference kinds a script names. One entry per id-and-name pair the language can carry. */
export type NarralangReferenceAxis =
    | "character"
    | "asset"
    | "appearance"
    | "motion"
    | "appTag"
    | "surface"
    | "scene"
    | "variable";

/**
 * Which field of each table an axis fills - the seam between the two directions, stated once.
 *
 * Named rather than inferred because the two tables do not share a naming scheme and cannot: the
 * printer's is `StoryRowLookups`, shared with the row list, and the parser's is the pure builder's.
 * Writing the pair down is what lets a test compare the key sets at all, which is the thing that was
 * impossible while `assetName`/`assetId`, `appearanceName`/`appearanceRef` and a `sceneId` with no
 * counterpart sat in two hand-written files.
 */
export const NARRALANG_REFERENCE_FIELDS: Record<
    NarralangReferenceAxis,
    { readonly print: keyof NarralangLookups; readonly parse: keyof NarralangParseLookups }
> = {
    character: { print: "character", parse: "characterId" },
    asset: { print: "assetName", parse: "assetId" },
    appearance: { print: "appearanceName", parse: "appearanceRef" },
    motion: { print: "motionName", parse: "motionId" },
    appTag: { print: "appTagName", parse: "appTagId" },
    surface: { print: "surfaceName", parse: "surfaceId" },
    // The scene axis is the one whose forward direction is not a function: the printer names a jump
    // target by looking the id up in the document it was handed. Same axis all the same - it is an
    // id a script spells by name - and stating it here is what keeps the pair countable.
    scene: { print: "scenes", parse: "sceneId" },
    variable: { print: "projectVariableName", parse: "variableRef" },
};

/** One id ↔ name axis, both directions off one list. */
type ReferenceAxis<T> = {
    /**
     * The name a stored reference answers to, or `null` when nothing this project holds does.
     *
     * Keyed by whatever `keyOf` reduces a reference to - the id itself for the axes whose reference
     * IS an id, and a scope-and-id pair for the one whose is not.
     */
    readonly name: (key: string) => string | null;
    /** The reference a name answers to, `null` when nothing does and `"ambiguous"` when several do. */
    readonly id: (name: string) => NarralangResolution<T>;
};

/**
 * Build an axis from one list of `(reference, name)` pairs, loaded on first use.
 *
 * `keyOf` exists for the references that are not plain ids - a variable is addressed by a scope and
 * an id together - and is what lets one list key the forward direction as well as the reverse.
 */
function referenceAxis<T>(load: () => readonly (readonly [T, string])[], keyOf: (id: T) => string): ReferenceAxis<T> {
    let byId: Map<string, string> | null = null;
    let byName: Map<string, T[]> | null = null;
    const build = (): void => {
        if (byId && byName) {
            return;
        }
        byId = new Map();
        byName = new Map();
        for (const [id, name] of load()) {
            const key = keyOf(id);
            if (!byId.has(key)) {
                byId.set(key, name);
            }
            const held = byName.get(name);
            if (held) {
                held.push(id);
            } else {
                byName.set(name, [id]);
            }
        }
    };
    return {
        name: key => {
            build();
            return byId!.get(key) ?? null;
        },
        id: name => {
            build();
            const found = byName!.get(name);
            return !found || found.length === 0 ? null : found.length === 1 ? found[0] : "ambiguous";
        },
    };
}

const asString = (id: string): string => id;

export type NarralangReferences = {
    /** What the printer reads: every id, spelled. */
    readonly lookups: NarralangLookups;
    /** What the parse reads: every name, resolved. */
    readonly parseLookups: NarralangParseLookups;
};

/**
 * The axes, and the two tables they fill.
 *
 * Every service is read once here rather than once per direction, and every axis states its pairs
 * once. The two returned tables are therefore views of the same list per axis, which is the whole
 * guarantee: a name the script can print is a name the script can read back.
 */
export function narralangReferences(
    services: WorkspaceContext["services"],
    document: StoryDocument,
): NarralangReferences {
    const storyService = services.get<StoryService>(Services.Story);
    const characterService = services.get<CharacterService>(Services.Character);
    const blueprintService = services.get<LocalBlueprintService>(Services.LocalBlueprint);
    const appTagService = services.get<AppTagService>(Services.AppTags);
    const uiDocumentService = services.get<UIDocumentService>(Services.UIDocument);

    const characters = characterService.listCharacter();

    const character = referenceAxis(
        () => characters.map(entry => [entry.profile.getId(), entry.profile.getName()] as const),
        asString,
    );
    // The accent the row list paints a speaker's name with. Off the axis on purpose: it is not part
    // of the name and nothing reads it back, so it rides the printer's field alone.
    const accents = new Map(characters.map(entry => [entry.profile.getId(), readableAccentColor(entry.profile.getColor())]));

    // Across every asset type AND the set registry, in the order `resolveAssetDisplayName` asks:
    // a row stores a bare id and the script spells it with a bare name, so two assets of different
    // types sharing one name is genuinely ambiguous in the script, and saying so is better than
    // picking the image.
    const asset = referenceAxis(() => {
        const pairs: (readonly [string, string])[] = [];
        try {
            const table = services.get<AssetsService>(Services.Assets).getAssets();
            for (const byId of Object.values(table)) {
                for (const [assetId, entry] of Object.entries((byId ?? {}) as Record<string, { name?: string }>)) {
                    if (entry?.name) {
                        pairs.push([assetId, entry.name]);
                    }
                }
            }
        } catch {
            // No library in this workspace: the sets below may still answer.
        }
        try {
            for (const set of services.get<AssetSetService>(Services.AssetSets).listSets()) {
                pairs.push([set.id, set.name]);
            }
        } catch {
            // No set registry either.
        }
        return pairs;
    }, asString);

    const motion = referenceAxis(
        () => storyService.listAnimationAssets().map(entry => [entry.id, entry.name] as const),
        asString,
    );
    const appTag = referenceAxis(
        () => appTagService.listTags().map(tag => [tag.id, tag.name] as const),
        asString,
    );
    const surface = referenceAxis(
        () => (uiDocumentService.getDocument().surfaces ?? []).map(surface => [surface.id, surface.name] as const),
        asString,
    );
    const scene = referenceAxis(
        () => Object.values(document.scenes).map(entry => [entry.id, entry.name] as const),
        asString,
    );

    // Both project scopes at once, addressed the way each scope's ref addresses its entry - `saved`
    // by entry id, `persistent` by storage key. That asymmetry is the registry's, and `storyVariableRefKey`
    // is what makes one axis answer for both without a call site having to remember which is which.
    // Scene variables are deliberately absent: they are declared in the script being parsed, and the
    // parser's own declarations always win over anything a caller supplies.
    const variable = referenceAxis<StoryVariableRef>(() => [
        ...blueprintService.listSavedVariables().map(entry =>
            [{ scope: "saved", variableId: entry.id }, entry.name] as const),
        ...blueprintService.listPersistentVariables().map(entry =>
            [{ scope: "persistent", variableId: entry.storageKey }, entry.name] as const),
    ], storyVariableRefKey);

    // Flat across every axis of a character, because the engine resolves a tag against the group that
    // owns it: a script never says which axis was meant, so this table must answer without being told.
    // One axis per character rather than one for the project, since two characters may well call
    // their poses the same thing and neither is ambiguous.
    const appearances = new Map<string, ReferenceAxis<NarralangAppearanceRef>>();
    const puppets = new Set<string>();
    for (const entry of characters) {
        const appearance = entry.profile.appearance;
        const kind = appearance.getKind();
        if (kind !== "preset" && kind !== "layered") {
            // A puppet's states are named by the model its backend loaded, not by the project, so
            // there is no list to build and every name is the model's own.
            puppets.add(entry.profile.getId());
            continue;
        }
        const pairs: (readonly [NarralangAppearanceRef, string])[] = kind === "preset"
            ? appearance.getPoses().map(pose => [{ kind: "pose", id: pose.id } as const, pose.name] as const)
            : appearance.getAxes().flatMap(group => group.tags.map(tag =>
                [{ kind: "tag", axisId: group.id, id: tag.id } as const, tag.name] as const));
        appearances.set(entry.profile.getId(), referenceAxis(() => pairs, ref => (ref.kind === "puppet" ? "" : ref.id)));
    }

    return {
        lookups: {
            character: characterId => {
                const name = character.name(characterId);
                if (name === null) {
                    return null;
                }
                const color = accents.get(characterId);
                return color ? { name, color } : { name };
            },
            assetName: assetId => (assetId ? asset.name(assetId) : null),
            motionName: animationId => motion.name(animationId),
            appearanceName: (characterId, refId) => appearances.get(characterId)?.name(refId) ?? null,
            projectVariableName: (scope, variableId) => variable.name(storyVariableRefKey({ scope, variableId })),
            appTagName: appTagId => appTag.name(appTagId),
            surfaceName: surfaceId => surface.name(surfaceId),
            scenes: document.scenes,
            document,
        },
        parseLookups: {
            characterId: name => character.id(name),
            assetId: name => asset.id(name),
            motionId: name => motion.id(name),
            appTagId: name => appTag.id(name),
            surfaceId: name => surface.id(name),
            sceneId: name => scene.id(name),
            variableRef: name => variable.id(name),
            appearanceRef: (characterId, name) => {
                if (puppets.has(characterId)) {
                    return { kind: "puppet" };
                }
                return appearances.get(characterId)?.id(name) ?? null;
            },
        },
    };
}

/** The printer's half. See {@link narralangReferences} - both halves come out of one pass. */
export function narralangLookups(
    services: WorkspaceContext["services"],
    document: StoryDocument,
): NarralangLookups {
    return narralangReferences(services, document).lookups;
}

/** The parse's half, {@link narralangLookups} read backwards. */
export function narralangParseLookups(
    services: WorkspaceContext["services"],
    document: StoryDocument,
): NarralangParseLookups {
    return narralangReferences(services, document).parseLookups;
}
