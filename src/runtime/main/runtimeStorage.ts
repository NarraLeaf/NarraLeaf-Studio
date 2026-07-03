import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import {
    DEV_MODE_SAVE_TYPE_NORMAL,
    type DevModeSaveRecord,
} from "@shared/types/devModeSave";

type SaveFileRecord = DevModeSaveRecord & {
    version: 1;
};

const SAVE_FILE_EXTENSION = ".json";

export function normalizeRuntimeSaveId(id: string): string {
    const safe = String(id ?? "").trim();
    if (!safe) {
        throw new Error("Save id is required");
    }
    if (safe === "." || safe === ".." || /[\\/]/.test(safe) || /[\u0000-\u001f\u007f]/.test(safe)) {
        throw new Error("Save id cannot be a path segment");
    }
    return safe;
}

export class RuntimeSaveStore {
    constructor(private readonly userDataDir: string) {}

    public async write(id: string, savedGame: unknown, capture?: string, metadata?: unknown): Promise<void> {
        const normalizedId = normalizeRuntimeSaveId(id);
        const filePath = this.saveFilePath(normalizedId);
        const previous = await this.read(normalizedId);
        const now = new Date().toISOString();
        const record: SaveFileRecord = {
            version: 1,
            metadata: {
                id: normalizedId,
                type: DEV_MODE_SAVE_TYPE_NORMAL,
                createdAt: previous?.metadata.createdAt ?? now,
                updatedAt: now,
                ...(typeof capture === "string" && capture ? { capture } : {}),
                user: normalizeJsonValue(metadata),
            },
            savedGame: normalizeJsonValue(savedGame),
        };
        await atomicWriteJson(filePath, record);
    }

    public async read(id: string): Promise<DevModeSaveRecord | null> {
        const normalizedId = normalizeRuntimeSaveId(id);
        try {
            const raw = await fs.readFile(this.saveFilePath(normalizedId), "utf-8");
            return parseSaveRecord(JSON.parse(raw));
        } catch (error) {
            if (isNodeErrorCode(error, "ENOENT")) {
                return null;
            }
            return null;
        }
    }

    public async listIds(): Promise<string[]> {
        const dir = this.saveDir();
        let names: string[];
        try {
            names = await fs.readdir(dir);
        } catch (error) {
            if (isNodeErrorCode(error, "ENOENT")) {
                return [];
            }
            throw error;
        }
        const ids: string[] = [];
        for (const name of names.filter(item => item.endsWith(SAVE_FILE_EXTENSION))) {
            try {
                const raw = await fs.readFile(path.join(dir, name), "utf-8");
                const record = parseSaveRecord(JSON.parse(raw));
                if (record) {
                    ids.push(record.metadata.id);
                }
            } catch {
                /* Ignore corrupt save files in preview runtime. */
            }
        }
        return ids;
    }

    public async readPreview(id: string): Promise<string | null> {
        const record = await this.read(id);
        return record?.metadata.capture ?? null;
    }

    public async delete(id: string): Promise<{ deleted: boolean }> {
        const normalizedId = normalizeRuntimeSaveId(id);
        try {
            await fs.unlink(this.saveFilePath(normalizedId));
            return { deleted: true };
        } catch (error) {
            if (isNodeErrorCode(error, "ENOENT")) {
                return { deleted: false };
            }
            throw error;
        }
    }

    private saveDir(): string {
        return path.join(this.userDataDir, "saves");
    }

    private saveFilePath(id: string): string {
        const hash = crypto.createHash("sha256").update(id).digest("hex");
        return path.join(this.saveDir(), `${hash}${SAVE_FILE_EXTENSION}`);
    }
}

export class RuntimePersistenceStore {
    constructor(private readonly userDataDir: string) {}

    public async getAll(): Promise<Record<string, unknown>> {
        return this.readStore();
    }

    public async getValue(key: string): Promise<unknown> {
        return (await this.readStore())[key];
    }

    public async setValue(key: string, value: unknown): Promise<void> {
        const store = await this.readStore();
        if (value === undefined) {
            delete store[key];
        } else {
            store[key] = normalizeJsonValue(value);
        }
        await atomicWriteJson(this.storePath(), store);
    }

    public async removeValue(key: string): Promise<void> {
        const store = await this.readStore();
        delete store[key];
        await atomicWriteJson(this.storePath(), store);
    }

    private async readStore(): Promise<Record<string, unknown>> {
        try {
            const raw = await fs.readFile(this.storePath(), "utf-8");
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? parsed as Record<string, unknown>
                : {};
        } catch (error) {
            if (isNodeErrorCode(error, "ENOENT")) {
                return {};
            }
            throw error;
        }
    }

    private storePath(): string {
        return path.join(this.userDataDir, "persistence.json");
    }
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(value), "utf-8");
    await fs.rename(tempPath, filePath);
}

function parseSaveRecord(value: unknown): DevModeSaveRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value as Partial<SaveFileRecord>;
    if (record.version !== 1 || !record.metadata || typeof record.metadata.id !== "string") {
        return null;
    }
    if (record.metadata.type !== DEV_MODE_SAVE_TYPE_NORMAL) {
        return null;
    }
    return {
        metadata: {
            id: normalizeRuntimeSaveId(record.metadata.id),
            type: DEV_MODE_SAVE_TYPE_NORMAL,
            createdAt: typeof record.metadata.createdAt === "string" ? record.metadata.createdAt : "",
            updatedAt: typeof record.metadata.updatedAt === "string" ? record.metadata.updatedAt : "",
            ...(typeof record.metadata.capture === "string" && record.metadata.capture ? { capture: record.metadata.capture } : {}),
            user: normalizeJsonValue(record.metadata.user),
        },
        savedGame: record.savedGame,
    };
}

function normalizeJsonValue(value: unknown): unknown {
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

function isNodeErrorCode(error: unknown, code: string): boolean {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
