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
import { openSealedBundle, RUNTIME_BUNDLE_FILENAME, RUNTIME_SUPPORT_FILENAME } from "@narraleaf/encryption/runtime";
import { GAME_RUNTIME_BUNDLE_PACK_ENTRY } from "@shared/utils/gameRuntimeBundle";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { auditShippedContent, type ShippedArtifactReader, type ShippedContentAuditResult } from "./shippedContentAudit";

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
async function openArtifact(appDir: string): Promise<{
    pack: GameRuntimePackV1;
    reader: ShippedArtifactReader;
    close(): Promise<void>;
}> {
    const bundlePath = path.join(appDir, RUNTIME_BUNDLE_FILENAME);
    if (await fileHasContent(bundlePath)) {
        const sealed = await openSealedBundle(path.join(appDir, RUNTIME_SUPPORT_FILENAME), bundlePath);
        const pack = JSON.parse(
            Buffer.from(await sealed.read(GAME_RUNTIME_BUNDLE_PACK_ENTRY)).toString("utf-8"),
        ) as GameRuntimePackV1;
        return {
            pack,
            reader: {
                // A sealed entry has to be read to be proven: the store answers no other question
                // about it, and "the manifest says so" is the claim under test.
                entryExists: async relativePath => (await sealed.read(relativePath)).byteLength > 0,
            },
            close: () => sealed.close(),
        };
    }
    const pack = JSON.parse(await fs.readFile(path.join(appDir, "pack.json"), "utf-8")) as GameRuntimePackV1;
    return {
        pack,
        // A loose entry is proven by being there with bytes in it. The file is not read through:
        // its presence at the manifest's own path is the thing the manifest is claiming.
        reader: { entryExists: relativePath => fileHasContent(path.join(appDir, relativePath)) },
        close: async () => {},
    };
}

export async function runShippedContentAudit(appDir: string): Promise<ShippedContentAuditResult> {
    const artifact = await openArtifact(appDir);
    try {
        return await auditShippedContent({ pack: artifact.pack, reader: artifact.reader });
    } finally {
        await artifact.close();
    }
}

export type { ShippedContentAuditResult, ShippedContentAuditFailure } from "./shippedContentAudit";
