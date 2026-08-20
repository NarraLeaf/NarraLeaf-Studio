import type { StoryDocument, StoryVariableRef } from "@shared/types/story";
import type { NarralangAppearanceRef, NarralangParseLookups, NarralangResolution } from "@/lib/story/narralang/narralangParse";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";

/**
 * {@link narralangLookups} read backwards: every table the printer resolves an id through, indexed by
 * the name it printed.
 *
 * The two are one table used in two directions and have to be built from the same registries, or the
 * script view would print a name it then refuses to read back. That is why this sits next to
 * `narralangLookups` rather than inside the parser: the parser is pure and knows no service.
 *
 * ## Why three outcomes and not two
 *
 * A name that two things answer to is not a name that nothing answers to. Collapsing them would bind
 * a row to whichever character the registry happened to list first - silently, and differently on the
 * next launch. So every table below counts its candidates and says `"ambiguous"` at two, which the
 * parser turns into a diagnostic against the line and refuses to commit.
 *
 * Names are matched exactly, with no case folding and no trimming. The printer quotes and escapes a
 * name so that it comes back through the lexer unchanged (`narralangName`), so anything looser here
 * would accept text the printer would never produce and resolve it to a row the author did not name.
 */
export function narralangParseLookups(
    services: WorkspaceContext["services"],
    document: StoryDocument,
): NarralangParseLookups {
    const storyService = services.get<StoryService>(Services.Story);
    const characterService = services.get<CharacterService>(Services.Character);
    const blueprintService = services.get<LocalBlueprintService>(Services.LocalBlueprint);
    const assetsService = services.get<AssetsService>(Services.Assets);
    const appTagService = services.get<AppTagService>(Services.AppTags);

    const characters = characterService.listCharacter();

    const characterIds = indexByName(characters.map(character => [character.profile.getName(), character.profile.getId()]));
    const motionIds = indexByName(storyService.listAnimationAssets().map(entry => [entry.name, entry.id]));
    const appTagIds = indexByName(appTagService.listTags().map(tag => [tag.name, tag.id]));
    const sceneIds = indexByName(Object.values(document.scenes).map(scene => [scene.name, scene.id]));

    // Both project scopes at once, addressed the way each scope's ref addresses its entry - `saved`
    // by entry id, `persistent` by storage key. That asymmetry is the registry's, and mirroring it
    // here is what keeps a ref this parse mints equal to one the row editor would have written.
    // Scene variables are deliberately absent: they are declared in the script being parsed, and the
    // parser's own declarations always win over anything a caller supplies.
    const variableRefs = indexByName<StoryVariableRef>([
        ...blueprintService.listSavedVariables().map(entry =>
            [entry.name, { scope: "saved", variableId: entry.id }] as [string, StoryVariableRef]),
        ...blueprintService.listPersistentVariables().map(entry =>
            [entry.name, { scope: "persistent", variableId: entry.storageKey }] as [string, StoryVariableRef]),
    ]);

    // Flat across every axis, exactly as `narralangAppearanceNames` flattens them on the way out: the
    // engine resolves a tag against the group that owns it, so a script never says which axis was
    // meant and this table has to answer without being told.
    const appearanceRefs = new Map<string, Map<string, NarralangAppearanceRef[]>>();
    const puppetCharacters = new Set<string>();
    for (const character of characters) {
        const appearance = character.profile.appearance;
        const kind = appearance.getKind();
        if (kind !== "preset" && kind !== "layered") {
            // A puppet's states are named by the model its backend loaded, not by the project, so
            // there is no table to build and every name is the model's own.
            puppetCharacters.add(character.profile.getId());
            continue;
        }
        const byName = new Map<string, NarralangAppearanceRef[]>();
        if (kind === "preset") {
            for (const pose of appearance.getPoses()) {
                push(byName, pose.name, { kind: "pose", id: pose.id });
            }
        } else {
            for (const axis of appearance.getAxes()) {
                for (const tag of axis.tags) {
                    push(byName, tag.name, { kind: "tag", axisId: axis.id, id: tag.id });
                }
            }
        }
        appearanceRefs.set(character.profile.getId(), byName);
    }

    return {
        characterId: name => resolve(characterIds, name),
        // `name → assetId`, across every asset type, because a row stores a bare id and the printer
        // spells it with a bare name. Two assets of different types sharing one name is therefore
        // genuinely ambiguous in the script, and saying so is better than picking the image.
        assetId: name => {
            const table = assetsService.getAssets();
            const found: string[] = [];
            for (const byId of Object.values(table)) {
                for (const [assetId, asset] of Object.entries((byId ?? {}) as Record<string, { name?: string }>)) {
                    if (asset?.name === name) {
                        found.push(assetId);
                    }
                }
            }
            return found.length === 1 ? found[0] : found.length === 0 ? null : "ambiguous";
        },
        motionId: name => resolve(motionIds, name),
        appTagId: name => resolve(appTagIds, name),
        sceneId: name => resolve(sceneIds, name),
        variableRef: name => resolve(variableRefs, name),
        appearanceRef: (characterId, name) => {
            if (puppetCharacters.has(characterId)) {
                return { kind: "puppet" };
            }
            const byName = appearanceRefs.get(characterId);
            if (!byName) {
                return null;
            }
            return resolve(byName, name);
        },
    };
}

function push<T>(table: Map<string, T[]>, name: string, value: T): void {
    const held = table.get(name);
    if (held) {
        held.push(value);
        return;
    }
    table.set(name, [value]);
}

function indexByName<T>(entries: readonly (readonly [string, T])[]): Map<string, T[]> {
    const table = new Map<string, T[]>();
    for (const [name, value] of entries) {
        push(table, name, value);
    }
    return table;
}

function resolve<T>(table: Map<string, T[]>, name: string): NarralangResolution<T> {
    const found = table.get(name);
    if (!found || found.length === 0) {
        return null;
    }
    return found.length === 1 ? found[0] : "ambiguous";
}
