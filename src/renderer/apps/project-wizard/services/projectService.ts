import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import { isValidLocaleCode, localeAutonym } from "@shared/types/localization";
import { parseStageSize, stageOrientation } from "@shared/types/stageSize";
import { DEFAULT_MOBILE_CONFIGURATION, DEFAULT_NETWORK_CONFIGURATION } from "@/lib/workspace/project/configuration";
import type { ProjectAppConfiguration } from "@/lib/workspace/project/configuration";
import { ProjectData } from "../types";
import { encodeProjectConfig, getProjectConfigFileName, type ProjectConfigData } from "@shared/utils/nlproj";

import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { BaseFileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { BaseProjectService } from "@/lib/workspace/services/core/ProjectService";
import { join } from "@shared/utils/path";
import { VCS_PROJECT_CREATED_MESSAGE } from "@shared/vcs/systemRevisionMessage";
import { WindowAppType } from "@shared/types/window";
import { throwException } from "@shared/utils/error";
import { EMPTY_ASSET_ORDER_TEXT } from "@/lib/workspace/services/assets/assetOrder";
import { ASSET_CATEGORY_ORDER, AssetType } from "@/lib/workspace/services/assets/assetTypes";
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

            // The stage the project is authored in. Read once and used for BOTH the manifest and
            // the interface document, because they are the same fact told to two readers: the
            // story preview and every surface created later read `metadata.resolution`, while the
            // editor lays out against the surface's own `designSize`. They disagreed whenever a
            // content template was applied - the template's surfaces landed at the size they were
            // drawn for while the manifest kept whatever the author had picked - and nothing on
            // screen said so. The wizard now only offers sizes the chosen template declares, so
            // this one value is true of both.
            const designSize = getDesignSize(projectData.resolution);

            // Write .nlproj (msgpack-encoded project config)
            const projectConfigFileName = getProjectConfigFileName(projectData.name);
            const projectConfigPath = join(basePath, projectConfigFileName);
            const projectConfig = BaseProjectService.getInitialConfig({
                name: projectData.name,
                identifier: projectData.appId,
                metadata: {
                    description: projectData.description,
                    author: projectData.author,
                    website: projectData.website,
                    // Written even though the project panel can edit it, because leaving it unset
                    // is not neutral: the build preflight refuses outright on a missing version
                    // (`version-missing`), so every project created without one had to be sent
                    // back to the panel before it could be packaged even once.
                    version: projectData.version,
                    resolution: designSize,
                },
                app: buildAppConfiguration(projectData, designSize),
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
            const uiDocument = createDefaultUIDocument(designSize);
            const uiDocumentPath = this.resolve(basePath, ProjectNameConvention.EditorUIDocument);
            throwException(await BaseFileSystemService.write(uiDocumentPath, JSON.stringify(uiDocument, null, 2), "utf-8"));

            // Initialize assets metadata files for all asset types
            for (const type of Object.values(AssetType)) {
                const metadataPath = this.resolve(basePath, ProjectNameConvention.AssetsMetadataShard(type));
                throwException(await BaseFileSystemService.write(metadataPath, JSON.stringify({}), "utf-8"));
            }

            // Folders and row order are sharded one level up, by sidebar section.
            for (const category of ASSET_CATEGORY_ORDER) {
                const groupsPath = this.resolve(basePath, ProjectNameConvention.AssetsGroupsShard(category));
                throwException(await BaseFileSystemService.write(groupsPath, JSON.stringify({}), "utf-8"));

                // Created here as well as on open, so a new project's first commit already has the
                // file rather than growing one in the second.
                const orderPath = this.resolve(basePath, ProjectNameConvention.AssetsOrderShard(category));
                throwException(await BaseFileSystemService.write(orderPath, EMPTY_ASSET_ORDER_TEXT, "utf-8"));
            }

            // A template's content goes on top of the skeleton, replacing the empty
            // defaults just written (the one-blank-page interface document, the empty
            // asset shards) with the authored versions. Before version control, so the
            // first revision is the project the author received rather than an empty
            // one that grew its content in a second commit.
            if (projectData.contentTemplateId) {
                const templateLocales = await this.applyProjectTemplate(basePath, projectData.contentTemplateId);
                await this.registerTemplateLocales(projectConfigPath, projectConfig, templateLocales);
            }

            // LAST, and only after every file above is on disk: the first revision is a snapshot of
            // the working tree, so a repository created earlier would record a project that is
            // half-written. Nothing is committed twice - `initRepository` stages the whole root.
            if (projectData.versionControl === "lore") {
                await this.enableVersionControl(basePath);
            }

            getInterface().window.closeWith<WindowAppType.ProjectWizard>({ created: true, projectPath: basePath });

            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("Failed to create project:", errorMessage);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Copy the chosen bundled template's content over the project just written.
     *
     * **A failure here does fail the project**, unlike version control below. The
     * difference is what the author is left holding: a project that could not be
     * versioned is still the project they asked for, and the version rail offers
     * Enable in one click. A project whose template did not land is an empty
     * project wearing the name of a template — nothing on screen would say so, and
     * the recovery is to delete the directory and start again. Better to say it now,
     * while the wizard is still open and the message can name what went wrong.
     */
    private static async applyProjectTemplate(projectPath: string, templateId: string): Promise<string[]> {
        const result = await getInterface().projectTemplates.scaffold(templateId, projectPath);
        if (!result.success) {
            throw new Error(result.error || translate("wizard.validation.templateFailed"));
        }
        return result.data?.locales ?? [];
    }

    /**
     * Register the languages the template shipped translations for.
     *
     * A template's `content/` is copied verbatim, but the list of a project's languages is not in
     * there - it lives in the `.nlproj`, which is generated per project and which a template is
     * never allowed to carry. So a template that ships `editor/localization/zh-CN.json` used to
     * hand the author a complete translation and no way to reach it: the localization panel showed
     * the source language alone, and the game had no second language to play in. The files were on
     * disk the whole time.
     *
     * This is a second write of a file written moments ago rather than a reordering of the
     * creation, because the config has to exist before the template lands (it is what makes the
     * directory a project) and the languages are only knowable after. Nothing reads the file in
     * between.
     *
     * Only when the project already has a source language: locales without one is a half-configured
     * state that no panel would know how to show, and the wizard always sets one when the author
     * picked a script language.
     */
    private static async registerTemplateLocales(
        configPath: string,
        config: ProjectConfigData,
        codes: string[],
    ): Promise<void> {
        const app = config.app as ProjectAppConfiguration | undefined;
        const existing = app?.localization;
        if (!existing || !isValidLocaleCode(existing.sourceLocale)) {
            return;
        }
        const known = new Set(existing.locales.map(entry => entry.code));
        const added = codes.filter(code => isValidLocaleCode(code) && !known.has(code));
        if (!added.length) {
            return;
        }
        const next: ProjectConfigData = {
            ...config,
            app: {
                ...app,
                localization: {
                    sourceLocale: existing.sourceLocale,
                    locales: [
                        ...existing.locales,
                        ...added.map(code => ({ code, displayName: localeAutonym(code) })),
                    ],
                },
            },
        };
        throwException(await BaseFileSystemService.writeRaw(configPath, encodeProjectConfig(next)));
    }

    /**
     * Put the freshly written project under version control, because the author asked for it on
     * the Settings step.
     *
     * **A failure here does not fail the project.** Everything the project IS has already been
     * written and is correct; refusing to finish would leave the author looking at a wizard they
     * cannot re-run - the directory is no longer empty - holding a project that exists on disk and
     * nowhere in Studio. So this logs and returns, and they land in a workspace whose version rail
     * says "Not versioned" over an Enable button. That is the same recovery the rail already
     * offers, reached in one click, with the state visible rather than assumed.
     *
     * The window has no notification surface of its own and closes moments later, which is why the
     * console is where this goes. `initRepository` is otherwise the very same call the rail's
     * Enable button makes, including the identity resolution, so a project versioned here is
     * indistinguishable from one versioned a minute later by hand.
     */
    private static async enableVersionControl(projectPath: string): Promise<void> {
        try {
            // Its own message rather than the backend's "Enable version control", which describes
            // an act this author never performed - they made a project and it was versioned from
            // the start. This is the last row of the history forever, so it should say what
            // happened. Not localized: a revision message is repository DATA, read by other
            // clients and by this project's collaborators, not this window's chrome.
            // Imported rather than written here: the rail recognises Studio's own sentences to read
            // them back in the author's language, and this one being a literal in the wizard is how
            // every project created through it got an English line at the bottom of its history.
            const result = await getInterface().vcs.initRepository(projectPath, {
                message: VCS_PROJECT_CREATED_MESSAGE,
            });
            if (!result.success) {
                console.warn("[Wizard] Project created, but version control could not be enabled:", result.error);
            }
        } catch (error) {
            console.warn("[Wizard] Project created, but version control could not be enabled:", error);
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
            errors.push(translate("wizard.project.appIdRequired"));
        }

        if (!projectData.location.trim()) {
            errors.push(translate("wizard.validation.locationRequired"));
        }

        if (!projectData.template) {
            errors.push(translate("wizard.validation.templateRequired"));
        }

        // Last line of defence for the one answer that cannot be corrected afterwards. The stage
        // step already refuses to be valid without it; this is what makes a future caller that
        // skips the steps fail loudly rather than write a project at 1280x720 by accident.
        if (!parseStageSize(projectData.resolution)) {
            errors.push(translate("wizard.validation.stageSizeRequired"));
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}

function getDesignSize(resolution: string): UISurfaceDesignSize {
    // The wizard cannot reach Create with an unusable size (the stage step clears it and the step
    // stops being valid), so the fallback is for a path that does not exist rather than a size
    // anybody chose - and it must still not be NaN, which is what `parseResolution` returns.
    return parseStageSize(resolution) ?? { ...DEFAULT_UI_SURFACE_SIZE };
}

/**
 * The `app` block a new project starts with.
 *
 * Only the parts the wizard has an answer for. Everything else in `ProjectAppConfiguration` is
 * absent on purpose: those fields default at read time, and writing today's defaults into every
 * project ever created would freeze them there - improving a default would never reach a project
 * that had already been made.
 */
function buildAppConfiguration(
    projectData: ProjectData,
    designSize: UISurfaceDesignSize,
): ProjectAppConfiguration {
    const sourceLocale = projectData.sourceLocale.trim();
    return {
        network: { ...DEFAULT_NETWORK_CONFIGURATION },
        // Derived rather than asked. A project laid out taller than it is wide plays upright, and
        // a second control that agrees with the stage size in every case but the one where somebody
        // set them apart by accident is not a choice, it is a way to be inconsistent. The project
        // panel still offers `auto` for anyone who wants it.
        // Fit and crop anchor come from the defaults: a new project letterboxes, same as every
        // project that predates the setting, and cropping is a decision about the art that nobody
        // has made yet at wizard time.
        mobile: { ...DEFAULT_MOBILE_CONFIGURATION, orientation: stageOrientation(designSize) },
        // The source language only; targets are the localization panel's business. Absent when
        // there is none, which is what `sourceLocale: ""` means to every reader of this field.
        ...(isValidLocaleCode(sourceLocale)
            ? {
                localization: {
                    sourceLocale,
                    locales: [{ code: sourceLocale, displayName: localeAutonym(sourceLocale) }],
                },
            }
            : {}),
    };
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
