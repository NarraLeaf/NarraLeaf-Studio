import { dialog } from "electron";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class GameBuildStartHandler extends IPCHandler<IPCEventType.gameBuildStart> {
    readonly name = IPCEventType.gameBuildStart;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        { projectPath, entry, request }: IPCEvents[IPCEventType.gameBuildStart]["data"],
    ): RequestStatus<IPCEvents[IPCEventType.gameBuildStart]["response"]> {
        const state = window.getApp().getGameBuildManager().start(projectPath, entry, request);
        return this.success({ state });
    }
}

export class GameBuildCancelHandler extends IPCHandler<IPCEventType.gameBuildCancel> {
    readonly name = IPCEventType.gameBuildCancel;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.gameBuildCancel]["data"],
    ): RequestStatus<IPCEvents[IPCEventType.gameBuildCancel]["response"]> {
        const state = window.getApp().getGameBuildManager().cancel(projectPath);
        return this.success({ state });
    }
}

export class GameBuildGetStatusHandler extends IPCHandler<IPCEventType.gameBuildGetStatus> {
    readonly name = IPCEventType.gameBuildGetStatus;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.gameBuildGetStatus]["data"],
    ): RequestStatus<IPCEvents[IPCEventType.gameBuildGetStatus]["response"]> {
        const state = window.getApp().getGameBuildManager().getStatus(projectPath);
        return this.success({ state });
    }
}

export class GameBuildPreflightHandler extends IPCHandler<IPCEventType.gameBuildPreflight> {
    readonly name = IPCEventType.gameBuildPreflight;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, request }: IPCEvents[IPCEventType.gameBuildPreflight]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.gameBuildPreflight]["response"]>> {
        return this.tryUse(async () => ({
            findings: await window.getApp().getGameBuildManager().preflight(projectPath, request),
        }));
    }
}

export class GameBuildSelectOutputDirHandler extends IPCHandler<IPCEventType.gameBuildSelectOutputDir> {
    readonly name = IPCEventType.gameBuildSelectOutputDir;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { defaultPath }: IPCEvents[IPCEventType.gameBuildSelectOutputDir]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.gameBuildSelectOutputDir]["response"]>> {
        return this.tryUse(async () => {
            const result = await dialog.showOpenDialog(window.win, {
                title: "Select build output folder",
                buttonLabel: "Select folder",
                properties: ["openDirectory", "createDirectory"],
                ...(defaultPath ? { defaultPath } : {}),
            });
            if (result.canceled || result.filePaths.length === 0) {
                return { path: null };
            }
            return { path: result.filePaths[0] };
        });
    }
}
