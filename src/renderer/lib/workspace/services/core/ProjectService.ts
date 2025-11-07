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

    public async getAssetsMetadata(): Promise<AssetsMap> {
        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const data: AssetsMap = {
            [AssetType.Image]: {},
            [AssetType.Audio]: {},
            [AssetType.Video]: {},
            [AssetType.JSON]: {},
            [AssetType.Font]: {},
            [AssetType.Other]: {},
        };

        for (const type of Object.values(AssetType)) {
            const shardPath = this.getContext().project.resolve(ProjectNameConvention.AssetsMetadataShard(type));
            const shardResult = await filesystemService.readJSON<Record<string, Asset>>(shardPath);
            if (shardResult.ok) {
                Object.assign(data[type], shardResult.data);
            }
        }

        return data;
    }
}
