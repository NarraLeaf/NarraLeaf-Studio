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
    RUNTIME_SUPPORT_FILENAME,
} from "@narraleaf/encryption";
import { openSealedLayer } from "@narraleaf/encryption/runtime";
import { digestPayload, openPayload, patchCarriesEntry } from "./patchPayload";

const TITLE = "com.example.patched";

/**
 * The pack a fixture app dir carries. Only the parts a payload reader looks at:
 * the manifest is how a loose payload learns which files are assets, and an
 * entry it does not name is not reachable in the shipped game either.
 */
function fixturePack(assets: Record<string, string>): Record<string, unknown> {
    return {
        schemaVersion: 2,
        assets: {
            items: Object.fromEntries(Object.entries(assets).map(([id, relativePath]) => [
                id,
                { id, relativePath, type: "image", name: id, source: "local" },
            ])),
        },
    };
}

describe("patch payload", () => {
    let root: string;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), "nls-payload-"));
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    });

    async function writeLooseApp(name: string, assets: Record<string, string>): Promise<string> {
        const appDir = path.join(root, name);
        await fs.mkdir(path.join(appDir, "assets"), { recursive: true });
        await fs.mkdir(path.join(appDir, "plugins", "acme.sample"), { recursive: true });
        await fs.writeFile(
            path.join(appDir, "pack.json"),
            JSON.stringify(fixturePack(Object.fromEntries(Object.keys(assets).map(id => [id, `assets/${id}.png`])))),
        );
        for (const [id, bytes] of Object.entries(assets)) {
            await fs.writeFile(path.join(appDir, "assets", `${id}.png`), bytes);
        }
        await fs.writeFile(path.join(appDir, "plugins", "acme.sample", "runtime.js"), "export default {};");
        // Not part of the payload: a static runtime file, which ships from the
        // build and is never a patch's to carry.
        await fs.writeFile(path.join(appDir, "renderer.js"), "// renderer");
        return appDir;
    }

    it("reads a loose payload as the manifest names it, and nothing else", async () => {
        const appDir = await writeLooseApp("loose", { "asset-1": "one", "asset-2": "two" });
        const payload = await openPayload(appDir);
        try {
            expect(payload.names).toEqual([
                "assets/asset-1.png",
                "assets/asset-2.png",
                "pack",
                "plugins/acme.sample/runtime.js",
            ]);
            expect((await payload.read("assets/asset-1.png")).toString()).toBe("one");
            expect(JSON.parse((await payload.read("pack")).toString()).schemaVersion).toBe(2);
        } finally {
            await payload.close();
        }
    });

    it("reads a sealed payload through its own item table", async () => {
        const material = createProjectMaterial();
        const appDir = path.join(root, "sealed");
        await fs.mkdir(appDir, { recursive: true });
        await fs.copyFile(runtimeSupportPath(), path.join(appDir, RUNTIME_SUPPORT_FILENAME));
        const writer = await createSealedBundle(
            path.join(appDir, "content.dat"),
            path.join(appDir, RUNTIME_SUPPORT_FILENAME),
            { projectMaterial: material, titleId: TITLE },
        );
        // Sealed assets are keyed without an extension, which is exactly why the
        // patch's entry names have to come from the payload rather than be built
        // from an asset id by whoever is writing the patch.
        await writer.add("pack", Buffer.from(JSON.stringify(fixturePack({ "asset-1": "assets/asset-1" }))));
        await writer.add("assets/asset-1", Buffer.from("one"));
        await writer.add("plugins/acme.sample/runtime.js", Buffer.from("export default {};"));
        await writer.finalize();

        const payload = await openPayload(appDir);
        try {
            expect(payload.names).toEqual(["assets/asset-1", "pack", "plugins/acme.sample/runtime.js"]);
            expect((await payload.read("assets/asset-1")).toString()).toBe("one");
        } finally {
            await payload.close();
        }
    });

    it("carries the descriptor always, and an asset only when it differs", async () => {
        const baselineDir = await writeLooseApp("before", { "asset-1": "one", "asset-2": "two" });
        const baselinePayload = await openPayload(baselineDir);
        let baseline: Map<string, string>;
        try {
            baseline = await digestPayload(baselinePayload);
        } finally {
            await baselinePayload.close();
        }

        const nextDir = await writeLooseApp("after", { "asset-1": "one", "asset-2": "changed", "asset-3": "new" });
        const payload = await openPayload(nextDir);
        try {
            const carried: string[] = [];
            for (const name of payload.names) {
                const digest = (await digestPayload({ ...payload, names: [name] })).get(name) as string;
                if (patchCarriesEntry(name, digest, baseline)) {
                    carried.push(name);
                }
            }
            expect(carried).toEqual([
                // Unchanged, so absent: "assets/asset-1.png".
                "assets/asset-2.png",
                "assets/asset-3.png",
                "pack",
                // The plugin entry is byte-identical between the two fixtures.
            ]);
        } finally {
            await payload.close();
        }
    });

    it("with no baseline carries everything", () => {
        expect(patchCarriesEntry("assets/asset-1.png", "digest", null)).toBe(true);
        expect(patchCarriesEntry("pack", "digest", new Map([["pack", "digest"]]))).toBe(true);
    });

    /**
     * The shape end to end: what a payload reader hands out is what a patch is
     * sealed from, and what the shipped game reads back has to be those bytes
     * under those names. A patch whose names came out differently would apply
     * cleanly and change nothing, which is the failure this pins.
     */
    it("round-trips a payload through a patch the game can read", async () => {
        const material = createProjectMaterial();
        const appDir = await writeLooseApp("source", { "asset-1": "one" });
        // The installed build the patch is for: its binary is what opens the patch.
        const installed = path.join(root, "installed");
        await fs.mkdir(installed, { recursive: true });
        await fs.copyFile(runtimeSupportPath(), path.join(installed, RUNTIME_SUPPORT_FILENAME));
        await bindRuntimeBinary(path.join(installed, RUNTIME_SUPPORT_FILENAME), {
            projectMaterial: material,
            titleId: TITLE,
        });

        const patchPath = path.join(root, "episode.patch.dat");
        const payload = await openPayload(appDir);
        try {
            const writer = await createSealedLayer(patchPath, { projectMaterial: material, titleId: TITLE });
            for (const name of payload.names) {
                await writer.add(name, await payload.read(name));
            }
            await writer.finalize();
        } finally {
            await payload.close();
        }

        const reader = await openSealedLayer(path.join(installed, RUNTIME_SUPPORT_FILENAME), patchPath, {
            verificationKey: projectVerificationKey(material, TITLE),
        });
        try {
            expect(reader.proven).toBe(true);
            expect((await reader.read("assets/asset-1.png")).toString()).toBe("one");
            expect((await reader.read("plugins/acme.sample/runtime.js")).toString()).toBe("export default {};");
        } finally {
            await reader.close();
        }
    });
});
