import { AssetsMap } from "../assets/types";
import { Service } from "../Service";
import { IAssetService, Services, WorkspaceContext } from "../services";
import { FileSystemService } from "./FileSystem";
import { ProjectService } from "./ProjectService";

export class AssetsService extends Service<AssetsService> implements IAssetService {
    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        await depend([filesystemService, projectService]);
    }

    public async getAssets(): Promise<AssetsMap> {
        const projectService = this.getContext().services.get<ProjectService>(Services.Project);
        return projectService.getAssetsMetadata();
    }
}
