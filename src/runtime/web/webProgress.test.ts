import { describe, expect, it, vi } from "vitest";
import { WEB_PROGRESS_UNSUPPORTED_REASON, webProgressBridge } from "./webProgress";

/**
 * A web export has no shared file, so both nodes have to say so. The two things worth holding here
 * are that it refuses rather than pretending, and that it refuses as `failed` rather than as
 * `missing` - `missing` means "nobody has exported yet", which would send an author's first-run
 * branch down a path that has nothing to do with why this build cannot look.
 */
describe("the web shell's progress bridge", () => {
    it("refuses to write, and never reports success", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const result = await webProgressBridge.write({
            storyId: "story-1",
            savedVariables: { gold: 12 },
            persistentVariables: { seenIntro: true },
            anchor: { sceneId: "scene-3", sceneRuntimeName: "chapter-two" },
            visitedSceneIds: ["scene-1"],
        });
        expect(result.outcome).toBe("failed");
        expect(result.error).toBe(WEB_PROGRESS_UNSUPPORTED_REASON);
        warn.mockRestore();
    });

    it("refuses to read as failed, not as missing", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const result = await webProgressBridge.read();
        expect(result.outcome).toBe("failed");
        expect(result.document).toBeNull();
        expect(result.error).toBe(WEB_PROGRESS_UNSUPPORTED_REASON);
        warn.mockRestore();
    });

    it("says why, so the node's Error pin carries something an author can read", () => {
        expect(WEB_PROGRESS_UNSUPPORTED_REASON).toMatch(/web build/i);
    });
});
