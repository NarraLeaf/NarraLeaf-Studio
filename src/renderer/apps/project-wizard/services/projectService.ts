import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import { ProjectData } from "../types";
import { encodeProjectConfig, getProjectConfigFileName } from "@shared/utils/nlproj";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { BaseFileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { BaseProjectService } from "@/lib/workspace/services/core/ProjectService";
import { join } from "@shared/utils/path";
import { WindowAppType } from "@shared/types/window";
import { throwException } from "@shared/utils/error";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import {
    DEFAULT_APP_SURFACE_NAME,
    DEFAULT_UI_DOCUMENT_NAME,
    DEFAULT_UI_ROOT_NAME,
    DEFAULT_UI_SURFACE_SIZE,
} from "@shared/constants/ui-editor";
import type {
    UIElement,
    UIDocument,
    UISurface,
    UISurfaceDesignSize,
} from "@shared/types/ui-editor/document";
import { UI_DOCUMENT_SCHEMA_VERSION } from "@shared/types/ui-editor/document";

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

            // Write .nlproj (msgpack-encoded project config)
            const projectConfigFileName = getProjectConfigFileName(projectData.name);
            const projectConfigPath = join(basePath, projectConfigFileName);
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
            const encoded = encodeProjectConfig(projectConfig);
            throwException(await BaseFileSystemService.writeRaw(projectConfigPath, encoded));

            // Create directories
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.NLCache)));
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.Plugins)));
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.Assets)));
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.AssetsContent)));
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.Scripts)));
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.Editor)));
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.EditorAssets)));
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.EditorServices)));
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.EditorUI)));
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.EditorStory)));
            throwException(await BaseFileSystemService.createDir(this.resolve(basePath, ProjectNameConvention.EditorStoryStories)));

            // Write editor.json
            const editorConfigPath = this.resolve(basePath, ProjectNameConvention.EditorConfig);
            const editorConfig = BaseProjectService.getInitialEditorConfig();
            throwException(await BaseFileSystemService.write(editorConfigPath, JSON.stringify(editorConfig), "utf-8"));

            // Write default UI document so App Surface has a default page
            const uiDocument = createDefaultUIDocument(getDesignSizeFromResolution(projectData.resolution));
            const uiDocumentPath = this.resolve(basePath, ProjectNameConvention.EditorUIDocument);
            throwException(await BaseFileSystemService.write(uiDocumentPath, JSON.stringify(uiDocument, null, 2), "utf-8"));

            // Initialize assets metadata files for all asset types
            for (const type of Object.values(AssetType)) {
                const metadataPath = this.resolve(basePath, ProjectNameConvention.AssetsMetadataShard(type));
                throwException(await BaseFileSystemService.write(metadataPath, JSON.stringify({}), "utf-8"));

                const groupsPath = this.resolve(basePath, ProjectNameConvention.AssetsGroupsShard(type));
                throwException(await BaseFileSystemService.write(groupsPath, JSON.stringify({}), "utf-8"));
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
            errors.push(translate("wizard.validation.nameRequired"));
        }

        if (!projectData.appId.trim()) {
            errors.push(translate("wizard.details.appIdRequired"));
        }

        if (!projectData.location.trim()) {
            errors.push(translate("wizard.validation.locationRequired"));
        }

        if (!projectData.template) {
            errors.push(translate("wizard.validation.templateRequired"));
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

function getDesignSizeFromResolution(resolution?: string): UISurfaceDesignSize {
    const parsed = BaseProjectService.parseResolution(resolution ?? "");
    const width = Number.isFinite(parsed.width) ? parsed.width : DEFAULT_UI_SURFACE_SIZE.width;
    const height = Number.isFinite(parsed.height) ? parsed.height : DEFAULT_UI_SURFACE_SIZE.height;
    return { width, height };
}

function createDefaultUIDocument(designSize: UISurfaceDesignSize): UIDocument {
    const now = new Date().toISOString();
    const documentId = createId();
    const surfaceId = createId();
    const rootElementId = createId();

    const rootElement: UIElement = {
        id: rootElementId,
        type: "nl.root",
        name: DEFAULT_UI_ROOT_NAME,
        parentId: null,
        childrenIds: [],
        layout: {
            x: 0,
            y: 0,
            width: designSize.width,
            height: designSize.height,
            visible: true,
            opacity: 1,
        },
    };

    const surface: UISurface = {
        id: surfaceId,
        name: DEFAULT_APP_SURFACE_NAME,
        host: "app",
        kind: "appSurface",
        designSize,
        rootElementId,
    };

    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: documentId,
        name: DEFAULT_UI_DOCUMENT_NAME,
        surfaces: [surface],
        components: [],
        elements: {
            [rootElementId]: rootElement,
        },
        meta: {
            createdAt: now,
            updatedAt: now,
        },
    };
}

function createId(): string {
    const context = globalThis as typeof globalThis & {
        crypto?: { randomUUID?: () => string };
    };
    const uuid = context.crypto?.randomUUID?.();
    if (uuid) {
        return uuid;
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
