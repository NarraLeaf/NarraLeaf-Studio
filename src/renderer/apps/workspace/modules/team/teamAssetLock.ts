import type { TeamAssetLock } from "@shared/types/team";

/** One lock as `assets.locks` answers it, or null because what arrived was not one. */
export function readAssetLock(value: unknown): TeamAssetLock | null {
    if (typeof value !== "object" || value === null) return null;
    const from = value as Record<string, unknown>;
    const { project, asset, holder, at, expiresAt, note } = from;
    if (typeof project !== "string" || typeof asset !== "string" || typeof holder !== "string") return null;
    if (typeof at !== "number" || typeof expiresAt !== "number") return null;
    return { project, asset, holder, at, expiresAt, ...(typeof note === "string" ? { note } : {}) };
}

/** The locks in an `assets.locks` answer; anything that is not one is left out. */
export function readAssetLocks(value: unknown): TeamAssetLock[] {
    const list = typeof value === "object" && value !== null ? (value as { locks?: unknown }).locks : undefined;
    if (!Array.isArray(list)) return [];
    return list.map(readAssetLock).filter((lock): lock is TeamAssetLock => lock !== null);
}

export type AssetLockState =
    | { kind: "free" }
    | { kind: "mine"; lock: TeamAssetLock }
    | { kind: "theirs"; lock: TeamAssetLock };

/**
 * Who holds one asset right now. A lock past its time is no lock: the server stops refusing at
 * `expiresAt`, whether or not anybody has told this window it was let go.
 */
export function assetLockState(
    locks: readonly TeamAssetLock[],
    assetId: string,
    me: string | undefined,
    now: number,
): AssetLockState {
    const lock = locks.find(entry => entry.asset === assetId && entry.expiresAt > now);
    if (lock === undefined) return { kind: "free" };
    return lock.holder === me ? { kind: "mine", lock } : { kind: "theirs", lock };
}
