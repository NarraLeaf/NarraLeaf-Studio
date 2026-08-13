/**
 * The Open Link node's request, for a Dev Mode preview.
 *
 * Dev Mode has to behave like the packaged game, or an author tests something the player will not
 * get: the same address is opened here and refused in the build, and nothing in between says why.
 * So this channel resolves the request exactly as the shipped game's main process does - against
 * the project's declared addresses - and refuses everything else.
 *
 * It is deliberately NOT a path to Studio's own `app.openExternal`. That handler exists for
 * Studio's interface, where the address comes from Studio itself; here the address comes from an
 * author's graph inside a running game, and handing that graph a general-purpose opener would make
 * Dev Mode the one shell where the declaration does not apply.
 *
 * The declaration is read off disk on every request rather than taken from the caller. A permission
 * passed in by the renderer would make this channel a way around the declaration instead of a way
 * to honour it.
 *
 * Comments in English per project convention.
 */

import { shell } from "electron";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import {
    resolveDeclaredExternalLink,
    resolvePluginExternalLinkAmong,
    type BlueprintOpenExternalResult,
    type ExternalLinkDeclaringPlugin,
} from "@shared/types/blueprint/externalLink";
import { RELEASE_APP_TAG, resolveAppTagExternalLinks } from "@shared/types/appTag";
import { readProjectAppTagDocumentFromDir } from "../../../utils/appTagsFile";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class BlueprintExternalLinkOpenHandler extends IPCHandler<IPCEventType.blueprintExternalLinkOpen> {
    readonly name = IPCEventType.blueprintExternalLinkOpen;
    readonly type = IPCMessageType.request;

    public async handle(
        _window: AppWindow,
        data: IPCEvents[IPCEventType.blueprintExternalLinkOpen]["data"],
    ): Promise<RequestStatus<{ result: BlueprintOpenExternalResult }>> {
        try {
            return this.success({ result: await openDeclaredLink(data.projectPath, data.request.url) });
        } catch (err) {
            return this.failed(err);
        }
    }
}

/**
 * One runtime plugin's request, in a Dev Mode preview.
 *
 * Dev Mode has to behave like the packaged game here too, and the packaged game reads the plugin's
 * declared patterns out of the manifest that shipped in its pack. There is no pack in Dev Mode, so
 * this reads the same manifest from the place Dev Mode gets its plugins: the install registry, which
 * is the record of what the author approved. That is one manifest, in both shells, and the check is
 * made in the process that opens the address.
 *
 * The renderer supplies only the plugin id and the address. It never supplies patterns - a
 * permission passed in by the caller would make this channel the way around the declaration rather
 * than the way to honour it - and the id is used to *select* a declaration, never to grant one.
 */
export class BlueprintExternalLinkOpenForPluginHandler
    extends IPCHandler<IPCEventType.blueprintExternalLinkOpenForPlugin> {
    readonly name = IPCEventType.blueprintExternalLinkOpenForPlugin;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.blueprintExternalLinkOpenForPlugin]["data"],
    ): Promise<RequestStatus<{ result: BlueprintOpenExternalResult }>> {
        try {
            let plugins: readonly ExternalLinkDeclaringPlugin[] = [];
            try {
                // Enabled plugins only, which `listRuntimePlugins` already restricts to: a disabled
                // plugin has no runtime in the window to be asking, and a revoked one is precisely
                // an approval the author took back.
                plugins = await window.app.pluginManager.listRuntimePlugins();
            } catch (error) {
                // An unreadable registry declares nothing, for the reason an unreadable app-tag
                // document does below: opening an address because a lookup failed is the one
                // outcome this must never produce.
                console.warn("[BlueprintExternalLink] Could not read the installed plugins", error);
                plugins = [];
            }
            const decision = resolvePluginExternalLinkAmong(plugins, data.pluginId, data.request);
            if (!decision.allowed) {
                console.warn(`[BlueprintExternalLink] Refused: ${decision.result.error}`);
                return this.success({ result: decision.result });
            }
            try {
                await shell.openExternal(decision.url);
                return this.success({ result: { outcome: "opened", error: null } });
            } catch (error) {
                return this.success({
                    result: {
                        outcome: "failed",
                        error: error instanceof Error ? error.message : String(error),
                    },
                });
            }
        } catch (err) {
            return this.failed(err);
        }
    }
}

/**
 * A project in Dev Mode is being run as itself, so the release variant's list is what applies - the
 * project's own addresses. A preview compile passes no variant either, which is the same rule read
 * from the other side.
 */
async function openDeclaredLink(
    projectPath: string,
    url: string,
): Promise<BlueprintOpenExternalResult> {
    let declared: readonly string[];
    try {
        const document = await readProjectAppTagDocumentFromDir(projectPath);
        declared = resolveAppTagExternalLinks(RELEASE_APP_TAG, document.externalLinks).value;
    } catch (error) {
        // An unreadable document declares nothing: the build would refuse this address too, and
        // opening a page because a file failed to parse is the one outcome this must never produce.
        console.warn("[BlueprintExternalLink] Could not read the project's declared links", error);
        declared = [];
    }

    const decision = resolveDeclaredExternalLink({ url }, declared);
    if (!decision.allowed) {
        console.warn(`[BlueprintExternalLink] Refused: ${decision.result.error}`);
        return decision.result;
    }
    try {
        await shell.openExternal(decision.url);
        return { outcome: "opened", error: null };
    } catch (error) {
        return { outcome: "failed", error: error instanceof Error ? error.message : String(error) };
    }
}
