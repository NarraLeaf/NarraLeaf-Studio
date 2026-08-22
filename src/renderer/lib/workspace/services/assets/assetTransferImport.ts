import type { AssetTransferEntry } from "@shared/types/assetTransfer";
import { getInterface } from "@/lib/app/bridge";
import { AssetType, isBundleAssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetCreateErrorCode, type Asset, type AssetsMap } from "@/lib/workspace/services/assets/types";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";

/**
 * Bringing the files a pasted selection references into the project that received it.
 *
 * Shared by every editor whose clipboard can cross projects - story rows and interface elements
 * alike - because the decision is the same wherever the reference sits: a file that can be made to
 * resolve is imported under the id it already has, and one that cannot is left to be reported. The
 * transport underneath is `@shared/types/assetTransfer`, which explains why a manifest carries no
 * paths and why an unavailable one is an ordinary outcome.
 */

/**
 * What {@link importTransferredAssets} needs of the workspace around it.
 *
 * Stated as functions rather than taken as services so the import order - redeem, skip what is
 * already here, read, create, and stop the moment the workspace freezes - can be exercised without
 * a project behind it.
 */
export interface TransferredAssetPort {
    /** Trade the clipboard's token for the files it stands for, or null when it stands for none. */
    redeem(token: string): Promise<AssetTransferEntry[] | null>;
    /** Whether this project's library already holds that id, under any type. */
    has(assetId: string): boolean;
    /** The bytes at a path the redeem granted read access to, or null when they cannot be read. */
    read(sourcePath: string): Promise<Uint8Array | null>;
    /**
     * File the bytes under the id they had in the source project.
     *
     * `"present"` answers an id the library turned out to be holding after all, which is the same
     * outcome as {@link has} and not a failure: the reference already resolves.
     */
    create(entry: AssetTransferEntry, bytes: Uint8Array): Promise<"created" | "present" | "failed">;
    /**
     * Copy a directory-backed asset - a model bundle - under the id it had in the source project.
     *
     * Separate from {@link create} because a bundle has no bytes to hand over: its manifest,
     * textures and motions are a tree, and what makes it one asset is that the tree arrives whole.
     * Answers the same three outcomes, and `"failed"` promises that nothing was registered.
     */
    createFromDirectory(entry: AssetTransferEntry): Promise<"created" | "present" | "failed">;
    /** Whether this window's project data has frozen. Asked again after every await. */
    isFrozen(): boolean;
}

/**
 * The clipboard's half of an asset transfer: a token, and the ids the copy said it stands for.
 *
 * Only the ids are read. What each file is called and where it lives are answered by the main
 * process at redeem time, against the window that offered them - nothing written on a clipboard
 * addresses a file.
 */
export type TransferredAssetGrant = {
    token: string;
    declaredAssetIds: readonly string[];
};

export type TransferredAssetImport = {
    /** Files that were not in this project and now are. */
    imported: number;
    /** Files that could not be brought over. One of these costs the author nothing but that file. */
    failed: number;
    /**
     * The workspace froze part-way through.
     *
     * The caller must abandon the paste rather than finish it: writes into a frozen workspace reach
     * the in-memory document, are refused at the file-system boundary and are gone again when the
     * thaw re-reads it.
     */
    frozen: boolean;
};

/**
 * Bring the files a foreign payload references into this project, under the ids they already have.
 *
 * Importing under the source's own id is what lets the payload be pasted verbatim: every reference
 * in it keeps naming the file it named, so nothing has to be rewritten inside shapes that are
 * open-ended by design.
 *
 * An unavailable manifest is an ordinary outcome, not an error - the copying window has closed, or
 * the copy came from another Studio process whose grants this one cannot see. The paste still
 * lands; its asset references stay foreign and `assets/missing` reports each one.
 */
export async function importTransferredAssets(
    port: TransferredAssetPort,
    grant: TransferredAssetGrant | undefined,
    wantedAssetIds: readonly string[],
): Promise<TransferredAssetImport> {
    const result: TransferredAssetImport = { imported: 0, failed: 0, frozen: false };
    // What the copy declared, intersected with what the pasted payload actually names and what this
    // project is missing. A token answers with the whole manifest it was minted for, and a paste
    // takes out of that only the files its own payload points at - never simply whatever the grant
    // reaches.
    const declared = new Set(grant?.declaredAssetIds ?? []);
    const wanted = new Set(wantedAssetIds.filter(id => declared.has(id) && !port.has(id)));
    if (!grant?.token || wanted.size === 0) {
        return result;
    }

    const granted = await port.redeem(grant.token);
    if (port.isFrozen()) {
        return { ...result, frozen: true };
    }
    if (!granted) {
        return result;
    }

    for (const entry of granted) {
        if (!wanted.has(entry.assetId)) {
            continue;
        }
        // A directory-backed asset is copied rather than read: there is no single file to hand
        // over, and the grant redeemed for it reaches the whole tree.
        let outcome: "created" | "present" | "failed";
        if (entry.isDirectory) {
            outcome = await port.createFromDirectory(entry);
        } else {
            const bytes = await port.read(entry.sourcePath);
            if (port.isFrozen()) {
                return { ...result, frozen: true };
            }
            if (!bytes) {
                result.failed += 1;
                continue;
            }
            outcome = await port.create(entry, bytes);
        }
        if (port.isFrozen()) {
            return { ...result, frozen: true };
        }
        if (outcome === "created") {
            result.imported += 1;
        } else if (outcome === "failed") {
            result.failed += 1;
        }
    }
    return result;
}

/**
 * The asset holding an id, whichever type it is filed under.
 *
 * Every type is searched because the content path carries no type segment: one id names one file on
 * disk, so an id an audio asset occupies is not free for an image either.
 */
export function findLibraryAsset(library: AssetsMap, assetId: string): Asset | null {
    for (const type of Object.values(AssetType)) {
        const asset = library[type]?.[assetId];
        if (asset) {
            return asset;
        }
    }
    return null;
}

/**
 * The files behind a set of asset ids, described for an offer.
 *
 * An id with no library record is skipped: it names an asset set, or a reference this project has
 * already lost, and either way there is nothing to vouch for. A model bundle is described as a
 * directory, which is what earns its grant the reach its textures need.
 */
export function buildAssetTransferEntries(
    assetsService: AssetsService,
    assetIds: readonly string[],
): AssetTransferEntry[] {
    let library: AssetsMap;
    let localPathOf: (assetId: string) => string;
    try {
        library = assetsService.getAssets();
        const manager = assetsService.getLocalAssetsManager();
        localPathOf = (assetId: string) => manager.getLocalAssetPath(assetId);
    } catch {
        // The library is not open yet. Copying does not wait for it.
        return [];
    }
    const entries: AssetTransferEntry[] = [];
    for (const assetId of assetIds) {
        const asset = findLibraryAsset(library, assetId);
        if (!asset) {
            continue;
        }
        entries.push({
            assetId: asset.id,
            // A record with no name would be refused, and one blank name refuses the whole manifest.
            fileName: asset.name.trim() || asset.id,
            type: asset.type,
            ...(isBundleAssetType(asset.type) ? { isDirectory: true } : {}),
            sourcePath: localPathOf(asset.id),
        });
    }
    return entries;
}

/**
 * The workspace, as {@link importTransferredAssets} asks about it.
 *
 * Every method answers rather than throws: an import that raised would cost the author the paste,
 * and a paste is worth more than the file it could not bring with it.
 */
export function createTransferredAssetPort(
    assetsService: AssetsService,
    fileSystemService: FileSystemService,
    isFrozen: () => boolean,
): TransferredAssetPort {
    return {
        redeem: async (token: string) => {
            try {
                const status = await getInterface().assets.transfer.redeem(token);
                return status.success && status.data.available ? status.data.entries : null;
            } catch (error) {
                console.warn("[assetTransfer] could not redeem the pasted asset manifest", error);
                return null;
            }
        },
        has: (assetId: string) => {
            try {
                return Boolean(findLibraryAsset(assetsService.getAssets(), assetId));
            } catch {
                return false;
            }
        },
        read: async (sourcePath: string) => {
            try {
                const result = await fileSystemService.readRaw(sourcePath);
                return result.ok ? result.data : null;
            } catch {
                return null;
            }
        },
        create: async (entry, bytes) => {
            const type = toAssetType(entry.type);
            if (!type) {
                return "failed";
            }
            try {
                // No group: the file lands at the root of its section, the way a file created from
                // a category header does. The group it sat in over there is another project's id
                // and names nothing here.
                const created = await assetsService.createLocalAssetFromBytes(
                    type,
                    entry.fileName,
                    bytes,
                    undefined,
                    { id: entry.assetId },
                );
                if (created.success) {
                    return "created";
                }
                // An id this library turns out to hold already is the outcome the reference wanted:
                // it resolves. Nothing was written, and a second paste of the same clipboard lands
                // here rather than duplicating the file.
                return created.code === AssetCreateErrorCode.IdInUse ? "present" : "failed";
            } catch (error) {
                console.warn(`[assetTransfer] could not import "${entry.fileName}"`, error);
                return "failed";
            }
        },
        createFromDirectory: async (entry) => {
            const type = toAssetType(entry.type);
            // A type that is not directory-backed has no tree to copy, whatever the entry claimed:
            // the two halves have to agree before anything is written.
            if (!type || !isBundleAssetType(type)) {
                return "failed";
            }
            try {
                const created = await assetsService.createLocalBundleAssetFromDirectory(type, entry.sourcePath, {
                    id: entry.assetId,
                    // Named by the record rather than by the folder: the folder it is read out of is
                    // the source project's content shard, whose own name is the asset id.
                    name: entry.fileName,
                });
                if (created.success) {
                    return "created";
                }
                return created.code === AssetCreateErrorCode.IdInUse ? "present" : "failed";
            } catch (error) {
                console.warn(`[assetTransfer] could not import "${entry.fileName}"`, error);
                return "failed";
            }
        },
        isFrozen,
    };
}

/** The `AssetType` a manifest entry names, or null when this Studio has no such type. */
export function toAssetType(value: string): AssetType | null {
    return (Object.values(AssetType) as string[]).includes(value) ? value as AssetType : null;
}

/**
 * The asset manifest off a pasted payload, or undefined when it does not describe one.
 *
 * Rebuilt entry by entry rather than trusted, because it was written by another process: what
 * arrives is JSON of whatever shape. Only the ids are ever acted on - what a file is called and
 * where it lives come from the main process at redeem time, which verified both against the window
 * that offered them.
 */
export function readClipboardAssetGrant(value: unknown): TransferredAssetGrant | undefined {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const { token, entries } = value as { token?: unknown; entries?: unknown };
    if (typeof token !== "string" || !token || !Array.isArray(entries)) {
        return undefined;
    }
    const declaredAssetIds: string[] = [];
    for (const entry of entries) {
        const assetId = (entry as { assetId?: unknown })?.assetId;
        if (typeof assetId === "string" && assetId) {
            declaredAssetIds.push(assetId);
        }
    }
    return { token, declaredAssetIds };
}
