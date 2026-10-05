import { describe, expect, it } from "vitest";
import { thinMachOArch } from "../fatMachO";
import type { BundleTree } from "../macBundle/bundleTree";
import { syntheticMachO } from "../macBundle/macBundleFixtures";
import { mergeUniversalBundle } from "./universal";

function halves(): { x64: BundleTree; arm64: BundleTree } {
    const shared = Buffer.from("same in both");
    const half = (arch: "x64" | "arm64"): BundleTree => new Map([
        ["Game.app/Contents", { kind: "directory", mode: 0o755 }],
        ["Game.app/Contents/Info.plist", { kind: "file", mode: 0o644, data: shared }],
        ["Game.app/Contents/MacOS/Game", { kind: "file", mode: 0o755, data: syntheticMachO({ arch, seed: `game-${arch}` }) }],
        ["Game.app/Contents/Frameworks/X.framework/Versions/Current", { kind: "symlink", mode: 0o755, target: "A" }],
        [`Game.app/Contents/Resources/v8_context_snapshot.${arch === "x64" ? "x86_64" : "arm64"}.bin`, {
            kind: "file", mode: 0o644, data: Buffer.from(arch),
        }],
    ]);
    return { x64: half("x64"), arm64: half("arm64") };
}

describe("mergeUniversalBundle", () => {
    it("joins differing machine code into one universal image, Intel first, and keeps the rest once", () => {
        const { x64, arm64 } = halves();
        const merged = mergeUniversalBundle(x64, arm64);

        const game = merged.get("Game.app/Contents/MacOS/Game");
        expect(game?.kind).toBe("file");
        const data = (game as { data: Buffer }).data;
        expect(data.readUInt32BE(0)).toBe(0xcafebabe);
        const firstOffset = data.readUInt32BE(8 + 8);
        expect(thinMachOArch(data.subarray(firstOffset))).toBe("x64");
        expect(merged.get("Game.app/Contents/Info.plist")).toEqual(arm64.get("Game.app/Contents/Info.plist"));
        expect(merged.get("Game.app/Contents/Frameworks/X.framework/Versions/Current"))
            .toEqual({ kind: "symlink", mode: 0o755, target: "A" });
    });

    it("carries each half's architecture-named snapshot", () => {
        const { x64, arm64 } = halves();
        const merged = mergeUniversalBundle(x64, arm64);

        expect(merged.has("Game.app/Contents/Resources/v8_context_snapshot.x86_64.bin")).toBe(true);
        expect(merged.has("Game.app/Contents/Resources/v8_context_snapshot.arm64.bin")).toBe(true);
    });

    it("refuses a file that is not machine code and differs between the halves", () => {
        const { x64, arm64 } = halves();
        arm64.set("Game.app/Contents/Info.plist", { kind: "file", mode: 0o644, data: Buffer.from("different") });

        expect(() => mergeUniversalBundle(x64, arm64)).toThrow(/Info\.plist differs/);
    });
});
