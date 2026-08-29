/**
 * The audit's own entry point, bundled on its own and loaded by the compile worker after it has
 * written a package.
 *
 * ## Why a separate bundle
 *
 * The audit runs the story compiler, which lives in the renderer tree and reaches its own modules
 * through the `@/` alias. The compile worker's bundle points `@/` at the main tree, so the compiler
 * cannot be imported into it - the two alias maps are mutually exclusive and neither is wrong. A
 * bundle of its own, built with the renderer's aliases and loaded by path, is what lets one process
 * run both. It is loaded rather than imported for exactly that reason.
 */

import fs from "fs/promises";
import path from "path";
import { openAssetArchive, ASSET_ARCHIVE_FILENAME, ARCHIVE_READER_FILENAME } from "@narraleaf/bindings/read";
import {
    GAME_RUNTIME_BUNDLE_PACK_ENTRY,
    gameRuntimeBundleAssetEntry,
    gameRuntimeBundleModelEntry,
} from "@shared/utils/gameRuntimeBundle";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { auditShippedContent, type ShippedArtifactReader, type ShippedContentAuditResult } from "./shippedContentAudit";
import { collectSaveAnchors, diffSaveAnchors, type SaveAnchorDiff } from "./saveAnchors";

async function fileHasContent(filePath: string): Promise<boolean> {
    try {
        const stats = await fs.stat(filePath);
        return stats.isFile() && stats.size > 0;
    } catch {
        return false;
    }
}

/**
 * Open the package the way the shipped game opens it: a sealed store when one is there, plain files
 * otherwise. The decision is made by looking at the package, never by being told, so the audit reads
 * whatever was actually produced.
 */
async function openArtifact(appDir: string, supportBinaryPath?: string): Promise<{
    pack: GameRuntimePackV1;
    reader: ShippedArtifactReader;
    close(): Promise<void>;
}> {
    const bundlePath = path.join(appDir, ASSET_ARCHIVE_FILENAME);
    if (await fileHasContent(bundlePath)) {
        /*
         * The codec is not in the app dir any more, and on a cross build the copy
         * that is there is for another machine. The compile hands over one this
         * process can open; the old path stays as the answer for an installed
         * game, which is the other thing this is pointed at.
         */
        const sealed = await openAssetArchive(
            supportBinaryPath ?? path.join(appDir, ARCHIVE_READER_FILENAME),
            bundlePath,
        );
        const pack = JSON.parse(
            Buffer.from(await sealed.read(GAME_RUNTIME_BUNDLE_PACK_ENTRY)).toString("utf-8"),
        ) as GameRuntimePackV1;
        // A model bundle is not stored under its own id. Its members are keyed `{id}/{path}` and the
        // one entry addressed by the id alone is the record naming the bundle's entry file, under
        // the key with the trailing slash - which is exactly how the shipped game resolves a bare
        // bundle id (see `resolveModelBundleKey`). Asking for `assets/{id}` finds nothing and would
        // fail the build for every package carrying a puppet character.
        const modelBundles = new Set(pack.assets.modelBundles ?? []);
        return {
            pack,
            reader: {
                // A sealed entry has to be read to be proven: the store answers no other question
                // about it, and "the entry is where the id says" is the claim under test.
                entryExists: async relativePath => (await sealed.read(relativePath)).byteLength > 0,
                resolveEntryName: assetId => (modelBundles.has(assetId)
                    ? gameRuntimeBundleModelEntry(assetId)
                    : gameRuntimeBundleAssetEntry(assetId)),
            },
            close: () => sealed.close(),
        };
    }
    const pack = JSON.parse(await fs.readFile(path.join(appDir, "pack.json"), "utf-8")) as GameRuntimePackV1;
    return {
        pack,
        // A loose entry is proven by being there with bytes in it. The file is not read through:
        // its presence at the manifest's own path is the thing the manifest is claiming.
        reader: {
            entryExists: relativePath => fileHasContent(path.join(appDir, relativePath)),
            resolveEntryName: assetId => pack.assets.items[assetId]?.relativePath ?? null,
        },
        close: async () => {},
    };
}

export async function runShippedContentAudit(
    appDir: string,
    supportBinaryPath?: string,
): Promise<ShippedContentAuditResult> {
    const artifact = await openArtifact(appDir, supportBinaryPath);
    try {
        return await auditShippedContent({ pack: artifact.pack, reader: artifact.reader });
    } finally {
        await artifact.close();
    }
}

export type { ShippedContentAuditResult, ShippedContentAuditFailure } from "./shippedContentAudit";

/**
 * What a patch built from `after` does to saves made against `before`.
 *
 * Exposed here, on the bundle the compile worker already loads by path, because the comparison runs
 * the story compiler and the compiler only resolves through the renderer's aliases. The caller hands
 * over two pack descriptors it already has open; nothing here touches a file.
 */
export async function compareSaveAnchors(
    before: GameRuntimePackV1,
    after: GameRuntimePackV1,
): Promise<SaveAnchorDiff> {
    return diffSaveAnchors(await collectSaveAnchors(before), await collectSaveAnchors(after));
}

export type { SaveAnchorDiff, SaveAnchorLoss } from "./saveAnchors";
