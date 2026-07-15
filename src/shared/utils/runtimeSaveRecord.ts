import {
    DEV_MODE_SAVE_TYPE_NORMAL,
    type DevModeSaveRecord,
} from "@shared/types/devModeSave";

/**
 * Persisted shape of one game save. Shared by every runtime shell: the desktop
 * runtime stores it as a JSON file per save, the web runtime as an IndexedDB
 * record — both write and validate exactly this structure.
 */
export type RuntimeSaveFileRecord = DevModeSaveRecord & {
    version: 1;
};

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

/** Validate an untrusted stored value into a save record, or reject it. */
export function parseRuntimeSaveRecord(value: unknown): DevModeSaveRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value as Partial<RuntimeSaveFileRecord>;
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
            user: normalizeRuntimeJsonValue(record.metadata.user),
        },
        savedGame: record.savedGame,
    };
}

/** Build the record for a (re)written save, preserving the original createdAt. */
export function buildRuntimeSaveRecord(input: {
    id: string;
    savedGame: unknown;
    capture?: string;
    metadata?: unknown;
    previous: DevModeSaveRecord | null;
    now: string;
}): RuntimeSaveFileRecord {
    return {
        version: 1,
        metadata: {
            id: input.id,
            type: DEV_MODE_SAVE_TYPE_NORMAL,
            createdAt: input.previous?.metadata.createdAt ?? input.now,
            updatedAt: input.now,
            ...(typeof input.capture === "string" && input.capture ? { capture: input.capture } : {}),
            user: normalizeRuntimeJsonValue(input.metadata),
        },
        savedGame: normalizeRuntimeJsonValue(input.savedGame),
    };
}

/**
 * Clamp an arbitrary value to plain JSON: undefined becomes null, anything
 * that cannot round-trip (functions, cycles) is dropped to null instead of
 * poisoning the store.
 */
export function normalizeRuntimeJsonValue(value: unknown): unknown {
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
