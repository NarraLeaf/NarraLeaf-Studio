import type { StoryDocument } from "@shared/types/story";
import type { NarralangLookups } from "@/lib/story/narralang/narralangPrinter";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { characterRowLookup, projectVariableNameLookup } from "../scene-editor/storySceneBlockUtils";
import { narralangAppearanceNames } from "./narralangIo";

/**
 * Everything the NarraLang printer has to ask about the project, assembled from the live services.
 *
 * One function rather than one per surface, because a half-built table does not degrade the output -
 * every id it fails to resolve becomes an `unresolvedRef` issue, which reports the whole scene as
 * unspeakable. The export and the in-Studio script view therefore have to fill exactly the same
 * fields, and the only way to keep that true is for there to be one place that fills them.
 *
 * Read at call time, never subscribed to: the printer is pure and the callers re-run it when the
 * document changes, so the freshest registry is simply the one present when the caller asked.
 */
export function narralangLookups(
    services: WorkspaceContext["services"],
    document: StoryDocument,
): NarralangLookups {
    const storyService = services.get<StoryService>(Services.Story);
    const characterService = services.get<CharacterService>(Services.Character);
    const blueprintService = services.get<LocalBlueprintService>(Services.LocalBlueprint);
    const assetsService = services.get<AssetsService>(Services.Assets);
    const appTagService = services.get<AppTagService>(Services.AppTags);

    const characters = characterService.listCharacter();
    const motions = new Map(storyService.listAnimationAssets().map(entry => [entry.id, entry.name]));
    const appTags = new Map(appTagService.listTags().map(tag => [tag.id, tag.name]));

    return {
        character: characterRowLookup(characters),
        // `assetId → name`, across every asset type: a background row stores an id and reads as one,
        // and an id the printer cannot name is a row it refuses to spell.
        assetName: assetId => {
            const table = assetsService.getAssets();
            for (const byId of Object.values(table)) {
                const asset = (byId as Record<string, { name?: string }> | undefined)?.[assetId];
                if (asset?.name) {
                    return asset.name;
                }
            }
            return null;
        },
        motionName: animationId => motions.get(animationId) ?? null,
        appearanceName: narralangAppearanceNames(characters),
        // Both project scopes, because since the declaration migration the registry is the only place
        // either of them lives.
        projectVariableName: projectVariableNameLookup([
            ...blueprintService.listSavedVariables(),
            ...blueprintService.listPersistentVariables(),
        ]),
        appTagName: appTagId => appTags.get(appTagId) ?? null,
        scenes: document.scenes,
        document,
    };
}
