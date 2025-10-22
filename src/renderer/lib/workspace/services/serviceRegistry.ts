import { FileSystemService } from "./core/FileSystem";
import { ProjectService } from "./core/ProjectService";
import { Service, Services } from "./services";


export class ServiceRegistry {
    private services: Record<Services, Service> = {
        [Services.Project]: new ProjectService(),
        [Services.FileSystem]: new FileSystemService(),
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
