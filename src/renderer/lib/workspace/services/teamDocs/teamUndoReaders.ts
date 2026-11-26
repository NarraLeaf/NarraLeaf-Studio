import type { LiveAssetRecord, LiveDocument, LiveOp } from "@shared/live/ops";
import type { LiveBeforeSources } from "@/lib/live/inverse";
import { Services, type WorkspaceContext } from "../services";
import { AppTagService } from "../appTag/AppTagService";
import { AssetSetService } from "../assets/AssetSetService";
import { categoryOfAssetType, type AssetType } from "../assets/assetTypes";
import { AudioTrackService } from "../audio/AudioTrackService";
import { BrandService } from "../brand/BrandService";
import { AssetsService } from "../core/AssetsService";
import { CharacterService } from "../core/CharacterService";
import { DictionaryService } from "../dictionary/DictionaryService";
import { DlcService } from "../dlc/DlcService";
import { LocalizationService } from "../localization/LocalizationService";
import { rowsSpokenBy } from "../story/characterSweepLive";
import { StoryService } from "../story/StoryService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIGraphService } from "../ui-editor/UIGraphService";
import { VariableRegistryService } from "../variables/VariableRegistryService";
import { VoiceService } from "../voice/VoiceService";
import type { TeamUndoReaders } from "./teamUndo";

/**
 * What the team's undo reads, from the services that hold each document - the readers a live session
 * used to hand the same functions. Every one answers null for a document this window does not hold,
 * which the inverse reads as "nothing to invert against" and refuses by name.
 */
export function createTeamUndoReaders(ctx: WorkspaceContext): TeamUndoReaders {
    const get = <T>(service: Services): T => ctx.services.get(service as never) as T;
    const orNull = <T>(read: () => T): T | null => {
        try {
            return read();
        } catch {
            return null;
        }
    };
    const story = (storyId: string) => orNull(() => get<StoryService>(Services.Story).getStoryDocument(storyId));
    const assets = () => get<AssetsService>(Services.Assets);
    const assetsByType = (category: string) => {
        const out: Record<string, Readonly<Record<string, LiveAssetRecord>>> = {};
        for (const assetType of assets().shardTypes()) {
            if (categoryOfAssetType(assetType as AssetType) !== category) {
                continue;
            }
            const records = assets().recordsOf(assetType);
            if (records) {
                out[assetType] = records;
            }
        }
        return out;
    };

    return {
        story,
        storyEntry: storyId => get<StoryService>(Services.Story).listStories().find(entry => entry.id === storyId),
        sources(document: LiveDocument, op: LiveOp): LiveBeforeSources {
            return {
                story: document.doc === "story" ? story(document.storyId) : null,
                cast: orNull(() => get<CharacterService>(Services.Character).castView()),
                translations: locale => get<LocalizationService>(Services.Localization).unitsOf(locale),
                takes: locale => get<VoiceService>(Services.Voice).unitsOf(locale),
                assets: assetType => assets().recordsOf(assetType),
                assetFolders: category => assets().foldersOf(category),
                assetsByType,
                appTags: orNull(() => get<AppTagService>(Services.AppTags).liveDocument()),
                dlcs: orNull(() => get<DlcService>(Services.Dlc).liveDocument()),
                brand: orNull(() => get<BrandService>(Services.Brand).liveDocument()),
                ui: orNull(() => get<UIDocumentService>(Services.UIDocument).getDocument()),
                uiGraphs: orNull(() => get<UIGraphService>(Services.UIGraph).getDocument()),
                dictionary: () => orNull(() => get<DictionaryService>(Services.Dictionary).documentOrNull()),
                audioTracks: () => orNull(() => get<AudioTrackService>(Services.AudioTracks).tracksOrNull()),
                assetSets: () => orNull(() => get<AssetSetService>(Services.AssetSets).setsOrNull()),
                variables: variableId => get<VariableRegistryService>(Services.VariableRegistry).getEntry(variableId) ?? null,
                keys: () => get<LocalizationService>(Services.Localization).keysIfLoaded(),
                // The rows a deletion is about to un-speak, read while they still say whose they are.
                ...(op.op === "delete-character"
                    ? { spoke: rowsSpokenBy(get<StoryService>(Services.Story), op.characterId) }
                    : {}),
            };
        },
        context(document: LiveDocument) {
            return {
                document: document.doc === "story" ? story(document.storyId) : null,
                cast: orNull(() => get<CharacterService>(Services.Character).castView()),
                assets: assetType => assets().recordsOf(assetType),
                assetFolders: category => assets().foldersOf(category),
                hasAppTag: tagId => get<AppTagService>(Services.AppTags).getTag(tagId) !== undefined,
                hasDlc: dlcId => get<DlcService>(Services.Dlc).has(dlcId),
                hasBrandColor: colorId => get<BrandService>(Services.Brand).getColor(colorId) !== undefined,
                audioTracks: () => orNull(() => get<AudioTrackService>(Services.AudioTracks).tracksOrNull()),
                assetSets: () => orNull(() => get<AssetSetService>(Services.AssetSets).setsOrNull()),
                variables: variableId => get<VariableRegistryService>(Services.VariableRegistry).getEntry(variableId) ?? null,
                keys: () => get<LocalizationService>(Services.Localization).keysIfLoaded(),
            };
        },
    };
}
