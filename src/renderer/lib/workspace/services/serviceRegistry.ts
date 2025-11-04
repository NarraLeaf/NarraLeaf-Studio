import { FileSystemService } from "./core/FileSystem";
import { ProjectService } from "./core/ProjectService";
import { UIService } from "./core/UIService";
import { Services } from "./services";
import { Service } from "./Service";


export class ServiceRegistry {
    private services: Record<Services, Service> = {
        [Services.Project]: ProjectService.getInstance(),
        [Services.FileSystem]: FileSystemService.getInstance(),
        [Services.UI]: UIService.getInstance(),
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
