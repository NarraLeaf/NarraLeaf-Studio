/**
 * Asset Lock Manager
 * Manages locks on assets to prevent deletion of assets that are in use by services
 */

export enum AssetLockReason {
    UsedByCharacter = "character",
    UsedByScene = "scene",
    UsedByEditor = "editor",
}

// Hardcoded lock reason texts
const LOCK_REASON_TEXTS: Record<AssetLockReason, string> = {
    [AssetLockReason.UsedByCharacter]: "Asset is used by a character",
    [AssetLockReason.UsedByScene]: "Asset is used by a scene",
    [AssetLockReason.UsedByEditor]: "Asset is used by the Editor",
};

export interface AssetLock {
    assetId: string;
    reason: AssetLockReason;
    /** Optional metadata about the lock (e.g., character ID, scene ID) */
    metadata?: Record<string, any>;
}

export class AssetLockManager {
    // Map: assetId -> Set of locks on that asset
    private locks: Map<string, Set<AssetLock>> = new Map();

    /**
     * Lock an asset with a specific reason
     */
    public lock(assetId: string, reason: AssetLockReason, metadata?: Record<string, any>): void {
        if (!this.locks.has(assetId)) {
            this.locks.set(assetId, new Set());
        }
        
        const lock: AssetLock = {
            assetId,
            reason,
            metadata,
        };
        
        this.locks.get(assetId)!.add(lock);
    }

    /**
     * Unlock an asset for a specific reason
     */
    public unlock(assetId: string, reason: AssetLockReason, metadata?: Record<string, any>): void {
        const lockSet = this.locks.get(assetId);
        if (!lockSet) return;

        // Find and remove the lock with matching reason and metadata
        for (const lock of lockSet) {
            if (lock.reason === reason) {
                // If metadata is provided, check if it matches
                if (metadata) {
                    const metadataMatches = Object.entries(metadata).every(
                        ([key, value]) => lock.metadata?.[key] === value
                    );
                    if (!metadataMatches) continue;
                }
                lockSet.delete(lock);
                break;
            }
        }

        // Clean up empty sets
        if (lockSet.size === 0) {
            this.locks.delete(assetId);
        }
    }

    /**
     * Unlock all locks on an asset
     */
    public unlockAll(assetId: string): void {
        this.locks.delete(assetId);
    }

    /**
     * Check if an asset is locked
     */
    public isLocked(assetId: string): boolean {
        const lockSet = this.locks.get(assetId);
        return lockSet !== undefined && lockSet.size > 0;
    }

    /**
     * Get all locks on an asset
     */
    public getLocks(assetId: string): AssetLock[] {
        const lockSet = this.locks.get(assetId);
        return lockSet ? Array.from(lockSet) : [];
    }

    /**
     * Get human-readable lock reasons for an asset
     */
    public getLockReasons(assetId: string): string[] {
        const locks = this.getLocks(assetId);
        const reasons = new Set<string>();
        
        for (const lock of locks) {
            const text = LOCK_REASON_TEXTS[lock.reason];
            reasons.add(text);
        }
        
        return Array.from(reasons);
    }

    /**
     * Get a formatted message describing all locks on an asset
     */
    public getLockMessage(assetId: string): string | null {
        if (!this.isLocked(assetId)) {
            return null;
        }

        const reasons = this.getLockReasons(assetId);
        return reasons.join("\n");
    }

    /**
     * Check if an asset has a specific lock reason
     */
    public hasLockReason(assetId: string, reason: AssetLockReason): boolean {
        const lockSet = this.locks.get(assetId);
        if (!lockSet) return false;

        for (const lock of lockSet) {
            if (lock.reason === reason) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get all locked asset IDs
     */
    public getLockedAssets(): string[] {
        return Array.from(this.locks.keys());
    }

    /**
     * Clear all locks (useful for testing or reset)
     */
    public clearAll(): void {
        this.locks.clear();
    }
}

