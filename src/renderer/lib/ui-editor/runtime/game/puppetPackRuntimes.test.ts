import { describe, expect, it } from "vitest";
import type { GameRuntimePackV1, GameRuntimePreloadBridge } from "@shared/types/gameRuntime";
import {
    findPackPuppetBackendSource,
    listPackPuppetBackendSources,
    resolvePackModelBundleUrl,
} from "./puppetPackRuntimes";

/**
 * Only the two URL functions a puppet mount reaches for. The rest of the bridge is deliberately absent:
 * if resolving a backend ever needs more of it, the seam has grown a dependency on the shell.
 */
function fakeBridge(): GameRuntimePreloadBridge {
    return {
        pluginEntryUrl: (relativePath: string) => `nlgame://runtime/${relativePath}`,
        assetUrl: (key: string) => `nlgame://asset/${key}`,
    } as unknown as GameRuntimePreloadBridge;
}

function fakePack(patch: Partial<GameRuntimePackV1> = {}): GameRuntimePackV1 {
    return {
        puppetRuntimes: [
            { name: "renderer-a", entryRelativePath: "puppet/renderer-a/index.js", files: ["core.wasm"] },
        ],
        // A shipped protected pack states nothing about its assets except which ids are bundles -
        // no paths, no names. `items` is empty here for the same reason it is empty there, so the
        // seam is tested against what a player actually gets.
        assets: {
            items: {},
            modelBundles: ["model-alice"],
        },
        ...patch,
    } as unknown as GameRuntimePackV1;
}

describe("puppetPackRuntimes", () => {
    it("resolves a published backend's module through the shell's own scheme", () => {
        const source = findPackPuppetBackendSource(fakeBridge(), fakePack(), "renderer-a");

        expect(source?.id).toBe("renderer-a");
        expect(source?.url).toBe("nlgame://runtime/puppet/renderer-a/index.js");
    });

    it("answers null for a backend this game did not publish", () => {
        // The `missing-backend` case: the widget's box stays, nothing is drawn, nothing throws.
        expect(findPackPuppetBackendSource(fakeBridge(), fakePack(), "renderer-b")).toBeNull();
        expect(listPackPuppetBackendSources(fakeBridge(), fakePack({ puppetRuntimes: undefined }))).toEqual([]);
        expect(listPackPuppetBackendSources(fakeBridge(), null)).toEqual([]);
    });

    it("confines resolveFile to the backend's own directory", async () => {
        const source = findPackPuppetBackendSource(fakeBridge(), fakePack(), "renderer-a")!;

        await expect(source.resolveFile("./core.wasm"))
            .resolves.toBe("nlgame://runtime/puppet/renderer-a/core.wasm");
        await expect(source.resolveFile("nested\\page-0.png"))
            .resolves.toBe("nlgame://runtime/puppet/renderer-a/nested/page-0.png");
        // A module names its own siblings and nothing else.
        await expect(source.resolveFile("../other/index.js")).rejects.toThrow(/escapes/);
        await expect(source.resolveFile("/etc/passwd")).rejects.toThrow(/escapes/);
    });

    it("points a model bundle at its own directory, and names no file inside it", () => {
        const url = resolvePackModelBundleUrl(fakeBridge(), fakePack(), "model-alice");
        // The trailing slash is the whole mechanism: `resolveSibling` does URL arithmetic against
        // this, and `.../asset/{id}` without it would make every texture the model names resolve to
        // a sibling of the id instead of into the bundle.
        expect(url).toBe("nlgame://asset/model-alice/");
        expect(new URL("textures/body.png", url!).href).toBe("nlgame://asset/model-alice/textures/body.png");
        // And nothing about what is inside the bundle leaked into the URL to get there.
        expect(url).not.toContain("model.json");
    });

    it("answers null for an asset that is not a model bundle", () => {
        // Null rather than the bare id: both callers fall back to the plain asset URL themselves, so
        // the result is unchanged, and the answer no longer depends on a manifest that does not ship.
        expect(resolvePackModelBundleUrl(fakeBridge(), fakePack(), "plain-image")).toBeNull();
    });

    it("answers null for an asset the pack does not carry, and with no bridge", () => {
        expect(resolvePackModelBundleUrl(fakeBridge(), fakePack(), "model-gone")).toBeNull();
        expect(resolvePackModelBundleUrl(null, fakePack(), "model-alice")).toBeNull();
    });
});
