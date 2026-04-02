import { FileSystemService } from "./core/FileSystem";
import { ProjectService } from "./core/ProjectService";
import { UIService } from "./core/UIService";
import { ProjectSettingsService } from "./ProjectSettingsService";
import { Services } from "./services";
import { Service } from "./Service";
import { AssetsService } from "./core/AssetsService";
import { ServiceAssetsService } from "./core/ServiceAssetsService";
import { CharacterService } from "./core/CharacterService";
import { UuidService } from "./core/UuidService";
import { SettingsService } from "./core/SettingsService";
import { PanelStateService } from "./core/PanelStateService";
import { UIDocumentService } from "./ui-editor/UIDocumentService";
import { UIRuntimeBridgeService } from "./ui-editor/UIRuntimeBridgeService";
import { UIEditorStateService } from "./ui-editor/UIEditorStateService";
import { UIGraphService } from "./ui-editor/UIGraphService";
import { LocalBlueprintService } from "./ui-editor/LocalBlueprintService";
import { UIBlueprintLifecycleCoordinator } from "./ui-editor/UIBlueprintLifecycleCoordinator";
import { DevModeService } from "./core/DevModeService";


export class ServiceRegistry {
    private services: Record<Services, Service> = {
        [Services.Project]: ProjectService.getInstance(),
        [Services.Uuid]: UuidService.getInstance(),
        [Services.FileSystem]: FileSystemService.getInstance(),
        [Services.UI]: UIService.getInstance(),
        [Services.ProjectSettings]: ProjectSettingsService.getInstance(),
        [Services.Settings]: SettingsService.getInstance(),
        [Services.Assets]: AssetsService.getInstance(),
        [Services.ServiceAssets]: ServiceAssetsService.getInstance(),
        [Services.PanelState]: PanelStateService.getInstance(),
        [Services.Character]: CharacterService.getInstance(),
        [Services.UIDocument]: UIDocumentService.getInstance(),
        [Services.RuntimeBridge]: UIRuntimeBridgeService.getInstance(),
        [Services.UIEditorState]: UIEditorStateService.getInstance(),
        [Services.UIGraph]: UIGraphService.getInstance(),
        [Services.LocalBlueprint]: LocalBlueprintService.getInstance(),
        [Services.UIBlueprintLifecycle]: UIBlueprintLifecycleCoordinator.getInstance(),
        [Services.DevMode]: DevModeService.getInstance(),
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
