import { FileSystemService } from "./core/FileSystem";
import { ProjectService } from "./core/ProjectService";
import { UIService } from "./core/UIService";
import { GlobalSettingsService } from "./GlobalSettingsService";
import { Services } from "./services";
import { Service } from "./Service";
import { AssetsService } from "./core/AssetsService";
import { ServiceAssetsService } from "./core/ServiceAssetsService";
import { CharacterService } from "./core/CharacterService";
import { UuidService } from "./core/UuidService";
import { PanelStateService } from "./core/PanelStateService";
import { RecentColorsService } from "./core/RecentColorsService";
import { UIDocumentService } from "./ui-editor/UIDocumentService";
import { UIRuntimeBridgeService } from "./ui-editor/UIRuntimeBridgeService";
import { UIEditorStateService } from "./ui-editor/UIEditorStateService";
import { HistoryService } from "./history/HistoryService";
import { UIEditorHistoryService } from "./ui-editor/UIEditorHistoryService";
import { UIGraphService } from "./ui-editor/UIGraphService";
import { LocalBlueprintService } from "./ui-editor/LocalBlueprintService";
import { UIBlueprintLifecycleCoordinator } from "./ui-editor/UIBlueprintLifecycleCoordinator";
import { DevModeService } from "./core/DevModeService";
import { PreviewService } from "./core/PreviewService";
import { BuildService } from "./core/BuildService";
import { LintService } from "./core/LintService";
import { TestRunService } from "@/lib/testing/TestRunService";
import { ConsoleService } from "./core/ConsoleService";
import { UIEditorFontFaceService } from "./ui-editor/UIEditorFontFaceService";
import { BlueprintNodeCatalogService } from "./ui-editor/BlueprintNodeCatalogService";
import { StoryService } from "./story/StoryService";
import { ProjectDependencyService } from "./core/ProjectDependencyService";
import { LocalizationService } from "./localization/LocalizationService";
import { VoiceService } from "./voice/VoiceService";
import { ProjectStatsService } from "./stats/ProjectStatsService";
import { CommandService } from "./ui/CommandService";
import { SearchService } from "./search/SearchService";
import { ReferenceService } from "./references/ReferenceService";
import { VariableRegistryService } from "./variables/VariableRegistryService";
import { AudioTrackService } from "./audio/AudioTrackService";
import { AppTagService } from "./appTag/AppTagService";
import { DlcService } from "./dlc/DlcService";
import { AssetSetService } from "./assets/AssetSetService";
import { BrandService } from "./brand/BrandService";
import { DictionaryService } from "./dictionary/DictionaryService";
import { TransformPresetService } from "./transformPreset/TransformPresetService";
import { SaveSchemaService } from "./saves/SaveSchemaService";
import { SaveStatusService } from "./autosave/SaveStatusService";
import { VersionControlService } from "./core/VersionControlService";
import { WorkspaceFreezeService } from "./core/WorkspaceFreezeService";
import { LiveSessionService } from "./live/LiveSessionService";
import { WorkspaceReloadService } from "./core/WorkspaceReloadService";
import { PuppetDescriptionService } from "./puppet/PuppetDescriptionService";
import { MediaSupportService } from "./media/MediaSupportService";
import { RecoveryService } from "./core/RecoveryService";
import { WeatherPrebakeService } from "./weather/WeatherPrebakeService";
import { AgentFollowService } from "./agent/AgentFollowService";
import { AgentBridgeService } from "./agent/AgentBridgeService";

export type WorkspaceServiceMap = {
    [Services.Project]: ProjectService;
    [Services.Uuid]: UuidService;
    [Services.FileSystem]: FileSystemService;
    [Services.UI]: UIService;
    [Services.GlobalSettings]: GlobalSettingsService;
    [Services.Assets]: AssetsService;
    [Services.ServiceAssets]: ServiceAssetsService;
    [Services.PanelState]: PanelStateService;
    [Services.RecentColors]: RecentColorsService;
    [Services.Story]: StoryService;
    [Services.Character]: CharacterService;
    [Services.PuppetDescription]: PuppetDescriptionService;
    [Services.MediaSupport]: MediaSupportService;
    [Services.WeatherPrebake]: WeatherPrebakeService;
    [Services.UIDocument]: UIDocumentService;
    [Services.RuntimeBridge]: UIRuntimeBridgeService;
    [Services.UIEditorState]: UIEditorStateService;
    [Services.History]: HistoryService;
    [Services.UIEditorHistory]: UIEditorHistoryService;
    [Services.UIGraph]: UIGraphService;
    [Services.LocalBlueprint]: LocalBlueprintService;
    [Services.UIBlueprintLifecycle]: UIBlueprintLifecycleCoordinator;
    [Services.DevMode]: DevModeService;
    [Services.Preview]: PreviewService;
    [Services.Build]: BuildService;
    [Services.Lint]: LintService;
    [Services.TestRun]: TestRunService;
    [Services.Console]: ConsoleService;
    [Services.UIEditorFontFace]: UIEditorFontFaceService;
    [Services.BlueprintNodeCatalog]: BlueprintNodeCatalogService;
    [Services.ProjectDependency]: ProjectDependencyService;
    [Services.Localization]: LocalizationService;
    [Services.Voice]: VoiceService;
    [Services.ProjectStats]: ProjectStatsService;
    [Services.Command]: CommandService;
    [Services.Search]: SearchService;
    [Services.Reference]: ReferenceService;
    [Services.VariableRegistry]: VariableRegistryService;
    [Services.AudioTracks]: AudioTrackService;
    [Services.AppTags]: AppTagService;
    [Services.Dlc]: DlcService;
    [Services.AssetSets]: AssetSetService;
    [Services.Brand]: BrandService;
    [Services.Dictionary]: DictionaryService;
    [Services.TransformPreset]: TransformPresetService;
    [Services.SaveSchema]: SaveSchemaService;
    [Services.SaveStatus]: SaveStatusService;
    [Services.VersionControl]: VersionControlService;
    [Services.WorkspaceFreeze]: WorkspaceFreezeService;
    [Services.Live]: LiveSessionService;
    [Services.WorkspaceReload]: WorkspaceReloadService;
    [Services.Recovery]: RecoveryService;
    [Services.AgentFollow]: AgentFollowService;
    [Services.AgentBridge]: AgentBridgeService;
};

type KeysForService<T extends Service> = {
    [K in Services]: WorkspaceServiceMap[K] extends T ? K : never;
}[Services];

export class ServiceRegistry {
    private services: WorkspaceServiceMap = {
        [Services.Project]: ProjectService.getInstance(),
        [Services.Uuid]: UuidService.getInstance(),
        [Services.FileSystem]: FileSystemService.getInstance(),
        [Services.UI]: UIService.getInstance(),
        [Services.GlobalSettings]: GlobalSettingsService.getInstance(),
        [Services.Assets]: AssetsService.getInstance(),
        [Services.ServiceAssets]: ServiceAssetsService.getInstance(),
        [Services.PanelState]: PanelStateService.getInstance(),
        [Services.RecentColors]: RecentColorsService.getInstance(),
        [Services.Story]: StoryService.getInstance(),
        [Services.Character]: CharacterService.getInstance(),
        [Services.PuppetDescription]: PuppetDescriptionService.getInstance(),
        [Services.MediaSupport]: MediaSupportService.getInstance(),
        [Services.WeatherPrebake]: WeatherPrebakeService.getInstance(),
        [Services.UIDocument]: UIDocumentService.getInstance(),
        [Services.RuntimeBridge]: UIRuntimeBridgeService.getInstance(),
        [Services.UIEditorState]: UIEditorStateService.getInstance(),
        [Services.History]: HistoryService.getInstance(),
        [Services.UIEditorHistory]: UIEditorHistoryService.getInstance(),
        [Services.UIGraph]: UIGraphService.getInstance(),
        [Services.LocalBlueprint]: LocalBlueprintService.getInstance(),
        [Services.UIBlueprintLifecycle]: UIBlueprintLifecycleCoordinator.getInstance(),
        [Services.DevMode]: DevModeService.getInstance(),
        [Services.Preview]: PreviewService.getInstance(),
        [Services.Build]: BuildService.getInstance(),
        [Services.Lint]: LintService.getInstance(),
        [Services.TestRun]: TestRunService.getInstance(),
        [Services.Console]: ConsoleService.getInstance(),
        [Services.UIEditorFontFace]: UIEditorFontFaceService.getInstance(),
        [Services.BlueprintNodeCatalog]: BlueprintNodeCatalogService.getInstance(),
        [Services.ProjectDependency]: ProjectDependencyService.getInstance(),
        [Services.Localization]: LocalizationService.getInstance(),
        [Services.Voice]: VoiceService.getInstance(),
        [Services.ProjectStats]: ProjectStatsService.getInstance(),
        [Services.Command]: CommandService.getInstance(),
        [Services.Search]: SearchService.getInstance(),
        [Services.Reference]: ReferenceService.getInstance(),
        [Services.VariableRegistry]: VariableRegistryService.getInstance(),
        [Services.AudioTracks]: AudioTrackService.getInstance(),
        [Services.AppTags]: AppTagService.getInstance(),
        [Services.Dlc]: DlcService.getInstance(),
        [Services.AssetSets]: AssetSetService.getInstance(),
        [Services.Brand]: BrandService.getInstance(),
        [Services.Dictionary]: DictionaryService.getInstance(),
        [Services.TransformPreset]: TransformPresetService.getInstance(),
        [Services.SaveSchema]: SaveSchemaService.getInstance(),
        [Services.SaveStatus]: SaveStatusService.getInstance(),
        [Services.VersionControl]: VersionControlService.getInstance(),
        [Services.WorkspaceFreeze]: WorkspaceFreezeService.getInstance(),
        [Services.Live]: LiveSessionService.getInstance(),
        [Services.WorkspaceReload]: WorkspaceReloadService.getInstance(),
        [Services.Recovery]: RecoveryService.getInstance(),
        [Services.AgentFollow]: AgentFollowService.getInstance(),
        [Services.AgentBridge]: AgentBridgeService.getInstance(),
    };

    public get<K extends Services>(service: K): WorkspaceServiceMap[K];
    public get<T extends Service>(service: KeysForService<T>): T;
    public get(service: Services): Service {
        if (!this.services[service]) {
            throw new Error(`Service ${service} not found`);
        }
        return this.services[service];
    }

    public getAll(): Service[] {
        return Object.values(this.services);
    }
}
