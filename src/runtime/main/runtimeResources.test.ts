import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    bindRuntimeBinary,
    createProjectMaterial,
    createSealedBundle,
    createSealedLayer,
    projectVerificationKey,
    runtimeSupportPath,
    RUNTIME_BUNDLE_FILENAME,
    RUNTIME_SUPPORT_FILENAME,
} from "@narraleaf/encryption";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { PATCH_DIRECTORY_NAME } from "@shared/utils/patchDelivery";
import { diffPack } from "@shared/utils/packDelta";
import { openSealedBundle } from "@narraleaf/encryption/runtime";
import { BoundedBufferCache, createRuntimeResources } from "./runtimeResources";

describe("BoundedBufferCache", () => {
    it("evicts the least recently used entries once over budget", () => {
        const cache = new BoundedBufferCache(10);
        cache.set("a", Buffer.alloc(4));
        cache.set("b", Buffer.alloc(4));
        // Touch "a" so "b" becomes the eviction candidate.
        expect(cache.get("a")).not.toBeNull();
        cache.set("c", Buffer.alloc(4));

        expect(cache.get("b")).toBeNull();
        expect(cache.get("a")).not.toBeNull();
        expect(cache.get("c")).not.toBeNull();
    });

    it("replaces entries in place and rejects oversized values", () => {
        const cache = new BoundedBufferCache(10);
        cache.set("a", Buffer.alloc(6));
        cache.set("a", Buffer.alloc(8));
        expect(cache.get("a")?.byteLength).toBe(8);

        cache.set("big", Buffer.alloc(11));
        expect(cache.get("big")).toBeNull();
        // The oversized value must not have evicted the existing entry.
        expect(cache.get("a")?.byteLength).toBe(8);
    });

    it("clear drops everything", () => {
        const cache = new BoundedBufferCache(10);
        cache.set("a", Buffer.alloc(2));
        cache.clear();
        expect(cache.get("a")).toBeNull();
    });
});

/**
 * Reading a protected payload, against a real sealed store rather than a stand-in.
 *
 * Everything here is about what a shipped game can and cannot be asked. The store
 * is opened the way a player's copy opens it - through the bound binary, with no
 * key passed - because that is precisely what an attacker who has replaced the
 * main process also has.
 */
describe("protected runtime resources", () => {
    let root: string;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-sealed-"));
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    });

    /** A protected app dir holding one asset, shipped the way a production build ships: no manifest. */
    async function makeSealedApp(assetId: string, assetBytes: string): Promise<string> {
        const appDir = path.join(root, "game", "app");
        await fs.mkdir(appDir, { recursive: true });
        await fs.copyFile(runtimeSupportPath(), path.join(appDir, RUNTIME_SUPPORT_FILENAME));
        const writer = await createSealedBundle(
            path.join(appDir, RUNTIME_BUNDLE_FILENAME),
            path.join(appDir, RUNTIME_SUPPORT_FILENAME),
        );
        await writer.add("pack", Buffer.from(JSON.stringify({ assets: { items: {} } })));
        await writer.add(`assets/${assetId}`, Buffer.from(assetBytes));
        await writer.finalize();
        return appDir;
    }

    /*
     * The runtime half of the opaque-read design. The pack handed in here is deliberately empty of
     * assets: if resolution ever went back to consulting it, this is the test that fails, and it
     * fails for the shipped shape rather than for the preview one.
     */
    it("reads an asset from a store that lists nothing, by deriving the entry from the id", async () => {
        const assetId = "b3f1c0de-0000-4000-8000-000000000001";
        const appDir = await makeSealedApp(assetId, "sealed image bytes");
        const emptyPack = { assets: { items: {} } } as unknown as GameRuntimePackV1;
        const resources = await createRuntimeResources(appDir, { gameRootDir: path.join(root, "game") });
        try {
            expect((await resources.readAsset(emptyPack, assetId)).toString()).toBe("sealed image bytes");
            expect(resources.resolveEntryName(emptyPack, assetId)).toBe(`assets/${assetId}`);
            // Never a loose file: a protected asset has no path a caller could stream from.
            expect(resources.getAssetFilePath(emptyPack, assetId)).toBeNull();
        } finally {
            await resources.dispose();
        }
    });

    /*
     * A guard on the installed package, not on this repo's code.
     *
     * The store files asset entries under a one-way fold of their name, so a shipped game cannot be
     * asked what it contains. That property lives in `@narraleaf/encryption`, which Studio consumes
     * as a published dependency - meaning an install that resolves an older version puts the plain
     * names back and nothing here would otherwise notice. The failure would be silent, invisible in
     * every feature test, and a straight regression of the thing the design exists for. So it is
     * asserted from the side that owns node_modules.
     */
    it("gets a store whose table does not disclose the asset ids it holds", async () => {
        const assetId = "b3f1c0de-0000-4000-8000-000000000001";
        const appDir = await makeSealedApp(assetId, "sealed image bytes");
        const reader = await openSealedBundle(
            path.join(appDir, RUNTIME_SUPPORT_FILENAME),
            path.join(appDir, RUNTIME_BUNDLE_FILENAME),
        );
        try {
            const listed = reader.names();
            expect(listed).toContain("pack");
            expect(listed).not.toContain(`assets/${assetId}`);
            expect(listed.some(name => name.includes(assetId))).toBe(false);
            // Still reachable by the id itself - opacity must not have cost resolution.
            expect((await reader.read(`assets/${assetId}`)).toString()).toBe("sealed image bytes");
        } finally {
            await reader.close();
        }
    });

    it("refuses an id it was never given, rather than answering something", async () => {
        const appDir = await makeSealedApp("b3f1c0de-0000-4000-8000-000000000001", "sealed image bytes");
        const emptyPack = { assets: { items: {} } } as unknown as GameRuntimePackV1;
        const resources = await createRuntimeResources(appDir, { gameRootDir: path.join(root, "game") });
        try {
            await expect(resources.readAsset(emptyPack, "not-an-asset")).rejects.toThrow();
            await expect(resources.readAsset(emptyPack, "  ")).rejects.toThrow(/Asset id is required/);
        } finally {
            await resources.dispose();
        }
    });
});

/**
 * Patch layering, against real sealed files rather than a stand-in.
 *
 * The trust rules here are the whole point of the feature and every one of them
 * fails silently if it is wrong: a build that quietly accepted an unproven pack
 * would run a stranger's blueprint scripts and look exactly like one that did
 * not. So these open genuine patches produced by the real writer, including the
 * ones a hostile file would be.
 */
describe("patched runtime resources", () => {
    const TITLE = "com.example.patched";
    let root: string;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-patch-"));
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    });

    /**
     * A loose app dir bound to `material`, holding one asset. Loose on purpose:
     * it is the shape a build with no protection has, and patches must work there
     * too or they become a privilege of protected builds.
     */
    async function makeApp(material: string, assetBytes: string): Promise<{
        appDir: string;
        /** The folder that holds the game, which is where a player drops a patch. */
        gameRootDir: string;
        pack: GameRuntimePackV1;
    }> {
        const appDir = path.join(root, "game", "app");
        await fs.mkdir(path.join(appDir, "assets"), { recursive: true });
        await fs.copyFile(runtimeSupportPath(), path.join(appDir, RUNTIME_SUPPORT_FILENAME));
        await bindRuntimeBinary(path.join(appDir, RUNTIME_SUPPORT_FILENAME), {
            projectMaterial: material,
            titleId: TITLE,
        });
        const pack = {
            schemaVersion: 2,
            assets: { items: { "asset-1": { id: "asset-1", relativePath: "assets/one", type: "image", name: "one", source: "local" } } },
            addOns: { verificationKey: projectVerificationKey(material, TITLE) },
            marker: "base",
            bundle: {
                storyHash: "base",
                storyLibrary: {
                    documents: {
                        "story-1": { id: "story-1", scenes: { "sc-1": { id: "sc-1", text: "one" }, "sc-2": { id: "sc-2", text: "two" } } },
                    },
                },
            },
        } as unknown as GameRuntimePackV1;
        await fs.writeFile(path.join(appDir, "pack.json"), JSON.stringify(pack));
        await fs.writeFile(path.join(appDir, "assets", "one"), assetBytes);
        return { appDir, gameRootDir: path.join(root, "game"), pack };
    }

    async function writePatch(
        filePath: string,
        options: { projectMaterial: string; titleId?: string; proven?: boolean },
        entries: Record<string, string>,
    ): Promise<void> {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const writer = await createSealedLayer(filePath, {
            projectMaterial: options.projectMaterial,
            titleId: options.titleId ?? TITLE,
            ...(options.proven === false ? { proven: false } : {}),
        });
        for (const [name, value] of Object.entries(entries)) {
            await writer.add(name, Buffer.from(value));
        }
        await writer.finalize();
    }

    const readPackOf = async (resources: Awaited<ReturnType<typeof createRuntimeResources>>) =>
        JSON.parse((await resources.readPack()).toString("utf-8")) as Record<string, unknown>;

    it("leaves a build with no patches exactly as it was", async () => {
        const material = createProjectMaterial();
        const { appDir, gameRootDir, pack } = await makeApp(material, "original");
        const resources = await createRuntimeResources(appDir, { gameRootDir });
        try {
            expect((await readPackOf(resources)).marker).toBe("base");
            expect((await resources.readAsset(pack, "asset-1")).toString()).toBe("original");
            // Still addressable as a file: nothing has taken the asset over.
            expect(resources.getAssetFilePath(pack, "asset-1")).not.toBeNull();
        } finally {
            await resources.dispose();
        }
    });

    it("takes the pack and the assets from a proven patch", async () => {
        const material = createProjectMaterial();
        const { appDir, gameRootDir, pack } = await makeApp(material, "original");
        await writePatch(path.join(gameRootDir, PATCH_DIRECTORY_NAME, "ep2.patch.dat"), { projectMaterial: material }, {
            pack: JSON.stringify({ ...pack, marker: "patched" }),
            "assets/one": "replaced",
        });

        const resources = await createRuntimeResources(appDir, { gameRootDir });
        try {
            expect((await readPackOf(resources)).marker).toBe("patched");
            expect((await resources.readAsset(pack, "asset-1")).toString()).toBe("replaced");
            // A patched asset has no file to stream from, even on a loose build.
            expect(resources.getAssetFilePath(pack, "asset-1")).toBeNull();
        } finally {
            await resources.dispose();
        }
    });

    it("lets an unproven patch replace an asset but not the pack or runtime code", async () => {
        const material = createProjectMaterial();
        const { appDir, gameRootDir, pack } = await makeApp(material, "original");
        await writePatch(
            path.join(gameRootDir, PATCH_DIRECTORY_NAME, "mod.patch.dat"),
            { projectMaterial: material, proven: false },
            {
                pack: JSON.stringify({ ...pack, marker: "hostile" }),
                "pack.delta": JSON.stringify(diffPack(pack, { ...pack, marker: "hostile" })),
                "assets/one": "reskinned",
                "plugins/evil/runtime.js": "export default 1",
            },
        );

        const applied: string[] = [];
        const resources = await createRuntimeResources(appDir, {
            gameRootDir,
            log: (level, message) => { if (level === "info") { applied.push(message); } },
        });
        try {
            expect((await readPackOf(resources)).marker).toBe("base");
            expect((await resources.readAsset(pack, "asset-1")).toString()).toBe("reskinned");
            expect(await resources.readRuntimeFile("/plugins/evil/runtime.js")).toBeNull();
            // What it did, not what it failed to prove.
            expect(applied.join("\n")).toContain("mod.patch.dat (files only)");
        } finally {
            await resources.dispose();
        }
    });

    it("ignores a patch made for another project, and names the file without saying why", async () => {
        const material = createProjectMaterial();
        const { appDir, gameRootDir, pack } = await makeApp(material, "original");
        await writePatch(
            path.join(gameRootDir, PATCH_DIRECTORY_NAME, "foreign.patch.dat"),
            { projectMaterial: createProjectMaterial() },
            { "assets/one": "stranger" },
        );

        const warnings: string[] = [];
        const resources = await createRuntimeResources(appDir, {
            gameRootDir,
            log: (level, message) => { if (level === "warning") { warnings.push(message); } },
        });
        try {
            expect((await resources.readAsset(pack, "asset-1")).toString()).toBe("original");
            const line = warnings.find(entry => entry.includes("foreign.patch.dat"));
            /*
             * The reason a layer gives is its own account of how a patch is bound to a build, and a
             * shipped game writes its log into a file the player can open. So the file is named and
             * nothing else is - asserted as an equality rather than a "does not contain", because
             * the wording that would leak comes from a dependency and can change without anything
             * here noticing.
             */
            expect(line).toBe("patch not applied: foreign.patch.dat");
        } finally {
            await resources.dispose();
        }
    });

    /* A build made to be inspected is read by its author, and there the reason is the whole point. */
    it("says why a patch was refused when it was built to be inspected", async () => {
        const material = createProjectMaterial();
        const { appDir, gameRootDir } = await makeApp(material, "original");
        await writePatch(
            path.join(gameRootDir, PATCH_DIRECTORY_NAME, "foreign.patch.dat"),
            { projectMaterial: createProjectMaterial() },
            { "assets/one": "stranger" },
        );

        const warnings: string[] = [];
        const resources = await createRuntimeResources(appDir, {
            gameRootDir,
            explainRefusedPatches: true,
            log: (level, message) => { if (level === "warning") { warnings.push(message); } },
        });
        try {
            const line = warnings.find(entry => entry.includes("foreign.patch.dat")) ?? "";
            expect(line.length).toBeGreaterThan("patch not applied: foreign.patch.dat".length);
        } finally {
            await resources.dispose();
        }
    });

    it("lets a patch kept across reinstalls win over one beside the game", async () => {
        const material = createProjectMaterial();
        const { appDir, gameRootDir, pack } = await makeApp(material, "original");
        const userDataDir = path.join(root, "userData");
        await writePatch(path.join(gameRootDir, PATCH_DIRECTORY_NAME, "beside.patch.dat"), { projectMaterial: material }, {
            "assets/one": "beside",
        });
        await writePatch(path.join(userDataDir, PATCH_DIRECTORY_NAME, "player.patch.dat"), { projectMaterial: material }, {
            "assets/one": "player",
        });

        const resources = await createRuntimeResources(appDir, { gameRootDir, userDataDir });
        try {
            expect((await resources.readAsset(pack, "asset-1")).toString()).toBe("player");
        } finally {
            await resources.dispose();
        }
    });

    it("orders patches by what they declare before where they were found", async () => {
        const material = createProjectMaterial();
        const { appDir, gameRootDir, pack } = await makeApp(material, "original");
        // Alphabetically "a" is found first, so only the declared order can put
        // "b" underneath it.
        await writePatch(path.join(gameRootDir, PATCH_DIRECTORY_NAME, "a.patch.dat"), { projectMaterial: material }, {
            layer: JSON.stringify({ name: "later", order: 20 }),
            "assets/one": "later",
        });
        await writePatch(path.join(gameRootDir, PATCH_DIRECTORY_NAME, "b.patch.dat"), { projectMaterial: material }, {
            layer: JSON.stringify({ name: "earlier", order: 10 }),
            "assets/one": "earlier",
        });

        const applied: string[] = [];
        const resources = await createRuntimeResources(appDir, {
            gameRootDir,
            log: (level, message) => { if (level === "info") { applied.push(message); } },
        });
        try {
            expect((await resources.readAsset(pack, "asset-1")).toString()).toBe("later");
            expect(applied[0]).toContain("earlier");
            expect(applied[1]).toContain("later");
        } finally {
            await resources.dispose();
        }
    });

    /**
     * The reason a delta exists. Two patches made against one build, neither aware of the other -
     * an episode and a language pack are the ordinary case - and installing both has to leave both
     * installed. A patch that carried the whole pack made the second one quietly undo the first.
     */
    it("composes what each proven patch changes rather than taking the last pack whole", async () => {
        const material = createProjectMaterial();
        const { appDir, gameRootDir } = await makeApp(material, "original");
        const scenesOf = (value: unknown) =>
            (value as { bundle: { storyLibrary: { documents: Record<string, { scenes: Record<string, { id: string; text: string }> }> } } })
                .bundle.storyLibrary.documents["story-1"].scenes;
        const base = JSON.parse(await fs.readFile(path.join(appDir, "pack.json"), "utf-8")) as unknown;

        const first = JSON.parse(JSON.stringify(base)) as unknown;
        scenesOf(first)["sc-1"] = { id: "sc-1", text: "rewritten" };
        const second = JSON.parse(JSON.stringify(base)) as unknown;
        scenesOf(second)["sc-3"] = { id: "sc-3", text: "new scene" };

        await writePatch(path.join(gameRootDir, PATCH_DIRECTORY_NAME, "fix.patch.dat"), { projectMaterial: material }, {
            layer: JSON.stringify({ name: "fix", order: 10 }),
            "pack.delta": JSON.stringify(diffPack(base, first)),
        });
        await writePatch(path.join(gameRootDir, PATCH_DIRECTORY_NAME, "episode.patch.dat"), { projectMaterial: material }, {
            layer: JSON.stringify({ name: "episode", order: 20 }),
            "pack.delta": JSON.stringify(diffPack(base, second)),
        });

        const resources = await createRuntimeResources(appDir, { gameRootDir });
        try {
            const composed = await readPackOf(resources);
            expect(scenesOf(composed)["sc-1"].text).toBe("rewritten");
            expect(scenesOf(composed)["sc-3"].text).toBe("new scene");
            expect(Object.keys(scenesOf(composed)).sort()).toEqual(["sc-1", "sc-2", "sc-3"]);
            // The stories in hand are not the stories either patch was built from, so the
            // fingerprint saves are matched against has to be taken again.
            expect((composed.bundle as { storyHash: string }).storyHash).not.toBe("base");
        } finally {
            await resources.dispose();
        }
    });

    /*
     * A patch made before deltas existed still means what it always meant: this is the pack now.
     * The one below it carries both, which is the shape an export produced while the two overlapped.
     */
    it("lets a patch that carries only a whole pack replace what a delta below it composed", async () => {
        const material = createProjectMaterial();
        const { appDir, gameRootDir } = await makeApp(material, "original");
        const base = JSON.parse(await fs.readFile(path.join(appDir, "pack.json"), "utf-8")) as Record<string, unknown>;
        const delta = { ...base, marker: "composed" };

        await writePatch(path.join(gameRootDir, PATCH_DIRECTORY_NAME, "a.patch.dat"), { projectMaterial: material }, {
            layer: JSON.stringify({ order: 10 }),
            "pack.delta": JSON.stringify(diffPack(base, delta)),
            pack: JSON.stringify(delta),
        });
        await writePatch(path.join(gameRootDir, PATCH_DIRECTORY_NAME, "b.patch.dat"), { projectMaterial: material }, {
            layer: JSON.stringify({ order: 20 }),
            pack: JSON.stringify({ ...base, marker: "whole" }),
        });

        const resources = await createRuntimeResources(appDir, { gameRootDir });
        try {
            expect((await readPackOf(resources)).marker).toBe("whole");
        } finally {
            await resources.dispose();
        }
    });

    it("says so when patch files are present but the build cannot read them", async () => {
        const material = createProjectMaterial();
        const { appDir, gameRootDir, pack } = await makeApp(material, "original");
        await writePatch(path.join(gameRootDir, PATCH_DIRECTORY_NAME, "orphan.patch.dat"), { projectMaterial: material }, {
            "assets/one": "unreadable",
        });
        // A build made before the project had a key carries no support binary.
        await fs.rm(path.join(appDir, RUNTIME_SUPPORT_FILENAME));

        const warnings: string[] = [];
        const resources = await createRuntimeResources(appDir, {
            gameRootDir,
            log: (level, message) => { if (level === "warning") { warnings.push(message); } },
        });
        try {
            expect((await resources.readAsset(pack, "asset-1")).toString()).toBe("original");
            expect(warnings.join("\n")).toContain("does not apply patches");
        } finally {
            await resources.dispose();
        }
    });
});
