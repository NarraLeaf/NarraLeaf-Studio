import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import type { ProjectTemplateDescriptor } from "@shared/types/projectTemplate";
import { PROJECT_TEMPLATES_DIR } from "@shared/constants/projectTemplate";
import { requireWindowProjectOrWriteGrant } from "../../../utils/windowProject";
import { listProjectTemplates, scaffoldProjectFromTemplate, type ScaffoldResult } from "../../projectTemplates";
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
        return this.tryUse(async () => scaffoldProjectFromTemplate(
            window.app.resolveResource(PROJECT_TEMPLATES_DIR),
            data.templateId,
            await requireWindowProjectOrWriteGrant(window, data.projectPath),
            data.locale,
        ));
    }
}
