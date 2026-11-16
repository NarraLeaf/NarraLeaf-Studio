import { describe, expect, it } from "vitest";

import { assetLockState, readAssetLocks } from "./teamAssetLock";

const lock = { project: "p", asset: "a1", holder: "bob", at: 0, expiresAt: 1_000 };

describe("asset locks", () => {
    it("reads what the server lists and leaves out what is not a lock", () => {
        expect(readAssetLocks({ locks: [lock, { asset: "a2" }, null] })).toEqual([lock]);
        expect(readAssetLocks({ locks: [{ ...lock, note: "re-cutting" }] })[0]?.note).toBe("re-cutting");
        expect(readAssetLocks(null)).toEqual([]);
    });

    it("says whose an asset is", () => {
        expect(assetLockState([lock], "a1", "alice", 500)).toEqual({ kind: "theirs", lock });
        expect(assetLockState([lock], "a1", "bob", 500)).toEqual({ kind: "mine", lock });
        expect(assetLockState([lock], "a2", "alice", 500)).toEqual({ kind: "free" });
    });

    it("treats a lock past its time as gone", () => {
        expect(assetLockState([lock], "a1", "alice", 1_000)).toEqual({ kind: "free" });
    });
});
