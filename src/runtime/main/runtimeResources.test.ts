import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    bindRuntimeBinary,
    createProjectMaterial,
    createSealedLayer,
    projectVerificationKey,
    runtimeSupportPath,
    RUNTIME_SUPPORT_FILENAME,
} from "@narraleaf/encryption";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { BoundedBufferCache, createRuntimeResources, PATCH_DIRECTORY_NAME } from "./runtimeResources";

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
        pack: GameRuntimePackV1;
    }> {
        const appDir = path.join(root, "app");
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
        } as unknown as GameRuntimePackV1;
        await fs.writeFile(path.join(appDir, "pack.json"), JSON.stringify(pack));
        await fs.writeFile(path.join(appDir, "assets", "one"), assetBytes);
        return { appDir, pack };
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
        const { appDir, pack } = await makeApp(material, "original");
        const resources = await createRuntimeResources(appDir);
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
        const { appDir, pack } = await makeApp(material, "original");
        await writePatch(path.join(appDir, PATCH_DIRECTORY_NAME, "ep2.patch.dat"), { projectMaterial: material }, {
            pack: JSON.stringify({ ...pack, marker: "patched" }),
            "assets/one": "replaced",
        });

        const resources = await createRuntimeResources(appDir);
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
        const { appDir, pack } = await makeApp(material, "original");
        await writePatch(
            path.join(appDir, PATCH_DIRECTORY_NAME, "mod.patch.dat"),
            { projectMaterial: material, proven: false },
            {
                pack: JSON.stringify({ ...pack, marker: "hostile" }),
                "assets/one": "reskinned",
                "plugins/evil/runtime.js": "export default 1",
            },
        );

        const resources = await createRuntimeResources(appDir);
        try {
            expect((await readPackOf(resources)).marker).toBe("base");
            expect((await resources.readAsset(pack, "asset-1")).toString()).toBe("reskinned");
            expect(await resources.readRuntimeFile("/plugins/evil/runtime.js")).toBeNull();
        } finally {
            await resources.dispose();
        }
    });

    it("ignores a patch made for another project", async () => {
        const material = createProjectMaterial();
        const { appDir, pack } = await makeApp(material, "original");
        await writePatch(
            path.join(appDir, PATCH_DIRECTORY_NAME, "foreign.patch.dat"),
            { projectMaterial: createProjectMaterial() },
            { "assets/one": "stranger" },
        );

        const warnings: string[] = [];
        const resources = await createRuntimeResources(appDir, {
            log: (level, message) => { if (level === "warning") { warnings.push(message); } },
        });
        try {
            expect((await resources.readAsset(pack, "asset-1")).toString()).toBe("original");
            expect(warnings.some(line => line.includes("foreign.patch.dat"))).toBe(true);
        } finally {
            await resources.dispose();
        }
    });

    it("applies the player's patches over the ones shipped with the build", async () => {
        const material = createProjectMaterial();
        const { appDir, pack } = await makeApp(material, "original");
        const userDataDir = path.join(root, "userData");
        await writePatch(path.join(appDir, PATCH_DIRECTORY_NAME, "shipped.patch.dat"), { projectMaterial: material }, {
            "assets/one": "shipped",
        });
        await writePatch(path.join(userDataDir, PATCH_DIRECTORY_NAME, "player.patch.dat"), { projectMaterial: material }, {
            "assets/one": "player",
        });

        const resources = await createRuntimeResources(appDir, { userDataDir });
        try {
            expect((await resources.readAsset(pack, "asset-1")).toString()).toBe("player");
        } finally {
            await resources.dispose();
        }
    });

    it("orders patches by what they declare before where they were found", async () => {
        const material = createProjectMaterial();
        const { appDir, pack } = await makeApp(material, "original");
        // Alphabetically "a" is found first, so only the declared order can put
        // "b" underneath it.
        await writePatch(path.join(appDir, PATCH_DIRECTORY_NAME, "a.patch.dat"), { projectMaterial: material }, {
            layer: JSON.stringify({ name: "later", order: 20 }),
            "assets/one": "later",
        });
        await writePatch(path.join(appDir, PATCH_DIRECTORY_NAME, "b.patch.dat"), { projectMaterial: material }, {
            layer: JSON.stringify({ name: "earlier", order: 10 }),
            "assets/one": "earlier",
        });

        const applied: string[] = [];
        const resources = await createRuntimeResources(appDir, {
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

    it("says so when patch files are present but the build cannot read them", async () => {
        const material = createProjectMaterial();
        const { appDir, pack } = await makeApp(material, "original");
        await writePatch(path.join(appDir, PATCH_DIRECTORY_NAME, "orphan.patch.dat"), { projectMaterial: material }, {
            "assets/one": "unreadable",
        });
        // A build made before the project had a key carries no support binary.
        await fs.rm(path.join(appDir, RUNTIME_SUPPORT_FILENAME));

        const warnings: string[] = [];
        const resources = await createRuntimeResources(appDir, {
            log: (level, message) => { if (level === "warning") { warnings.push(message); } },
        });
        try {
            expect((await resources.readAsset(pack, "asset-1")).toString()).toBe("original");
            expect(warnings.join("\n")).toContain("cannot read patches");
        } finally {
            await resources.dispose();
        }
    });
});
