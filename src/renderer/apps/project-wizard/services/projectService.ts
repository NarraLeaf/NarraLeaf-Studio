import { getInterface } from "@/lib/app/bridge";
import { ProjectData } from "../types";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { BaseFileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { BaseProjectService } from "@/lib/workspace/services/core/ProjectService";
import { join } from "@shared/utils/path";
import { WindowAppType } from "@shared/types/window";
import { throwException } from "@shared/utils/error";

/**
 * Service for handling project creation logic
 */
export class ProjectService {
    static async createProject(projectData: ProjectData): Promise<{ success: boolean; error?: string }> {
        try {
            console.log("Creating project:", projectData);

            const basePath = projectData.location;

            // Ensure project directory exists before writing files
            const dirExists = throwException(await BaseFileSystemService.isDirExists(basePath));
            if (!dirExists) {
                throwException(await BaseFileSystemService.createDir(basePath));
            }

            // Write project.json
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
            throwException(await BaseFileSystemService.write(projectConfigPath, JSON.stringify(projectConfig, null, 2), "utf-8"));

            // Create directories
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.NLCache)));
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.Plugins)));
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.Assets)));
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.AssetsContent)));
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.Scripts)));

            // Write editor.json
            const editorConfigPath = this.resolve(basePath, ProjectNameConvention.EditorConfig);
            const editorConfig = BaseProjectService.getInitialEditorConfig();
            throwException(await BaseFileSystemService.write(editorConfigPath, JSON.stringify(editorConfig, null, 2), "utf-8"));

            // Initialize assets metadata files for all asset types
            const assetTypes = ["image", "audio", "video", "json", "font", "other"];
            for (const type of assetTypes) {
                const metadataPath = this.resolve(basePath, ProjectNameConvention.AssetsMetadataShard(type as any));
                throwException(await BaseFileSystemService.write(metadataPath, JSON.stringify({}, null, 2), "utf-8"));
                
                const groupsPath = this.resolve(basePath, ProjectNameConvention.AssetsGroupsShard(type as any));
                throwException(await BaseFileSystemService.write(groupsPath, JSON.stringify({}, null, 2), "utf-8"));
            }

            getInterface().window.closeWith<WindowAppType.ProjectWizard>({ created: true, projectPath: basePath });
            
            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("Failed to create project:", errorMessage);
            return { success: false, error: errorMessage };
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
