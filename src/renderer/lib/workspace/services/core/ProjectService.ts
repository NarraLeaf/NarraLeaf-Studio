import { RendererError, throwException } from "@shared/utils/error";
import { ProjectNameConvention } from "../../project/nameConvention";
import { ProjectConfig, Resolution } from "../../project/project";
import { IProjectService, Services, WorkspaceContext } from "../services";
import { Service } from "../Service";
import { FileSystemService } from "./FileSystem";
import { Asset, AssetsMap, AssetSource } from "../assets/types";
import { AssetType } from "../assets/assetTypes";

export class BaseProjectService {
    public static getInitialConfig(config: ProjectConfig): ProjectConfig {
        return config;
    }

    public static parseResolution(resolution: string): Resolution {
        const [width, height] = resolution.split("x").map(Number);
        return { width, height };
    }

    public static getInitialAssetsMetadata() {
        return {};
    }

    public static getInitialEditorConfig() {
        return {};
    }
}

export class ProjectService extends Service<ProjectService> implements IProjectService {
    private projectConfig: ProjectConfig | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        await depend([filesystemService]);
        
        const projectConfig = throwException(await filesystemService.readJSON<ProjectConfig>(
            this.getContext().project.resolve(ProjectNameConvention.ProjectConfig)
        ));
        this.projectConfig = projectConfig;
    }

    public getProjectConfig(): ProjectConfig {
        if (!this.projectConfig) {
            throw new RendererError("Project config not initialized");
        }
        return this.projectConfig;
    }
}
