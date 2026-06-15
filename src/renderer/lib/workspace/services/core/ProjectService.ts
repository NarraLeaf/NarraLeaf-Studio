import { RendererError, throwException } from "@shared/utils/error";
import { decodeProjectConfig, findProjectConfigFileName } from "@shared/utils/nlproj";
import { join } from "@shared/utils/path";
import { ProjectConfig, Resolution } from "../../project/project";
import { Service } from "../Service";
import { IProjectService, Services, WorkspaceContext } from "../services";
import { FileSystemService } from "./FileSystem";

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

        const projectPath = this.getContext().project.getConfig().projectPath;
        const fileStats = throwException(await filesystemService.list(projectPath));
        const configFileName = findProjectConfigFileName(fileStats);

        if (!configFileName) {
            throw new RendererError("Project config not found: no .nlproj or project.json in project root");
        }

        const configPath = join(projectPath, configFileName);
        const isNlproj = configFileName.endsWith(".nlproj");

        let projectConfig: ProjectConfig;
        if (isNlproj) {
            const rawData = throwException(await filesystemService.readRaw(configPath));
            const decoded = decodeProjectConfig(rawData);
            projectConfig = decoded as ProjectConfig;
        } else {
            projectConfig = throwException(await filesystemService.readJSON<ProjectConfig>(configPath));
        }

        this.projectConfig = projectConfig;
    }

    public getProjectConfig(): ProjectConfig {
        if (!this.projectConfig) {
            throw new RendererError("Project config not initialized");
        }
        return this.projectConfig;
    }
}
