import crypto from "crypto";
import path from "path";
import { UserDataNamespace } from "@shared/types/constants";
import { IPCMessageType } from "@shared/types/ipc";
import {
    BlueprintPersistenceProjectRef,
    IPCEvents,
    IPCEventType,
    RequestStatus,
} from "@shared/types/ipcEvents";
import type { PersistentState } from "@shared/utils/persistentState";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

type BlueprintPersistentValueStore = Record<string, unknown>;

function projectNamespaceSource(projectRef: BlueprintPersistenceProjectRef): string {
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

function projectStoreName(projectRef: BlueprintPersistenceProjectRef): string {
    const source = projectNamespaceSource(projectRef);
    const hash = crypto.createHash("sha256").update(source).digest("hex").slice(0, 32);
    return `project-${hash}`;
}

function createStore(window: AppWindow, projectRef: BlueprintPersistenceProjectRef): PersistentState<BlueprintPersistentValueStore> {
    return window.app.storageManager.createState<BlueprintPersistentValueStore>(
        UserDataNamespace.BlueprintPersistence,
        projectStoreName(projectRef),
        {},
    );
}

export class BlueprintPersistenceGetAllHandler extends IPCHandler<IPCEventType.blueprintPersistenceGetAll> {
    readonly name = IPCEventType.blueprintPersistenceGetAll;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.blueprintPersistenceGetAll]["data"],
    ): RequestStatus<{ values: Record<string, unknown> }> {
        try {
            return this.success({ values: { ...createStore(window, data.projectRef).raw() } });
        } catch (err) {
            return this.failed(err);
        }
    }
}

export class BlueprintPersistenceGetValueHandler extends IPCHandler<IPCEventType.blueprintPersistenceGetValue> {
    readonly name = IPCEventType.blueprintPersistenceGetValue;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.blueprintPersistenceGetValue]["data"],
    ): RequestStatus<{ value: unknown }> {
        try {
            const value = createStore(window, data.projectRef).getItem(data.key);
            return this.success({ value });
        } catch (err) {
            return this.failed(err);
        }
    }
}

export class BlueprintPersistenceSetValueHandler extends IPCHandler<IPCEventType.blueprintPersistenceSetValue> {
    readonly name = IPCEventType.blueprintPersistenceSetValue;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.blueprintPersistenceSetValue]["data"],
    ): RequestStatus<void> {
        try {
            const store = createStore(window, data.projectRef);
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

export class BlueprintPersistenceRemoveValueHandler extends IPCHandler<IPCEventType.blueprintPersistenceRemoveValue> {
    readonly name = IPCEventType.blueprintPersistenceRemoveValue;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.blueprintPersistenceRemoveValue]["data"],
    ): RequestStatus<void> {
        try {
            createStore(window, data.projectRef).removeItem(data.key);
            return this.success();
        } catch (err) {
            return this.failed(err);
        }
    }
}
