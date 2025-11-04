import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * Handler for getting a project setting value
 */
export class ProjectSettingsGetHandler extends IPCHandler<IPCEventType.projectSettingsGet> {
    readonly name = IPCEventType.projectSettingsGet;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, key }: IPCEvents[IPCEventType.projectSettingsGet]["data"]
    ): Promise<RequestStatus<{ value: any }>> {
        try {
            const value = await window.getApp().storageManager.projectSettings.get(projectPath, key);
            return this.success({ value });
        } catch (error) {
            return this.failed(`Failed to get project setting: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

/**
 * Handler for setting a project setting value
 */
export class ProjectSettingsSetHandler extends IPCHandler<IPCEventType.projectSettingsSet> {
    readonly name = IPCEventType.projectSettingsSet;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, key, value }: IPCEvents[IPCEventType.projectSettingsSet]["data"]
    ): Promise<RequestStatus<void>> {
        try {
            await window.getApp().storageManager.projectSettings.set(projectPath, key, value);
            return this.success(void 0);
        } catch (error) {
            return this.failed(`Failed to set project setting: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

/**
 * Handler for getting all project settings
 */
export class ProjectSettingsGetAllHandler extends IPCHandler<IPCEventType.projectSettingsGetAll> {
    readonly name = IPCEventType.projectSettingsGetAll;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.projectSettingsGetAll]["data"]
    ): Promise<RequestStatus<{ settings: Record<string, any> }>> {
        try {
            const settings = await window.getApp().storageManager.projectSettings.getAll(projectPath);
            return this.success({ settings });
        } catch (error) {
            return this.failed(`Failed to get all project settings: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

/**
 * Handler for clearing all project settings
 */
export class ProjectSettingsClearHandler extends IPCHandler<IPCEventType.projectSettingsClear> {
    readonly name = IPCEventType.projectSettingsClear;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.projectSettingsClear]["data"]
    ): Promise<RequestStatus<void>> {
        try {
            await window.getApp().storageManager.projectSettings.clear(projectPath);
            return this.success(void 0);
        } catch (error) {
            return this.failed(`Failed to clear project settings: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

