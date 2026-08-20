import { LAYER_FILE_EXTENSION } from "@narraleaf/encryption";
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

/**
 * Produce a patch for a build of this project.
 *
 * Answers with the same snapshot a build answers with, from the same session, so
 * the dialog that started it watches it the way it watches a build - and the two
 * cannot be started at once, which is right: they compile the same project into
 * the same place.
 */
export class GameBuildExportPatchHandler extends IPCHandler<IPCEventType.gameBuildExportPatch> {
    readonly name = IPCEventType.gameBuildExportPatch;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, entry, request }: IPCEvents[IPCEventType.gameBuildExportPatch]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.gameBuildExportPatch]["response"]>> {
        return this.tryUse(async () => ({
            state: window.app.getGameBuildManager().exportPatch(projectPath, entry, request),
        }));
    }
}

export class GameBuildSelectPatchFileHandler extends IPCHandler<IPCEventType.gameBuildSelectPatchFile> {
    readonly name = IPCEventType.gameBuildSelectPatchFile;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { defaultPath }: IPCEvents[IPCEventType.gameBuildSelectPatchFile]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.gameBuildSelectPatchFile]["response"]>> {
        return this.tryUse(async () => {
            const result = await dialog.showSaveDialog(window.win, {
                title: "Save patch",
                buttonLabel: "Save patch",
                // The suffix is two extensions deep on purpose, so the filter has
                // to match the whole tail rather than the generic one.
                filters: [{ name: "Patch", extensions: [LAYER_FILE_EXTENSION.replace(/^\./, "")] }],
                ...(defaultPath ? { defaultPath } : {}),
            });
            if (result.canceled || !result.filePath) {
                return { path: null };
            }
            return { path: result.filePath };
        });
    }
}

/**
 * Pick the build a patch is measured against.
 *
 * A folder, and the one the author already has: the desktop output the packager
 * wrote. Where the payload sits inside it differs per platform, and finding it is
 * this tool's job rather than the author's - see `resolvePayloadLocation`.
 */
export class GameBuildSelectPatchBaselineHandler extends IPCHandler<IPCEventType.gameBuildSelectPatchBaseline> {
    readonly name = IPCEventType.gameBuildSelectPatchBaseline;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { defaultPath }: IPCEvents[IPCEventType.gameBuildSelectPatchBaseline]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.gameBuildSelectPatchBaseline]["response"]>> {
        return this.tryUse(async () => {
            const result = await dialog.showOpenDialog(window.win, {
                title: "Select the build this patch is for",
                buttonLabel: "Select folder",
                properties: ["openDirectory"],
                ...(defaultPath ? { defaultPath } : {}),
            });
            if (result.canceled || result.filePaths.length === 0) {
                return { path: null };
            }
            return { path: result.filePaths[0] };
        });
    }
}
