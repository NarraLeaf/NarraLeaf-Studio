import { RendererError, throwException } from "@shared/utils/error";
import { decodeProjectConfig, encodeProjectConfig, findProjectConfigFileName } from "@shared/utils/nlproj";
import { basename, extname, join } from "@shared/utils/path";
import { ProjectConfig, ProjectIconConfig, ProjectIconPlatform, Resolution } from "../../project/project";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { IProjectService, Services, WorkspaceContext } from "../services";
import { FileSystemService } from "./FileSystem";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";

export const PROJECT_ICON_PICKER_EXTENSIONS: Record<ProjectIconPlatform, string[]> = {
    macos: ["icns", "png", "jpg", "jpeg", "webp"],
    windows: ["ico", "png", "jpg", "jpeg", "webp"],
    linux: ["png", "svg", "jpg", "jpeg", "webp"],
};

const ICON_MEDIA_TYPES: Record<string, string> = {
    icns: "image/icns",
    ico: "image/x-icon",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    svg: "image/svg+xml",
};

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
    private projectConfigPath: string | null = null;
    private projectConfigFormat: "nlproj" | "json" | null = null;

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
        this.projectConfigPath = configPath;
        this.projectConfigFormat = isNlproj ? "nlproj" : "json";
    }

    public getProjectConfig(): ProjectConfig {
        if (!this.projectConfig) {
            throw new RendererError("Project config not initialized");
        }
        return this.projectConfig;
    }

    public async updateProjectConfig(updater: (config: ProjectConfig) => ProjectConfig): Promise<ProjectConfig> {
        const current = this.cloneProjectConfig(this.getProjectConfig());
        const next = updater(current);
        this.assertValidProjectConfig(next);
        await this.writeProjectConfig(next);
        this.projectConfig = next;
        return next;
    }

    public async updateProjectName(name: string): Promise<ProjectConfig> {
        const nextName = name.trim();
        if (!nextName) {
            throw new RendererError("Project name is required");
        }
        return this.updateProjectConfig(config => ({
            ...config,
            name: nextName,
        }));
    }

    public async importProjectIcon(platform: ProjectIconPlatform): Promise<{
        platform: ProjectIconPlatform;
        sourcePath: string;
        projectPath: string;
        relativePath: string;
        icon: ProjectIconConfig;
        bytes: Uint8Array;
    } | null> {
        const pickerExtensions = PROJECT_ICON_PICKER_EXTENSIONS[platform];
        const selection = await appPrivilegedFacade.fs.selectFile(pickerExtensions, false);
        if (!selection.success) {
            throw new RendererError(selection.error ?? "Failed to open icon file picker");
        }
        const selectedPaths = throwException(selection.data);
        const sourcePath = selectedPaths[0];
        if (!sourcePath) {
            return null;
        }

        const extension = normalizeIconExtension(sourcePath);
        if (!pickerExtensions.includes(extension)) {
            throw new RendererError(`Unsupported ${platform} icon file: .${extension || "unknown"}`);
        }

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const bytes = throwException(await filesystemService.readRaw(sourcePath));
        const iconDir = this.getContext().project.resolve(ProjectNameConvention.ProjectIcons);
        throwException(await filesystemService.createDir(iconDir));

        const relativeSegments = ProjectNameConvention.ProjectIcon(platform, extension);
        const projectPath = this.getContext().project.resolve(relativeSegments);
        throwException(await filesystemService.writeRaw(projectPath, bytes));

        const relativePath = relativeSegments.join("/");
        const icon: ProjectIconConfig = {
            path: relativePath,
            sourceName: basename(sourcePath),
            mediaType: ICON_MEDIA_TYPES[extension] ?? "application/octet-stream",
            updatedAt: new Date().toISOString(),
        };

        await this.updateProjectConfig(config => {
            const metadata = { ...(config.metadata as Record<string, unknown>) };
            const icons = normalizeProjectIcons(metadata.icons);
            icons[platform] = icon;
            metadata.icons = icons;
            return {
                ...config,
                metadata: metadata as ProjectConfig["metadata"],
            };
        });

        return {
            platform,
            sourcePath,
            projectPath,
            relativePath,
            icon,
            bytes,
        };
    }

    public async readProjectIcon(platform: ProjectIconPlatform): Promise<Uint8Array | null> {
        const icon = getProjectIconConfig(this.getProjectConfig(), platform);
        if (!icon?.path) {
            return null;
        }
        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const read = await filesystemService.readRaw(this.getContext().project.resolve(icon.path));
        if (!read.ok) {
            return null;
        }
        return read.data;
    }

    private async writeProjectConfig(config: ProjectConfig): Promise<void> {
        if (!this.projectConfigPath || !this.projectConfigFormat) {
            throw new RendererError("Project config path not initialized");
        }

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        if (this.projectConfigFormat === "nlproj") {
            const encoded = encodeProjectConfig(config as any);
            throwException(await filesystemService.writeRaw(this.projectConfigPath, encoded));
            return;
        }

        throwException(await filesystemService.write(this.projectConfigPath, JSON.stringify(config, null, 2), "utf-8"));
    }

    private cloneProjectConfig(config: ProjectConfig): ProjectConfig {
        return JSON.parse(JSON.stringify(config)) as ProjectConfig;
    }

    private assertValidProjectConfig(config: ProjectConfig): void {
        if (!config || typeof config !== "object") {
            throw new RendererError("Invalid project config");
        }
        if (typeof config.name !== "string" || !config.name.trim()) {
            throw new RendererError("Project name is required");
        }
        if (typeof config.identifier !== "string") {
            throw new RendererError("Project identifier is required");
        }
        if (!config.metadata || typeof config.metadata !== "object") {
            config.metadata = {};
        }
    }
}

export function getProjectIconConfig(config: ProjectConfig, platform: ProjectIconPlatform): ProjectIconConfig | null {
    const metadata = config.metadata as Record<string, unknown>;
    const icons = normalizeProjectIcons(metadata.icons);
    return icons[platform] ?? null;
}

function normalizeProjectIcons(value: unknown): Partial<Record<ProjectIconPlatform, ProjectIconConfig>> {
    if (!value || typeof value !== "object") {
        return {};
    }

    const icons = value as Record<string, unknown>;
    const normalized: Partial<Record<ProjectIconPlatform, ProjectIconConfig>> = {};
    for (const platform of Object.keys(PROJECT_ICON_PICKER_EXTENSIONS) as ProjectIconPlatform[]) {
        const raw = icons[platform];
        if (!raw || typeof raw !== "object") {
            continue;
        }
        const record = raw as Record<string, unknown>;
        if (typeof record.path !== "string" || !record.path.trim()) {
            continue;
        }
        normalized[platform] = {
            path: record.path,
            sourceName: typeof record.sourceName === "string" ? record.sourceName : basename(record.path),
            mediaType: typeof record.mediaType === "string" ? record.mediaType : mediaTypeFromPath(record.path),
            updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : "",
        };
    }
    return normalized;
}

function normalizeIconExtension(sourcePath: string): string {
    return extname(sourcePath).replace(/^\./, "").toLowerCase();
}

function mediaTypeFromPath(sourcePath: string): string {
    const extension = normalizeIconExtension(sourcePath);
    return ICON_MEDIA_TYPES[extension] ?? "application/octet-stream";
}
