import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import type {
    ProjectTemplateAssetContent,
    ProjectTemplateDescriptor,
    ProjectTemplateInterfaceContent,
} from "@shared/types/projectTemplate";
import { PROJECT_TEMPLATES_DIR } from "@shared/constants/projectTemplate";
import { requireWindowProjectOrWriteGrant } from "../../../utils/windowProject";
import {
    listProjectTemplates,
    readProjectTemplateAssets,
    readProjectTemplateInterface,
    scaffoldProjectFromTemplate,
    type ScaffoldResult,
} from "../../projectTemplates";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Handlers for the project templates bundled under `resources/templates`.
 *
 * Reading them needs no capability — they ship with the app and are the same for
 * every author. Writing does, and it has two gates. The bytes come from the app's own
 * resources and nowhere else (`scaffoldProjectFromTemplate` refuses any id that would
 * leave that directory). The directory they land in is the one the caller names, and
 * that has to be a directory the caller could have written anyway: the project wizard
 * names the folder it is creating, which it holds a write grant over, and a window
 * that has a project may name only that project - see
 * `requireWindowProjectOrWriteGrant`. Without the second gate, any window could lay a
 * template's documents over another project's own.
 */

/**
 * Switch on the built-in plugins a template's content is built on.
 *
 * Two of the bundled plugins ship switched off, and the skeleton's screens are made out of one of
 * them, so a project created from it used to open on a warning about a plugin the author had never
 * touched and a button to press. Asking for the template is asking for what it is made of, and the
 * template states that in its manifest — so the press was the same decision, made a second time.
 *
 * Only built-ins, and only ones already installed: a third-party plugin an author switched off is
 * their decision about somebody else's code, and one that is not installed here has no switch to
 * throw. The project's dependency table names the plugin either way, so a failure is logged rather
 * than raised — it leaves the author exactly where this started, with the warning and the button.
 */
async function switchOnBuiltInDependencies(window: AppWindow, dependencies: readonly string[]): Promise<void> {
    if (dependencies.length === 0) {
        return;
    }
    try {
        const installed = await window.app.pluginManager.listPlugins();
        let switchedOn = false;
        for (const pluginId of dependencies) {
            const plugin = installed.find(entry => entry.pluginId === pluginId);
            if (!plugin?.builtIn || plugin.enabled) {
                continue;
            }
            await window.app.pluginManager.setPluginEnabled(pluginId, true);
            switchedOn = true;
            console.log(`[ProjectTemplate] Switched on built-in plugin ${pluginId}: the template's content depends on it`);
        }
        if (switchedOn) {
            void window.app.refreshPluginLocales();
        }
    } catch (error) {
        console.warn("[ProjectTemplate] Could not switch on the template's built-in plugins:", error);
    }
}

export class ProjectTemplateListHandler extends IPCHandler<IPCEventType.projectTemplateList> {
    readonly name = IPCEventType.projectTemplateList;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<ProjectTemplateDescriptor[]>> {
        return this.tryUse(() => listProjectTemplates(window.app.resolveResource(PROJECT_TEMPLATES_DIR)));
    }
}

export class ProjectTemplateScaffoldHandler extends IPCHandler<IPCEventType.projectTemplateScaffold> {
    readonly name = IPCEventType.projectTemplateScaffold;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.projectTemplateScaffold]["data"],
    ): Promise<RequestStatus<ScaffoldResult>> {
        const scaffolded = await this.tryUse(async () => scaffoldProjectFromTemplate(
            window.app.resolveResource(PROJECT_TEMPLATES_DIR),
            data.templateId,
            await requireWindowProjectOrWriteGrant(window, data.projectPath),
            data.locale,
        ));
        if (scaffolded.success && scaffolded.data) {
            await switchOnBuiltInDependencies(window, scaffolded.data.dependencies);
        }
        return scaffolded;
    }
}

/**
 * A template's interface documents, read for a workspace that is bringing a page out of it.
 *
 * Needs no grant for the same reason the list does: nothing is written, and the files are the app's
 * own. The window's project is never touched here - the page is joined to it in the renderer.
 */
export class ProjectTemplateReadInterfaceHandler extends IPCHandler<IPCEventType.projectTemplateReadInterface> {
    readonly name = IPCEventType.projectTemplateReadInterface;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.projectTemplateReadInterface]["data"],
    ): Promise<RequestStatus<ProjectTemplateInterfaceContent>> {
        return this.tryUse(() => readProjectTemplateInterface(
            window.app.resolveResource(PROJECT_TEMPLATES_DIR),
            data.templateId,
            data.locale,
        ));
    }
}

/** A template's own asset files, by id, for the page being brought out of it. */
export class ProjectTemplateReadAssetsHandler extends IPCHandler<IPCEventType.projectTemplateReadAssets> {
    readonly name = IPCEventType.projectTemplateReadAssets;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.projectTemplateReadAssets]["data"],
    ): Promise<RequestStatus<ProjectTemplateAssetContent[]>> {
        return this.tryUse(() => readProjectTemplateAssets(
            window.app.resolveResource(PROJECT_TEMPLATES_DIR),
            data.templateId,
            data.locale,
            Array.isArray(data.assetIds) ? data.assetIds.filter(id => typeof id === "string") : [],
        ));
    }
}
