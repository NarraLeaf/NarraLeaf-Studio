import path from "path";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import type {
    AssetTransferEntry,
    AssetTransferOfferResult,
    AssetTransferRedeemResult,
} from "@shared/types/assetTransfer";
import type { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";
import { getRuntimeGrantPolicy } from "../permissions";

/**
 * The entry as it will be stored, or null when it does not describe a file.
 *
 * Everything here arrives from a renderer, so nothing is kept verbatim: the path is resolved before
 * it is checked and before it is stored, which is what stops a `..` from smuggling in a file the
 * check passed under a different spelling, and the description is rebuilt field by field rather
 * than spread, so an entry cannot carry anything the paste side was not meant to receive.
 */
function normalizeEntry(entry: AssetTransferEntry | undefined): AssetTransferEntry | null {
    if (!entry || typeof entry !== "object") {
        return null;
    }

    const assetId = typeof entry.assetId === "string" ? entry.assetId.trim() : "";
    const fileName = typeof entry.fileName === "string" ? entry.fileName.trim() : "";
    const type = typeof entry.type === "string" ? entry.type.trim() : "";
    const sourcePath = typeof entry.sourcePath === "string" ? entry.sourcePath : "";
    if (!assetId || !fileName || !type || !sourcePath) {
        return null;
    }
    if (sourcePath.includes("\0") || !path.isAbsolute(sourcePath)) {
        return null;
    }

    return {
        assetId,
        fileName,
        type,
        ...(typeof entry.size === "number" && Number.isFinite(entry.size) ? { size: entry.size } : {}),
        // Only the literal `true` marks a directory, so a truthy value of some other shape cannot
        // talk the offer into checking - and granting - a whole tree.
        ...(entry.isDirectory === true ? { isDirectory: true } : {}),
        sourcePath: path.resolve(sourcePath),
    };
}

/**
 * Offer the files behind a copy, and mint the token that stands for them.
 *
 * Refusal is whole-manifest on purpose. A pasting window has no way to tell a short manifest from a
 * complete one, so half an offer would have it import a subset and believe it had everything; no
 * token at all leaves the paste with its rows and a set of reference errors naming what is missing,
 * which is a state the author can act on.
 */
export class AssetTransferOfferHandler extends IPCHandler<IPCEventType.assetTransferOffer> {
    readonly name = IPCEventType.assetTransferOffer;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { entries }: IPCEvents[IPCEventType.assetTransferOffer]["data"],
    ): Promise<RequestStatus<AssetTransferOfferResult>> {
        if (!getRuntimeGrantPolicy(window, "transferredAsset")) {
            return this.success<AssetTransferOfferResult>({ offered: false, reason: "not-permitted" });
        }

        const manifest = Array.isArray(entries) ? entries : [];
        if (manifest.length === 0) {
            return this.success<AssetTransferOfferResult>({ offered: false, reason: "empty" });
        }

        const storageManager = window.app.storageManager;
        const verified: AssetTransferEntry[] = [];
        for (const candidate of manifest) {
            const entry = normalizeEntry(candidate);
            if (!entry) {
                return this.success<AssetTransferOfferResult>({ offered: false, reason: "invalid-entry" });
            }
            // Asked separately from the read check, which would fold both into one "no": Studio's own
            // storage is refused because of what it is, not because this window happens to lack a
            // grant over it, and the caller is told which.
            if (await storageManager.isPathProtected(entry.sourcePath)) {
                return this.success<AssetTransferOfferResult>({ offered: false, reason: "protected" });
            }
            // A directory entry is asked the stronger question. The grant it will be redeemed for
            // reaches the whole tree, and a window may not hand out more than it holds: a
            // non-recursive grant on a model bundle's root covers the directory and none of the
            // files that are the model.
            const readable = entry.isDirectory
                ? await storageManager.isPathTreeAllowed(window, entry.sourcePath, "read")
                : await storageManager.isPathAllowed(window, entry.sourcePath, "read");
            if (!readable) {
                return this.success<AssetTransferOfferResult>({ offered: false, reason: "unreadable" });
            }
            verified.push(entry);
        }

        return this.success<AssetTransferOfferResult>({
            offered: true,
            token: storageManager.recordAssetTransferOffer(window, verified),
        });
    }
}

/**
 * Trade a token for read access to the files it stands for.
 *
 * The grant is read-only and dies with this window. Nothing is re-derived from the token: it
 * addresses a manifest that was verified against the offering window when it was made, and the
 * paths in that manifest are the paths granted.
 *
 * Recursive only where the entry said it was a directory, and that entry was checked recursively
 * against the offering window before the token existed. Every other entry reaches its own path and
 * nothing beside it.
 */
export class AssetTransferRedeemHandler extends IPCHandler<IPCEventType.assetTransferRedeem> {
    readonly name = IPCEventType.assetTransferRedeem;
    readonly type = IPCMessageType.request;

    public handle(
        window: AppWindow,
        { token }: IPCEvents[IPCEventType.assetTransferRedeem]["data"],
    ): RequestStatus<AssetTransferRedeemResult> {
        const grantPolicy = getRuntimeGrantPolicy(window, "transferredAsset");
        if (!grantPolicy) {
            return this.success<AssetTransferRedeemResult>({ available: false, reason: "not-permitted" });
        }

        const entries = typeof token === "string" && token.length > 0
            ? window.app.storageManager.getAssetTransferOffer(token)
            : null;
        if (!entries) {
            // Not a failure, and deliberately not logged as one: the offering window closes, or the
            // copy came from a different Studio process, and the paste falls back to rows only.
            return this.success<AssetTransferRedeemResult>({ available: false, reason: "unknown-token" });
        }

        for (const entry of entries) {
            window.app.storageManager.grantFileSystemAccess(
                window,
                entry.sourcePath,
                grantPolicy.mode,
                entry.isDirectory ? grantPolicy.recursiveForDirectories : grantPolicy.recursive,
            );
        }

        return this.success<AssetTransferRedeemResult>({ available: true, entries });
    }
}
