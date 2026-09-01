import path from "path";
import { OVERLAY_FILE_EXTENSION } from "@narraleaf/bindings";
import { GameBuildErrorCode } from "@shared/types/gameBuild";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { openPayload } from "../../build/patchPayload";
import { dialogTranslator, showOpenDialog, showSaveDialog } from "../fileDialog";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * A baseline the window holds no grant for, named so the interface can say so in its own words.
 *
 * The refusal has to be told apart from the folder holding no build: they are different facts with
 * different remedies, and sharing one message would tell an author looking at their own build that
 * it is not there. The sentence stays English for a log; the `code` is what the dialog reads.
 */
class BaselineNotGrantedError extends Error {
    readonly code = GameBuildErrorCode.BaselineNotGranted;

    constructor(resolved: string) {
        super(`File system access is not allowed for patch baseline: ${resolved}`);
    }
}

/**
 * The build folder a patch is measured against, as a path this window is allowed to read.
 *
 * A baseline is deliberately not part of the project - it is a shipped build of it, sitting wherever
 * the author keeps their releases - so there is nothing project-shaped to check it against. What
 * makes one legitimate is that this window's author picked it, and a grant is the record of exactly
 * that. So the picker mints one on the way out and everything that reads a baseline asks here,
 * which is the same two-sided arrangement the project package pair uses.
 *
 * The tree rather than the path, because reading a payload means reading files *under* the folder -
 * `pack.json`, `resources/app.asar`, every asset. A grant covering the folder alone would answer
 * `isPathAllowed` yes while covering none of what is about to be read.
 *
 * That it is asked at all is decided by where an unchecked path ends up. A payload that looks sealed
 * is opened by loading `bindings.node` from inside it, and loading a `.node` is `dlopen`: a renderer
 * that can name any folder can run native code of its choosing in the main process, which is not a
 * boundary a read check is merely tidy about.
 */
async function readableBaselineDir(window: AppWindow, target: string): Promise<string> {
    const resolved = path.resolve(target);
    if (!await window.app.storageManager.isPathTreeAllowed(window, resolved, "read")) {
        throw new BaselineNotGrantedError(resolved);
    }
    return resolved;
}

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
            const { t } = dialogTranslator(window);
            const result = await showOpenDialog(window, {
                title: t("dialogs.file.title.selectBuildOutput"),
                buttonLabel: t("dialogs.file.button.select"),
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
 *
 * The baseline it may name is checked here rather than in the pipeline, and checked the same way
 * the reader above checks its own. An export opens that folder with the very same reader, so the
 * two are one hole with two entrances: guarding only the one the dialog polls while it is being
 * typed into would leave the other reachable by the request that actually presses the button.
 */
export class GameBuildExportPatchHandler extends IPCHandler<IPCEventType.gameBuildExportPatch> {
    readonly name = IPCEventType.gameBuildExportPatch;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath, entry, request }: IPCEvents[IPCEventType.gameBuildExportPatch]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.gameBuildExportPatch]["response"]>> {
        return this.tryUse(async () => ({
            state: window.app.getGameBuildManager().exportPatch(projectPath, entry, {
                ...request,
                ...(request.baselineAppDir
                    ? { baselineAppDir: await readableBaselineDir(window, request.baselineAppDir) }
                    : {}),
            }),
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
            const { t } = dialogTranslator(window);
            const result = await showSaveDialog(window, {
                title: t("dialogs.file.title.savePatch"),
                buttonLabel: t("dialogs.file.button.save"),
                // The suffix is two extensions deep on purpose, so the filter has
                // to match the whole tail rather than the generic one.
                filters: [{ name: t("dialogs.file.filter.patch"), extensions: [OVERLAY_FILE_EXTENSION.replace(/^\./, "")] }],
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
 *
 * Picking is also what authorises the folder. Everything that goes on to read a baseline checks the
 * window's grants ({@link readableBaselineDir}), and this is the one place a baseline can acquire
 * one - so a path that arrives from anywhere other than an author's own picking is a path nothing
 * downstream will open. Read, recursively, for the session: a baseline is read whole and never
 * written, and it outlives the dialog that named it because the export reads it again later.
 */
export class GameBuildSelectPatchBaselineHandler extends IPCHandler<IPCEventType.gameBuildSelectPatchBaseline> {
    readonly name = IPCEventType.gameBuildSelectPatchBaseline;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { defaultPath }: IPCEvents[IPCEventType.gameBuildSelectPatchBaseline]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.gameBuildSelectPatchBaseline]["response"]>> {
        return this.tryUse(async () => {
            const { t } = dialogTranslator(window);
            const result = await showOpenDialog(window, {
                title: t("dialogs.file.title.selectPatchBaseline"),
                buttonLabel: t("dialogs.file.button.select"),
                properties: ["openDirectory"],
                securityScopedBookmarks: true,
                ...(defaultPath ? { defaultPath } : {}),
            });
            if (result.canceled || result.filePaths.length === 0) {
                return { path: null };
            }
            const selected = path.resolve(result.filePaths[0]);
            window.app.storageManager.grantFileSystemAccess(
                window,
                selected,
                "read",
                true,
                result.bookmarks?.[0],
                "session",
            );
            return { path: selected };
        });
    }
}
/**
 * What a build folder says about itself, read through the same reader the export reads it with.
 *
 * The same reader on purpose: a folder this answers for is a folder the export can measure against,
 * and a folder it refuses is one the export would refuse later with the author already committed.
 */
export class GameBuildReadPatchBaselineHandler extends IPCHandler<IPCEventType.gameBuildReadPatchBaseline> {
    readonly name = IPCEventType.gameBuildReadPatchBaseline;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { path: target }: IPCEvents[IPCEventType.gameBuildReadPatchBaseline]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.gameBuildReadPatchBaseline]["response"]>> {
        return this.tryUse(async () => {
            const payload = await openPayload(await readableBaselineDir(window, target));
            try {
                const pack = payload.pack;
                return {
                    appTagId: pack.addOns?.appTagId?.trim() || null,
                    productName: pack.project?.name?.trim() || null,
                    version: pack.project?.version?.trim() || null,
                    builtAt: pack.generatedAt || null,
                };
            } finally {
                await payload.close().catch(() => undefined);
            }
        });
    }
}

/**
 * What this project's last run came to, and the folder it wrote into.
 *
 * Both answered by the pipeline rather than by whichever window is asking: the record outlives the
 * session that made it, and the folder the reveal opens is one a build of this project chose.
 */
export class GameBuildReadLastRunHandler extends IPCHandler<IPCEventType.gameBuildReadLastRun> {
    readonly name = IPCEventType.gameBuildReadLastRun;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.gameBuildReadLastRun]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.gameBuildReadLastRun]["response"]>> {
        return this.tryUse(async () => ({
            run: await window.getApp().getGameBuildManager().readLastRun(projectPath),
        }));
    }
}

export class GameBuildRevealOutputHandler extends IPCHandler<IPCEventType.gameBuildRevealOutput> {
    readonly name = IPCEventType.gameBuildRevealOutput;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { projectPath }: IPCEvents[IPCEventType.gameBuildRevealOutput]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.gameBuildRevealOutput]["response"]>> {
        return this.tryUse(async () => ({
            revealed: await window.getApp().getGameBuildManager().revealLastOutput(projectPath),
        }));
    }
}
