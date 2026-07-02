import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { UserDataNamespace } from "@shared/types/constants";
import {
    DEV_MODE_SAVE_TYPE_NORMAL,
    type DevModeSaveMetadata,
    type DevModeSaveProjectRef,
    type DevModeSaveRecord,
} from "@shared/types/devModeSave";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

type DevModeSaveFileRecord = DevModeSaveRecord & {
    version: 1;
};

const SAVE_FILE_EXTENSION = ".dat";

function projectNamespaceSource(projectRef: DevModeSaveProjectRef): string {
    const identifier = projectRef.projectIdentifier?.trim();
    if (identifier) {
        return `id:${identifier}`;
    }
    const projectPath = projectRef.projectPath?.trim();
    if (!projectPath) {
        throw new Error("Dev Mode saves require a project identifier or project path");
    }
    return `path:${path.resolve(projectPath)}`;
}

function projectDirectoryName(projectRef: DevModeSaveProjectRef): string {
    const hash = crypto.createHash("sha256").update(projectNamespaceSource(projectRef)).digest("hex").slice(0, 32);
    return `project-${hash}`;
}

function saveFileName(id: string): string {
    const hash = crypto.createHash("sha256").update(id).digest("hex");
    return `${hash}${SAVE_FILE_EXTENSION}`;
}

export function normalizeDevModeSaveId(id: string): string {
    const safe = String(id ?? "").trim();
    if (!safe) {
        throw new Error("Save id is required");
    }
    if (safe === "." || safe === "..") {
        throw new Error("Save id cannot be a path segment");
    }
    if (/[\\/]/.test(safe) || /[\u0000-\u001f\u007f]/.test(safe)) {
        throw new Error("Save id cannot contain path separators or control characters");
    }
    return safe;
}

function saveDirectory(window: AppWindow, projectRef: DevModeSaveProjectRef): string {
    return path.join(
        window.app.storageManager.getNamespacePath(UserDataNamespace.DevModeSaves),
        projectDirectoryName(projectRef),
    );
}

function saveFilePath(window: AppWindow, projectRef: DevModeSaveProjectRef, id: string): string {
    return path.join(saveDirectory(window, projectRef), saveFileName(id));
}

function isSaveFile(name: string): boolean {
    return name.endsWith(SAVE_FILE_EXTENSION);
}

function normalizeUserMetadata(value: unknown): unknown {
    if (value === undefined) {
        return null;
    }
    try {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? null : JSON.parse(serialized);
    } catch {
        return null;
    }
}

function readRecordShape(value: unknown): DevModeSaveFileRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value as Partial<DevModeSaveFileRecord>;
    const metadata = record.metadata as Partial<DevModeSaveMetadata> | undefined;
    if (record.version !== 1 || !metadata || typeof metadata.id !== "string") {
        return null;
    }
    let id: string;
    try {
        id = normalizeDevModeSaveId(metadata.id);
    } catch {
        return null;
    }
    if (metadata.type !== DEV_MODE_SAVE_TYPE_NORMAL) {
        return null;
    }
    if (typeof metadata.createdAt !== "string" || typeof metadata.updatedAt !== "string") {
        return null;
    }
    return {
        version: 1,
        metadata: {
            id,
            type: DEV_MODE_SAVE_TYPE_NORMAL,
            createdAt: metadata.createdAt,
            updatedAt: metadata.updatedAt,
            ...(typeof metadata.capture === "string" && metadata.capture ? { capture: metadata.capture } : {}),
            user: normalizeUserMetadata(metadata.user),
        },
        savedGame: record.savedGame,
    };
}

async function readSaveRecord(filePath: string): Promise<DevModeSaveFileRecord | null> {
    try {
        const raw = await fs.readFile(filePath, "utf-8");
        return readRecordShape(JSON.parse(raw));
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            return null;
        }
        return null;
    }
}

async function writeSaveRecord(filePath: string, record: DevModeSaveFileRecord): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(record), "utf-8");
    await fs.rename(tempPath, filePath);
}

export class DevModeSaveWriteHandler extends IPCHandler<IPCEventType.devModeSaveWrite> {
    readonly name = IPCEventType.devModeSaveWrite;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.devModeSaveWrite]["data"],
    ): Promise<RequestStatus<void>> {
        return this.tryUse(async () => {
            const id = normalizeDevModeSaveId(data.id);
            const filePath = saveFilePath(window, data.projectRef, id);
            const previous = await readSaveRecord(filePath);
            const now = new Date().toISOString();
            const record: DevModeSaveFileRecord = {
                version: 1,
                metadata: {
                    id,
                    type: DEV_MODE_SAVE_TYPE_NORMAL,
                    createdAt: previous?.metadata.createdAt ?? now,
                    updatedAt: now,
                    ...(typeof data.capture === "string" && data.capture ? { capture: data.capture } : {}),
                    user: normalizeUserMetadata(data.metadata),
                },
                savedGame: data.savedGame,
            };
            await writeSaveRecord(filePath, record);
        });
    }
}

export class DevModeSaveReadHandler extends IPCHandler<IPCEventType.devModeSaveRead> {
    readonly name = IPCEventType.devModeSaveRead;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.devModeSaveRead]["data"],
    ): Promise<RequestStatus<{ record: DevModeSaveRecord | null }>> {
        return this.tryUse(async () => {
            const id = normalizeDevModeSaveId(data.id);
            const record = await readSaveRecord(saveFilePath(window, data.projectRef, id));
            return { record };
        });
    }
}

export class DevModeSaveListIdsHandler extends IPCHandler<IPCEventType.devModeSaveListIds> {
    readonly name = IPCEventType.devModeSaveListIds;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.devModeSaveListIds]["data"],
    ): Promise<RequestStatus<{ ids: string[] }>> {
        return this.tryUse(async () => {
            const dir = saveDirectory(window, data.projectRef);
            let names: string[];
            try {
                names = await fs.readdir(dir);
            } catch (error) {
                if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
                    return { ids: [] };
                }
                throw error;
            }
            const ids: string[] = [];
            for (const name of names.filter(isSaveFile)) {
                const record = await readSaveRecord(path.join(dir, name));
                if (record?.metadata.type === DEV_MODE_SAVE_TYPE_NORMAL) {
                    ids.push(record.metadata.id);
                }
            }
            return { ids };
        });
    }
}

export class DevModeSaveReadPreviewHandler extends IPCHandler<IPCEventType.devModeSaveReadPreview> {
    readonly name = IPCEventType.devModeSaveReadPreview;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.devModeSaveReadPreview]["data"],
    ): Promise<RequestStatus<{ capture: string | null }>> {
        return this.tryUse(async () => {
            const id = normalizeDevModeSaveId(data.id);
            const record = await readSaveRecord(saveFilePath(window, data.projectRef, id));
            return { capture: record?.metadata.capture ?? null };
        });
    }
}

export class DevModeSaveDeleteHandler extends IPCHandler<IPCEventType.devModeSaveDelete> {
    readonly name = IPCEventType.devModeSaveDelete;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        data: IPCEvents[IPCEventType.devModeSaveDelete]["data"],
    ): Promise<RequestStatus<{ deleted: boolean }>> {
        return this.tryUse(async () => {
            const id = normalizeDevModeSaveId(data.id);
            const filePath = saveFilePath(window, data.projectRef, id);
            try {
                await fs.unlink(filePath);
                return { deleted: true };
            } catch (error) {
                if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
                    return { deleted: false };
                }
                throw error;
            }
        });
    }
}
