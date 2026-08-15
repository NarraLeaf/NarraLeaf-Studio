/**
 * The Export/Import Progress nodes' requests, for a Dev Mode preview.
 *
 * Dev Mode has to behave like the packaged game, or an author tests something the player will not
 * get. So the act happens here, in the process that owns the filesystem, and it lands on the very
 * same file the shipped build would use: one document per title under `NarraLeaf/progress/`, named
 * by the key the build carries in its pack.
 *
 * The renderer sends what the playthrough holds and never which file. The key is derived here, from
 * the project's own identity, by the same function the pack compiler calls - a key passed in by the
 * caller would make this channel a way to write into another title's document rather than a way to
 * honour the one this project owns.
 *
 * A project with no readable config has no identity to derive a key from, and the request fails
 * saying so. That is the same refusal the packaged shell makes for a pack with no `progressKey`,
 * and it is deliberately not a fallback: a guessed key would write a document the real build would
 * never look at, which is worse than a failure branch the author can see.
 *
 * Comments in English per project convention.
 */

import os from "os";
import { app } from "electron";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { gameProgressKey } from "@shared/types/gameProgress";
import type {
    GameProgressExportRequest,
    GameProgressExportResult,
    GameProgressImportResult,
} from "@shared/types/gameProgress";
import type { AppTagBaseIdentity } from "@shared/types/appTag";
import {
    readGameProgressFile,
    writeGameProgressFile,
    type GameProgressEnvironment,
} from "@shared/utils/gameProgressFile";
import path from "path";
import { readProjectConfigFromDir } from "../../../utils/projectConfigFile";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

export class BlueprintProgressWriteHandler extends IPCHandler<IPCEventType.blueprintProgressWrite> {
    readonly name = IPCEventType.blueprintProgressWrite;
    readonly type = IPCMessageType.request;

    public async handle(
        _window: AppWindow,
        data: IPCEvents[IPCEventType.blueprintProgressWrite]["data"],
    ): Promise<RequestStatus<{ result: GameProgressExportResult }>> {
        try {
            return this.success({ result: await writeProjectProgress(data.projectPath, data.request) });
        } catch (err) {
            return this.failed(err);
        }
    }
}

export class BlueprintProgressReadHandler extends IPCHandler<IPCEventType.blueprintProgressRead> {
    readonly name = IPCEventType.blueprintProgressRead;
    readonly type = IPCMessageType.request;

    public async handle(
        _window: AppWindow,
        data: IPCEvents[IPCEventType.blueprintProgressRead]["data"],
    ): Promise<RequestStatus<{ result: GameProgressImportResult }>> {
        try {
            return this.success({ result: await readProjectProgress(data.projectPath) });
        } catch (err) {
            return this.failed(err);
        }
    }
}

/**
 * Where the player's own files live on this machine, in the terms the shared resolver takes.
 *
 * Studio's own `app.getPath("appData")` is the right root here even though this is Studio and not
 * the game: the directory is per-user, not per-application, and a preview must reach the exact
 * folder the packaged game will.
 */
function environment(): GameProgressEnvironment {
    return {
        platform: process.platform,
        appDataDir: app.getPath("appData"),
        homeDir: os.homedir(),
        ...(process.env.XDG_DATA_HOME ? { xdgDataHome: process.env.XDG_DATA_HOME } : {}),
    };
}

/**
 * The key this project's builds carry.
 *
 * Read off disk on every request rather than cached, for the reason the declared-links handler
 * re-reads its document: an author who changes the project's identifier mid-session must see the
 * preview follow, and a cached key would quietly keep writing the old file.
 *
 * A preview is always the release edition, and the key is the release edition's by construction -
 * so there is no variant to resolve here, and nothing a tag could change.
 */
async function resolveProjectProgressKey(projectPath: string): Promise<string> {
    const config = await readProjectConfigFromDir(projectPath);
    const base: AppTagBaseIdentity = {
        displayName: config?.name?.trim() || path.basename(projectPath) || "",
        identifier: config?.identifier?.trim() ?? "",
        version: typeof config?.metadata?.version === "string" ? config.metadata.version.trim() : "",
    };
    return gameProgressKey(base);
}

async function writeProjectProgress(
    projectPath: string,
    request: GameProgressExportRequest,
): Promise<GameProgressExportResult> {
    let key: string;
    try {
        key = await resolveProjectProgressKey(projectPath);
    } catch (error) {
        return {
            outcome: "failed",
            error: `Could not read the project's identity: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    return writeGameProgressFile(environment(), key, request);
}

async function readProjectProgress(projectPath: string): Promise<GameProgressImportResult> {
    let key: string;
    try {
        key = await resolveProjectProgressKey(projectPath);
    } catch (error) {
        return {
            outcome: "failed",
            document: null,
            error: `Could not read the project's identity: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
    return readGameProgressFile(environment(), key);
}
