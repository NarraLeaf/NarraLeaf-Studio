import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { IPCMessageType } from "@shared/types/ipc";
import type { SpellcheckStatus } from "@shared/types/spellcheck";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * The spellchecker's four channels.
 *
 * All of them exist because the spellchecker lives below the page: the language, the custom
 * dictionary and the verdict on a given word are the session's, and a renderer has no way to read
 * or set any of them. The project dictionary itself stays in the renderer, which owns the document.
 */

/** Hand the session a project: the language of its script, and the words it spells on purpose. */
export class SpellcheckConfigureHandler extends IPCHandler<IPCEventType.spellcheckConfigure> {
    readonly name = IPCEventType.spellcheckConfigure;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.spellcheckConfigure]["data"],
    ): Promise<RequestStatus<SpellcheckStatus>> {
        return this.tryUse(() => window.getApp().getSpellcheckManager().configure(data));
    }
}

/**
 * Take this project's words back out of the session.
 *
 * Sent when a workspace closes or switches project. Without it the words stay in the Electron
 * profile, which is machine-scoped: the next project would silently accept a cast it has never
 * heard of, and nothing anywhere would say why.
 */
export class SpellcheckClearHandler extends IPCHandler<IPCEventType.spellcheckClear> {
    readonly name = IPCEventType.spellcheckClear;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<void>> {
        return this.tryUse(() => window.getApp().getSpellcheckManager().clear());
    }
}

/**
 * What spellchecking is doing now.
 *
 * The Settings window is the caller and has no project of its own, so it cannot work out either the
 * project's language or which languages this build of Chromium has a dictionary for.
 */
export class SpellcheckStatusHandler extends IPCHandler<IPCEventType.spellcheckStatus> {
    readonly name = IPCEventType.spellcheckStatus;
    readonly type = IPCMessageType.request;

    public async handle(window: AppWindow): Promise<RequestStatus<SpellcheckStatus>> {
        return this.tryUse(() => window.getApp().getSpellcheckManager().getStatus());
    }
}

/**
 * Put a suggestion in place of the misspelling the context menu was opened on.
 *
 * `webContents.replaceMisspelling` and not an ordinary text edit: it replaces the word Chromium
 * marked, which is the one the suggestions belong to, and it goes through the same edit path as
 * typing - so the field's own input handling, undo and change events all see it.
 */
export class SpellcheckReplaceMisspellingHandler extends IPCHandler<IPCEventType.spellcheckReplaceMisspelling> {
    readonly name = IPCEventType.spellcheckReplaceMisspelling;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { text }: IPCEvents[IPCEventType.spellcheckReplaceMisspelling]["data"],
    ): Promise<RequestStatus<void>> {
        return this.tryUse(() => window.getWebContents().replaceMisspelling(text));
    }
}
