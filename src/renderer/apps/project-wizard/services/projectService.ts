import { getInterface } from "@/lib/app/bridge";
import { ProjectData } from "../types";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { BaseFileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { BaseProjectService } from "@/lib/workspace/services/core/ProjectService";
import { join } from "@shared/utils/path";

/**
 * Service for handling project creation logic
 */
export class ProjectService {
    static async createProject(projectData: ProjectData): Promise<{ success: boolean; error?: string }> {
        try {
            console.log("Creating project:", projectData);

            const basePath = projectData.location;

            const projectConfigPath = this.resolve(basePath, ProjectNameConvention.ProjectConfig);
            const projectConfig = BaseProjectService.getInitialConfig({
                name: projectData.name,
                identifier: projectData.appId,
                metadata: {
                    description: projectData.description,
                    author: projectData.author,
                    license: projectData.license,
                    licenseString: projectData.licenseCustom,
                    resolution: BaseProjectService.parseResolution(projectData.resolution),
                },
            });
            await BaseFileSystemService.write(projectConfigPath, JSON.stringify(projectConfig, null, 2), "utf-8");

            const assetsMetadataPath = this.resolve(basePath, ProjectNameConvention.AssetsMetadata);
            const assetsMetadata = BaseProjectService.getInitialAssetsMetadata();
            await BaseFileSystemService.write(assetsMetadataPath, JSON.stringify(assetsMetadata, null, 2), "utf-8");

            const NLCachePath = this.resolve(basePath, ProjectNameConvention.NLCache);
            await BaseFileSystemService.createDir(NLCachePath);

            const pluginsPath = this.resolve(basePath, ProjectNameConvention.Plugins);
            await BaseFileSystemService.createDir(pluginsPath);

            const editorConfigPath = this.resolve(basePath, ProjectNameConvention.EditorConfig);
            const editorConfig = BaseProjectService.getInitialEditorConfig();
            await BaseFileSystemService.write(editorConfigPath, JSON.stringify(editorConfig, null, 2), "utf-8");

            const assetsPath = this.resolve(basePath, ProjectNameConvention.Assets);
            await BaseFileSystemService.createDir(assetsPath);

            const scriptsPath = this.resolve(basePath, ProjectNameConvention.Scripts);
            await BaseFileSystemService.createDir(scriptsPath);
            
            return { success: true };
        } catch (error) {
            console.error("Failed to create project:", error);
            return { success: false, error: "Failed to create project" };
        }
    }

    static isDir(dest: Readonly<string[]>): boolean {
        return dest.at(-1)!.endsWith("/");
    }

    static resolve(base: string, dest: Readonly<string[]>): string {
        return join(base, ...dest);
    }

    static isFile(dest: Readonly<string[]>): boolean {
        return !dest.at(-1)!.endsWith("/");
    }

    static dirName(dest: Readonly<string[]>): string | null {
        if (dest.length <= 1) {
            return null;
        }
        return dest.slice(0, -1).join("/");
    }

    /**
     * Validate project data before creation
     */
    static validateProjectData(projectData: ProjectData): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!projectData.name.trim()) {
            errors.push("Project name is required");
        }

        if (!projectData.appId.trim()) {
            errors.push("App ID is required");
        }

        if (!projectData.location.trim()) {
            errors.push("Project location is required");
        }

        if (!projectData.template) {
            errors.push("Project template is required");
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}
