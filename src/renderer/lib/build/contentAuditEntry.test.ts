import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { createAssetArchive } from "@narraleaf/bindings";
import { ASSET_ARCHIVE_FILENAME, ARCHIVE_READER_FILENAME } from "@narraleaf/bindings/read";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GAME_RUNTIME_BUNDLE_PACK_ENTRY, gameRuntimeBundleAssetEntry, gameRuntimeBundleModelEntry } from "@shared/utils/gameRuntimeBundle";
import { GAME_RUNTIME_PACK_SCHEMA_VERSION, type GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { runShippedContentAudit } from "./contentAuditEntry";

/**
 * The audit against a protected package, which is the shape it is hardest to get right.
 *
 * A protected package ships no asset manifest at all: the store names every entry after the asset
 * id and the reader derives it. So "which entry answers for this id" is a rule rather than a
 * lookup, and a rule that is subtly wrong fails the build for a package that is perfectly good.
 */

const IMAGE_ID = "00000000-0000-4000-8000-0000000000a1";
const MODEL_ID = "00000000-0000-4000-8000-0000000000a2";
const MISSING_ID = "00000000-0000-4000-8000-0000000000a3";

let tempDir: string;

beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-audit-"));
});

afterEach(async () => {
    // Best effort: once the protection component has been loaded out of this directory the host
    // keeps the file open for the life of the process, and the leftover belongs to the OS's
    // temporary directory rather than to this test.
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

/** A pack whose one page names each of `assetIds` in a slot a document stores an asset id in. */
function packNaming(assetIds: string[], modelBundles: string[]): GameRuntimePackV1 {
    return {
        schemaVersion: GAME_RUNTIME_PACK_SCHEMA_VERSION,
        generatedAt: "2026-01-01T00:00:00.000Z",
        mode: "production",
        runtimeVersion: "0.0.1-test",
        project: { name: "Fixture" },
        entry: { kind: "surface", surfaceId: "surface-main" },
        bundle: {
            bundleId: "bundle",
            revision: 1,
            timestamp: "2026-01-01T00:00:00.000Z",
            ui: {
                uidoc: {
                    schemaVersion: 1,
                    id: "ui-doc",
                    name: "Fixture UI",
                    surfaces: [{ id: "surface-main", name: "Main", rootElementId: "root" }],
                    elements: Object.fromEntries(assetIds.map((assetId, index) => [
                        index === 0 ? "root" : `element-${index}`,
                        {
                            id: index === 0 ? "root" : `element-${index}`,
                            type: "nl.image",
                            name: `Element ${index}`,
                            parentId: index === 0 ? null : "root",
                            childrenIds: index === 0 ? assetIds.slice(1).map((_, i) => `element-${i + 1}`) : [],
                            props: { assetId },
                        },
                    ])),
                } as never,
                uigraphs: {} as never,
                localBlueprints: {} as never,
                sharedBlueprints: [],
                persistentVariables: {} as never,
                savedVariables: {} as never,
                saveSchema: [] as never,
            },
        } as never,
        assets: { items: {}, ...(modelBundles.length > 0 ? { modelBundles } : {}) },
        plugins: [],
    } as GameRuntimePackV1;
}

/**
 * The protection component, beside the store it protects.
 *
 * A package carries its own copy - the store cannot be opened without it - so a fixture that left
 * it out would not be a package at all. The prebuild for this host is what a build for this host
 * ships.
 */
async function copyProtectionComponent(appDir: string): Promise<void> {
    const packageRoot = path.dirname(path.dirname(require.resolve("@narraleaf/bindings")));
    const prebuild = path.join(
        packageRoot,
        "prebuilds",
        `${process.platform}-${process.arch}`,
        "bindings.node",
    );
    await fs.copyFile(prebuild, path.join(appDir, "bindings.node"));
}

/** Write a protected package into a fresh app dir, with the entries a caller names. */
async function sealPackage(
    pack: GameRuntimePackV1,
    entries: Record<string, string>,
): Promise<string> {
    const appDir = path.join(tempDir, `app-${crypto.randomBytes(4).toString("hex")}`);
    await fs.mkdir(appDir, { recursive: true });
    await copyProtectionComponent(appDir);
    const writer = await createAssetArchive(
        path.join(appDir, ASSET_ARCHIVE_FILENAME),
        path.join(appDir, ARCHIVE_READER_FILENAME),
    );
    await writer.add(GAME_RUNTIME_BUNDLE_PACK_ENTRY, Buffer.from(JSON.stringify(pack), "utf-8"));
    for (const [name, content] of Object.entries(entries)) {
        await writer.add(name, Buffer.from(content, "utf-8"));
    }
    await writer.finalize();
    return appDir;
}

describe("the shipped content audit on a protected package", () => {
    it("resolves an ordinary asset by deriving its entry from the id", async () => {
        const appDir = await sealPackage(packNaming([IMAGE_ID], []), {
            [gameRuntimeBundleAssetEntry(IMAGE_ID)]: "image bytes",
        });

        const result = await runShippedContentAudit(appDir);

        expect(result.failures).toEqual([]);
        expect(result.checkedAssetCount).toBe(1);
    });

    it("resolves a model bundle through the entry that records its entry file", async () => {
        // A bundle is stored as `{id}/{path}` members plus one record under the id with a trailing
        // slash; there is no entry at the plain asset key, and the shipped game reaches a bare
        // bundle id through that record. An audit that asked for the plain key would report every
        // package carrying a puppet character as missing its model.
        const appDir = await sealPackage(packNaming([MODEL_ID], [MODEL_ID]), {
            [gameRuntimeBundleModelEntry(MODEL_ID)]: JSON.stringify({ e: "runtime/hiyori.model3.json" }),
            [gameRuntimeBundleAssetEntry(`${MODEL_ID}/runtime/hiyori.model3.json`)]: "model manifest",
        });

        const result = await runShippedContentAudit(appDir);

        expect(result.failures).toEqual([]);
    });

    it("reports an asset the package does not carry", async () => {
        // The check is non-vacuous: the same walk that passes above has to fail when the bytes are
        // not there, or it would prove nothing about either case.
        const appDir = await sealPackage(packNaming([MISSING_ID], []), {});

        const result = await runShippedContentAudit(appDir);

        expect(result.failures).toHaveLength(1);
        expect(result.failures[0]).toMatchObject({ assetId: MISSING_ID, origin: "Main" });
    });
});
