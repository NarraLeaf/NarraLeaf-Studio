import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { openSealedBundle, RUNTIME_BUNDLE_FILENAME, RUNTIME_SUPPORT_FILENAME } from "@narraleaf/encryption/runtime";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { GAME_RUNTIME_BUNDLE_PACK_ENTRY } from "@shared/utils/gameRuntimeBundle";

/**
 * Reading a compiled app directory's payload back out, entry by entry.
 *
 * A patch is made of the same entries a build's payload is made of, addressed by
 * the same names, so producing one means reading a payload the compiler has just
 * written and sealing the parts of it that changed. This is also how the baseline
 * side is read - the build the patch is for is an app directory too - which is
 * why one reader serves both and neither can drift from the other.
 *
 * Which shape the directory is in is decided by looking at it, never by being
 * told, the same way the shipped game and the content audit decide.
 */

/** The entry-name prefixes a payload carries besides the descriptor and the assets. */
const PAYLOAD_FILE_PREFIXES = ["plugins", "puppet"] as const;

export interface PayloadReader {
    /** The pack descriptor, already parsed - callers need it to name the assets. */
    pack: GameRuntimePackV1;
    /** Every entry name in this payload, in a stable order. */
    names: string[];
    read(name: string): Promise<Buffer>;
    close(): Promise<void>;
}

async function fileHasContent(filePath: string): Promise<boolean> {
    try {
        const stats = await fs.stat(filePath);
        return stats.isFile() && stats.size > 0;
    } catch {
        return false;
    }
}

/** Every file under `root`, as entry names relative to the app dir, with `/` separators. */
async function listEntryNames(appDir: string, root: string): Promise<string[]> {
    const absolute = path.join(appDir, root);
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
        entries = await fs.readdir(absolute, { withFileTypes: true });
    } catch {
        return [];
    }
    const names: string[] = [];
    for (const entry of entries) {
        const child = `${root}/${entry.name}`;
        if (entry.isDirectory()) {
            names.push(...await listEntryNames(appDir, child));
        } else if (entry.isFile()) {
            names.push(child);
        }
    }
    return names;
}

/**
 * Open a compiled app directory's payload.
 *
 * The sealed shape answers for itself: its item table already names every entry.
 * The loose shape is enumerated from the manifest for assets and from disk for
 * the runtime files - from the manifest rather than from the assets directory
 * because the manifest is what a reader addresses an asset by, and a file the
 * manifest does not name is not reachable in the shipped game either.
 */
export async function openPayload(appDir: string): Promise<PayloadReader> {
    const bundlePath = path.join(appDir, RUNTIME_BUNDLE_FILENAME);
    if (await fileHasContent(bundlePath)) {
        const sealed = await openSealedBundle(path.join(appDir, RUNTIME_SUPPORT_FILENAME), bundlePath);
        try {
            const pack = JSON.parse(
                (await sealed.read(GAME_RUNTIME_BUNDLE_PACK_ENTRY)).toString("utf-8"),
            ) as GameRuntimePackV1;
            return {
                pack,
                names: sealed.names().slice().sort((a, b) => a.localeCompare(b)),
                read: name => sealed.read(name),
                close: () => sealed.close(),
            };
        } catch (error) {
            await sealed.close().catch(() => undefined);
            throw error;
        }
    }

    const pack = JSON.parse(await fs.readFile(path.join(appDir, "pack.json"), "utf-8")) as GameRuntimePackV1;
    const names = [GAME_RUNTIME_BUNDLE_PACK_ENTRY];
    for (const item of Object.values(pack.assets?.items ?? {})) {
        names.push(item.relativePath);
    }
    for (const prefix of PAYLOAD_FILE_PREFIXES) {
        names.push(...await listEntryNames(appDir, prefix));
    }
    const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b));
    return {
        pack,
        names: unique,
        read: name => name === GAME_RUNTIME_BUNDLE_PACK_ENTRY
            ? fs.readFile(path.join(appDir, "pack.json"))
            : fs.readFile(path.join(appDir, name)),
        close: async () => {},
    };
}

/**
 * Entry name -> content digest, for deciding what a patch has to carry.
 *
 * Digests rather than timestamps or sizes: a rebuild rewrites every file, and
 * two different images the same length apart are exactly the case a patch must
 * not miss. Reading the whole baseline is the price, and it is paid once against
 * a directory already on the author's disk.
 */
export async function digestPayload(reader: PayloadReader): Promise<Map<string, string>> {
    const digests = new Map<string, string>();
    for (const name of reader.names) {
        digests.set(name, crypto.createHash("sha256").update(await reader.read(name)).digest("base64"));
    }
    return digests;
}

/**
 * Whether a patch has to carry this entry.
 *
 * The pack descriptor always goes in. It is what a new scene arrives in, it is
 * small next to any asset, and a compile rewrites it every time - so comparing it
 * would only ever answer "changed" while leaving a reader wondering whether it
 * might not have. With no baseline everything goes in, which is always correct
 * and is the answer when the author no longer has the build to compare against.
 */
export function patchCarriesEntry(
    name: string,
    digest: string,
    baseline: Map<string, string> | null,
): boolean {
    if (name === GAME_RUNTIME_BUNDLE_PACK_ENTRY || !baseline) {
        return true;
    }
    return baseline.get(name) !== digest;
}
