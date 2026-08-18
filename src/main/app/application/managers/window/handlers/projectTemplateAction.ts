import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import type { ProjectTemplateDescriptor } from "@shared/types/projectTemplate";
import { PROJECT_TEMPLATES_DIR } from "@shared/constants/projectTemplate";
import { listProjectTemplates, scaffoldProjectFromTemplate } from "../../projectTemplates";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Handlers for the project templates bundled under `resources/templates`.
 *
 * Reading them needs no capability — they ship with the app and are the same for
 * every author. Writing does, and its gate is the shape of the call rather than a
 * permission: the only directory that can be written is the one the caller names,
 * and the only bytes that can be written into it come from the app's own resources
 * (`scaffoldProjectFromTemplate` refuses any id that would leave that directory).
 */

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
    ): Promise<RequestStatus<{ filesCopied: number; locales: string[] }>> {
        return this.tryUse(() => scaffoldProjectFromTemplate(
            window.app.resolveResource(PROJECT_TEMPLATES_DIR),
            data.templateId,
            data.projectPath,
        ));
    }
}
