import { FileSystemService } from "./core/FileSystem";
import { ProjectService } from "./core/ProjectService";
import { UIService } from "./core/UIService";
import { ProjectSettingsService } from "./ProjectSettingsService";
import { Services } from "./services";
import { Service } from "./Service";
import { AssetsService } from "./core/AssetsService";


export class ServiceRegistry {
    private services: Record<Services, Service> = {
        [Services.Project]: ProjectService.getInstance(),
        [Services.FileSystem]: FileSystemService.getInstance(),
        [Services.UI]: UIService.getInstance(),
        [Services.ProjectSettings]: ProjectSettingsService.getInstance(),
        [Services.Asset]: AssetsService.getInstance(),
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
