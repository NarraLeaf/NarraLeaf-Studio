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
import { UIEditorHistoryService } from "./ui-editor/UIEditorHistoryService";
import { UIGraphService } from "./ui-editor/UIGraphService";
import { LocalBlueprintService } from "./ui-editor/LocalBlueprintService";
import { UIBlueprintLifecycleCoordinator } from "./ui-editor/UIBlueprintLifecycleCoordinator";
import { DevModeService } from "./core/DevModeService";
import { PreviewService } from "./core/PreviewService";
import { BuildService } from "./core/BuildService";
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

export class ServiceRegistry {
    private services: Record<Services, Service> = {
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
        [Services.UIDocument]: UIDocumentService.getInstance(),
        [Services.RuntimeBridge]: UIRuntimeBridgeService.getInstance(),
        [Services.UIEditorState]: UIEditorStateService.getInstance(),
        [Services.UIEditorHistory]: UIEditorHistoryService.getInstance(),
        [Services.UIGraph]: UIGraphService.getInstance(),
        [Services.LocalBlueprint]: LocalBlueprintService.getInstance(),
        [Services.UIBlueprintLifecycle]: UIBlueprintLifecycleCoordinator.getInstance(),
        [Services.DevMode]: DevModeService.getInstance(),
        [Services.Preview]: PreviewService.getInstance(),
        [Services.Build]: BuildService.getInstance(),
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
    };

    public get<T extends Service>(service: Services): T {
        if (!this.services[service]) {
            throw new Error(`Service ${service} not found`);
        }
        return this.services[service] as T;
    }

    public getAll(): Service[] {
        return Object.values(this.services);
    }
}
