import crypto from "crypto";
import path from "path";
import { UserDataNamespace } from "@shared/types/constants";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import type { PersistentState } from "@shared/utils/persistentState";
import { requireWindowProjectStore, type ProjectStoreRef } from "../../../utils/windowProjectStore";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

type BlueprintPersistentValueStore = Record<string, unknown>;

function projectNamespaceSource(projectRef: ProjectStoreRef): string {
    const identifier = projectRef.projectIdentifier?.trim();
    if (identifier) {
        return `id:${identifier}`;
    }
    const projectPath = projectRef.projectPath?.trim();
    if (!projectPath) {
        throw new Error("Blueprint persistence requires a project identifier or project path");
    }
    return `path:${path.resolve(projectPath)}`;
}

function projectStoreName(projectRef: ProjectStoreRef): string {
    const source = projectNamespaceSource(projectRef);
    const hash = crypto.createHash("sha256").update(source).digest("hex").slice(0, 32);
    return `project-${hash}`;
}

function createStore(window: AppWindow, projectRef: ProjectStoreRef): PersistentState<BlueprintPersistentValueStore> {
    return window.app.storageManager.createState<BlueprintPersistentValueStore>(
        UserDataNamespace.BlueprintPersistence,
        projectStoreName(projectRef),
        {},
    );
}

/**
 * Empty a project's Dev Mode persistence store: persistent variables, unlocked content, read-text
 * and every plugin store keyed under it. Through the store's own `clear` rather than deleting the
 * file, so an instance the store opens next reads an empty state rather than a missing one.
 *
 * Takes a reference the main process derived with `requireWindowProjectStore`, never the one a
 * request carried: the identifier decides which store this is, and it is not the caller's to name.
 */
export function clearBlueprintPersistence(window: AppWindow, projectRef: ProjectStoreRef): void {
    createStore(window, projectRef).clear();
}

export class BlueprintPersistenceGetAllHandler extends IPCHandler<IPCEventType.blueprintPersistenceGetAll> {
    readonly name = IPCEventType.blueprintPersistenceGetAll;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.blueprintPersistenceGetAll]["data"],
    ): Promise<RequestStatus<{ values: Record<string, unknown> }>> {
        return this.tryUse(async () => ({
            values: { ...createStore(window, await requireWindowProjectStore(window, data.projectRef)).raw() },
        }));
    }
}

export class BlueprintPersistenceGetValueHandler extends IPCHandler<IPCEventType.blueprintPersistenceGetValue> {
    readonly name = IPCEventType.blueprintPersistenceGetValue;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.blueprintPersistenceGetValue]["data"],
    ): Promise<RequestStatus<{ value: unknown }>> {
        return this.tryUse(async () => ({
            value: createStore(window, await requireWindowProjectStore(window, data.projectRef)).getItem(data.key),
        }));
    }
}

/**
 * Writes are answered for a window that has started closing, and they have to be: the game flushes
 * what it owes from the page's `beforeunload` - the playtime run since the last whole minute, the
 * last lines marked read - and that runs after the window's `close`. Refusing it lost those on every
 * Dev Mode close. The write reaches only the closing window's own project store, which is exactly
 * what the same page could write a moment earlier.
 */
export class BlueprintPersistenceSetValueHandler extends IPCHandler<IPCEventType.blueprintPersistenceSetValue> {
    readonly name = IPCEventType.blueprintPersistenceSetValue;
    readonly type = IPCMessageType.request;
    readonly servesClosingWindow = true;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.blueprintPersistenceSetValue]["data"],
    ): Promise<RequestStatus<void>> {
        try {
            const store = createStore(window, await requireWindowProjectStore(window, data.projectRef));
            if (data.value === undefined) {
                store.removeItem(data.key);
            } else {
                store.setItem(data.key, data.value);
            }
            return this.success();
        } catch (err) {
            return this.failed(err);
        }
    }
}

/** A removal is a write like any other; see {@link BlueprintPersistenceSetValueHandler}. */
export class BlueprintPersistenceRemoveValueHandler extends IPCHandler<IPCEventType.blueprintPersistenceRemoveValue> {
    readonly name = IPCEventType.blueprintPersistenceRemoveValue;
    readonly type = IPCMessageType.request;
    readonly servesClosingWindow = true;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.blueprintPersistenceRemoveValue]["data"],
    ): Promise<RequestStatus<void>> {
        try {
            createStore(window, await requireWindowProjectStore(window, data.projectRef)).removeItem(data.key);
            return this.success();
        } catch (err) {
            return this.failed(err);
        }
    }
}
