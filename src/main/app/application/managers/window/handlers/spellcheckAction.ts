import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { IPCMessageType } from "@shared/types/ipc";
import type {
  AvailableSpellcheckDictionary,
  InstalledSpellcheckDictionary,
  SpellcheckRange,
  SpellcheckStatus
} from "@shared/types/spellcheck";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * The spellchecker's channels.
 *
 * They exist because the checker runs in the main process, and it runs there for two reasons that
 * are independent of each other: its dictionaries are downloaded, and every remote byte in this app
 * goes through main; and the renderer has no thread to check on, since its `file://` document
 * cannot start a Web Worker. The project dictionary itself stays in the renderer, which owns the
 * document - {@link SpellcheckConfigureHandler} is only how its words reach the checker.
 *
 * The window is passed to the handlers that need it and used as the key the project words are held
 * under, so two projects open at once never see each other's vocabulary.
 */

/** Take this window's project: the language of its script, and the words it spells on purpose. */
export class SpellcheckConfigureHandler extends IPCHandler<IPCEventType.spellcheckConfigure> {
  readonly name = IPCEventType.spellcheckConfigure;
  readonly type = IPCMessageType.request;

  public async handle(
    window: AppWindow,
    data: IPCEvents[IPCEventType.spellcheckConfigure]["data"]
  ): Promise<RequestStatus<SpellcheckStatus>> {
    return this.tryUse(() => window.getApp().getSpellcheckManager().configure(window, data));
  }
}

/** Forget this window's project words. Sent when a workspace closes or switches project. */
export class SpellcheckClearHandler extends IPCHandler<IPCEventType.spellcheckClear> {
  readonly name = IPCEventType.spellcheckClear;
  readonly type = IPCMessageType.request;

  public async handle(window: AppWindow): Promise<RequestStatus<void>> {
    return this.tryUse(() => window.getApp().getSpellcheckManager().clear(window));
  }
}

/**
 * What spellchecking is doing now.
 *
 * The Settings window is the caller and has no project of its own, so it cannot work out either the
 * project's language or which languages have a dictionary installed.
 */
export class SpellcheckStatusHandler extends IPCHandler<IPCEventType.spellcheckStatus> {
  readonly name = IPCEventType.spellcheckStatus;
  readonly type = IPCMessageType.request;

  public async handle(window: AppWindow): Promise<RequestStatus<SpellcheckStatus>> {
    return this.tryUse(() => window.getApp().getSpellcheckManager().getStatus());
  }
}

/**
 * Check one run of plain text.
 *
 * The offsets that come back are into the text that was sent, not positions in a document - the
 * caller built the string and is the only thing that can map them back.
 */
export class SpellcheckCheckHandler extends IPCHandler<IPCEventType.spellcheckCheck> {
  readonly name = IPCEventType.spellcheckCheck;
  readonly type = IPCMessageType.request;

  public async handle(
    window: AppWindow,
    { text, language }: IPCEvents[IPCEventType.spellcheckCheck]["data"]
  ): Promise<RequestStatus<{ ranges: SpellcheckRange[] }>> {
    return this.tryUse(() => window.getApp().getSpellcheckManager().check(window, text, language));
  }
}

/** Replacements for one misspelling, nearest first, at most five. */
export class SpellcheckSuggestHandler extends IPCHandler<IPCEventType.spellcheckSuggest> {
  readonly name = IPCEventType.spellcheckSuggest;
  readonly type = IPCMessageType.request;

  public async handle(
    window: AppWindow,
    { word, language }: IPCEvents[IPCEventType.spellcheckSuggest]["data"]
  ): Promise<RequestStatus<{ suggestions: string[] }>> {
    return this.tryUse(() => window.getApp().getSpellcheckManager().suggest(word, language));
  }
}

/** The dictionaries on this machine. Reads the cache, so it never touches the network. */
export class SpellcheckListInstalledHandler extends IPCHandler<IPCEventType.spellcheckListInstalled> {
  readonly name = IPCEventType.spellcheckListInstalled;
  readonly type = IPCMessageType.request;

  public async handle(
    window: AppWindow
  ): Promise<RequestStatus<{ languages: InstalledSpellcheckDictionary[] }>> {
    return this.tryUse(() => window.getApp().getSpellcheckManager().listInstalled());
  }
}

/** What the registry offers, with the licence each word list is published under. */
export class SpellcheckListAvailableHandler extends IPCHandler<IPCEventType.spellcheckListAvailable> {
  readonly name = IPCEventType.spellcheckListAvailable;
  readonly type = IPCMessageType.request;

  public async handle(
    window: AppWindow
  ): Promise<RequestStatus<{ entries: AvailableSpellcheckDictionary[] }>> {
    return this.tryUse(() => window.getApp().getSpellcheckManager().listAvailable());
  }
}

/**
 * Fetch one dictionary into the cache.
 *
 * The renderer names which registry entry, never an address: the URL comes out of the index, is
 * `https:` by construction, and the bytes are refused unless their sha256 is the published one.
 */
export class SpellcheckDownloadHandler extends IPCHandler<IPCEventType.spellcheckDownload> {
  readonly name = IPCEventType.spellcheckDownload;
  readonly type = IPCMessageType.request;

  public async handle(
    window: AppWindow,
    { code }: IPCEvents[IPCEventType.spellcheckDownload]["data"]
  ): Promise<RequestStatus<{ ok: boolean }>> {
    return this.tryUse(() => window.getApp().getSpellcheckManager().download(code));
  }
}

/** Delete one dictionary from the cache. */
export class SpellcheckRemoveHandler extends IPCHandler<IPCEventType.spellcheckRemove> {
  readonly name = IPCEventType.spellcheckRemove;
  readonly type = IPCMessageType.request;

  public async handle(
    window: AppWindow,
    { code }: IPCEvents[IPCEventType.spellcheckRemove]["data"]
  ): Promise<RequestStatus<{ ok: boolean }>> {
    return this.tryUse(() => window.getApp().getSpellcheckManager().remove(code));
  }
}
