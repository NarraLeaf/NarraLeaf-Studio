import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import type { UITemplateBundle, UITemplateFetchResult } from "@shared/types/uiTemplateRegistry";
import {
    fetchTemplateBundle,
    fetchTemplateIndex,
    resolveTemplateRegistryUrl,
} from "../../uiTemplateRegistryClient";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Read-only handlers for the UI template store. Fetching is a public GET of the
 * configured registry (or the official default); nothing is written to disk, so
 * there is no install capability to gate. The document pair is applied into the
 * open project by the renderer, not here.
 */

export class UITemplateRegistryFetchHandler extends IPCHandler<IPCEventType.uiTemplateRegistryFetch> {
    readonly name = IPCEventType.uiTemplateRegistryFetch;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<UITemplateFetchResult>> {
        const registryUrl = resolveTemplateRegistryUrl(window.app.getGlobalState().get("uiTemplates.registryUrl"));
        return this.tryUse(async () => ({
            registryUrl,
            index: await fetchTemplateIndex(registryUrl),
        }));
    }
}

export class UITemplateFetchBundleHandler extends IPCHandler<IPCEventType.uiTemplateFetchBundle> {
    readonly name = IPCEventType.uiTemplateFetchBundle;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.uiTemplateFetchBundle]["data"],
    ): Promise<RequestStatus<UITemplateBundle>> {
        // Re-fetch the index and match the id here so the fetched paths are the
        // ones the trusted registry carries, never addresses supplied by the renderer.
        const registryUrl = resolveTemplateRegistryUrl(window.app.getGlobalState().get("uiTemplates.registryUrl"));
        return this.tryUse(async () => {
            const index = await fetchTemplateIndex(registryUrl);
            const entry = index.templates.find(template => template.id === data.templateId);
            if (!entry) {
                throw new Error(`Template is not in the registry: ${data.templateId}`);
            }
            return fetchTemplateBundle(entry, registryUrl);
        });
    }
}
