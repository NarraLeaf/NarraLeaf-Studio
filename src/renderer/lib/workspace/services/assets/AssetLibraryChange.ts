import type { AssetImportRefusal, RefusableStatus } from "./assetImportRefusal";
import type { AssetType } from "./assetTypes";
import type { Asset, AssetSource } from "./types";

type AnyAsset = Asset<AssetType, AssetSource>;

/** Why an asset's bytes could not be held aside, by the asset's name. */
export type AssetKeepFailure = { name: string; refusal: AssetImportRefusal };

/** What the library answers when asked to hold an asset's bytes aside. */
export type AssetKeepAnswer =
    | { token: string }
    /** The asset's file is already missing, so there is nothing to hold. */
    | { missing: true }
    | { refusal: AssetImportRefusal };

/**
 * What an {@link AssetLibraryChange} needs from the asset library. `AssetsService.beginLibraryChange`
 * supplies the real one; `P` is whatever it uses to put a taken-back asset where it was.
 */
export interface AssetLibraryChangePort<P> {
    /** The asset as the library holds it now, or undefined when it is gone. */
    lookup(type: AssetType, assetId: string): AnyAsset | undefined;
    /** Copy an asset's current bytes aside, leaving them in place. */
    keep(asset: AnyAsset): Promise<AssetKeepAnswer>;
    /** Write bytes held aside over the asset's own, through the same steps a replacement takes. */
    write(asset: AnyAsset, token: string): Promise<RefusableStatus<unknown>>;
    /** Let bytes held aside go. Never throws. */
    release(type: AssetType, token: string): void;
    /** Take an asset out of the library, keeping what puts it back. Null when that cannot be done. */
    takeBack(asset: AnyAsset): Promise<P | null>;
    putBack(taken: P): Promise<void>;
    /** Let a taken-back asset go for good. Never throws. */
    forgetTaken(taken: P): void;
    /** Tell the author that a step left an asset as it was, and why. */
    report(failure: AssetKeepFailure): void;
}

/** An undo or redo that stopped before writing anything, because a copy could not be made. */
export class AssetKeepError extends Error {
    constructor(public readonly failure: AssetKeepFailure) {
        super(`Could not keep the current file of ${failure.name}`);
        this.name = "AssetKeepError";
    }
}

/**
 * One asset whose bytes the operation replaced, and the bytes on the other side of that replacement.
 *
 * Only one copy is held, never two: whichever side is not in the asset's file right now is in the
 * slot. Undo and redo are therefore the same move - hold what is there, write what was held - and the
 * side that is held aside is the one the next step needs.
 */
type HeldContent = {
    assetId: string;
    type: AssetType;
    token: string;
    /** Which side the asset's file holds: the operation's bytes, or the ones it wrote over. */
    live: "after" | "before";
};

type ImportedAsset<P> = {
    type: AssetType;
    assetId: string;
    /** Set while the import is taken back: what puts the asset where it was. */
    taken: P | null;
};

/**
 * What one operation did to the asset library, kept so that a single undo step can take it back: the
 * assets whose bytes it wrote over, and the files it imported.
 *
 * Replacing an asset's bytes keeps its id, which is the point - every reference follows - and it is
 * also why nothing used to be able to take a replacement back: the file is still there, and what it
 * held before is gone. So before an operation writes over an asset, {@link keep} copies the asset's
 * current bytes into the project's undo trash (`AssetTrash`), and nothing may be written over an asset
 * whose copy could not be made. One mechanism for every operation that replaces bytes: the PSD
 * re-import that refreshes the images it made last time, and the voice pickup that writes a new
 * recording into a take.
 *
 * # Undo and redo
 *
 * Both write through the library's own replace path (`AssetsService.replaceAssetContent`), so an undo
 * refreshes thumbnails, previews and waveforms exactly as the replacement did - the hash moves, the
 * cached thumbnail goes, `updated` is announced. Each step first copies aside every file it is about to
 * write over, so the step after it has them; a copy that cannot be made stops the step before anything
 * is written, tells the author which asset and why, and leaves the step where it was on the stack.
 *
 * Imported assets are taken out of the library on undo and put back on redo, through the same trash a
 * deletion uses. An operation that imports and replaces is one gesture, and taking back half of it
 * would leave the files it brought in sitting in the library linked to nothing.
 *
 * # Lifetime
 *
 * The undo step owns this and calls {@link dispose} when it leaves the stack for good. What is let go
 * depends on which side is in place: after an undo nobody will redo, the operation's own bytes and
 * imports go; while the operation stands, the bytes it wrote over go.
 */
export class AssetLibraryChange<P = unknown> {
    private readonly held = new Map<string, HeldContent>();
    private readonly imported: ImportedAsset<P>[] = [];
    private disposed = false;

    constructor(private readonly port: AssetLibraryChangePort<P>) {}

    /** Whether the operation did anything this change has to take back. */
    public isEmpty(): boolean {
        return this.held.size === 0 && this.imported.length === 0;
    }

    /**
     * Copy aside the bytes each of `assets` holds now, ahead of writing over them. Each write that
     * follows is then reported as {@link replaced} or {@link forget}.
     *
     * All or nothing: when one copy cannot be made, the ones already made are let go and the answer
     * names the asset that failed - and the caller writes over none of them. An asset whose file is
     * already missing has nothing to copy and is left out; its replacement is not one undo can take
     * back, because there was nothing there before it.
     */
    public async keep(assets: readonly AnyAsset[]): Promise<{ ok: true } | ({ ok: false } & AssetKeepFailure)> {
        const fresh: HeldContent[] = [];
        for (const asset of assets) {
            if (this.held.has(asset.id) || fresh.some(entry => entry.assetId === asset.id)) {
                continue;
            }
            const answer = await this.port.keep(asset);
            if ("refusal" in answer) {
                fresh.forEach(entry => this.port.release(entry.type, entry.token));
                return { ok: false, name: asset.name, refusal: answer.refusal };
            }
            if ("token" in answer) {
                fresh.push({ assetId: asset.id, type: asset.type, token: answer.token, live: "before" });
            }
        }
        fresh.forEach(entry => this.held.set(entry.assetId, entry));
        return { ok: true };
    }

    /**
     * The replacement the bytes were copied aside for has been written. Until this is said, the asset
     * still holds the bytes that were copied, and neither undo nor redo touches it.
     */
    public replaced(assetId: string): void {
        const entry = this.held.get(assetId);
        if (entry) {
            entry.live = "after";
        }
    }

    /** The replacement the bytes were copied aside for did not happen: let the copy go. */
    public forget(assetId: string): void {
        const entry = this.held.get(assetId);
        if (entry) {
            this.port.release(entry.type, entry.token);
            this.held.delete(assetId);
        }
    }

    /** Assets the operation brought into the library. Undo takes them out again; redo puts them back. */
    public noteImported(assets: readonly AnyAsset[]): void {
        for (const asset of assets) {
            if (!this.imported.some(entry => entry.assetId === asset.id)) {
                this.imported.push({ type: asset.type, assetId: asset.id, taken: null });
            }
        }
    }

    /**
     * Put back the bytes the operation wrote over, and take its imports out of the library.
     *
     * Throws {@link AssetKeepError} when a file about to be written over could not be copied aside
     * first; nothing has been written then.
     */
    public async undo(): Promise<void> {
        if (this.disposed) {
            return;
        }
        await this.swap("before");
        for (const entry of [...this.imported].reverse()) {
            if (entry.taken !== null) {
                continue;
            }
            const live = this.port.lookup(entry.type, entry.assetId);
            entry.taken = live ? await this.port.takeBack(live) : null;
        }
    }

    /**
     * Put the operation's bytes in again and its imports back. Throws as {@link undo} does, before
     * anything has changed.
     */
    public async redo(): Promise<void> {
        if (this.disposed) {
            return;
        }
        await this.swap("after");
        for (const entry of this.imported) {
            if (entry.taken === null) {
                continue;
            }
            const taken = entry.taken;
            entry.taken = null;
            await this.port.putBack(taken);
        }
    }

    /** Let go of everything held. Called once, when the undo step leaves the stack for good. */
    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        for (const entry of this.held.values()) {
            this.port.release(entry.type, entry.token);
        }
        this.held.clear();
        for (const entry of this.imported) {
            if (entry.taken !== null) {
                this.port.forgetTaken(entry.taken);
                entry.taken = null;
            }
        }
    }

    /**
     * Bring every asset to the `target` side: copy aside what its file holds now, then write in what
     * was held.
     *
     * Every copy is made before any file is written, which is what lets a failed copy stop the step
     * with every asset still as it was. A write that fails after that leaves its asset on the side it
     * was on, with its copy untouched; the asset's own `live` says which side that is, so the next
     * step in either direction treats it correctly.
     */
    private async swap(target: HeldContent["live"]): Promise<void> {
        const moving = [...this.held.values()].filter(entry => entry.live !== target);
        const plan: { entry: HeldContent; asset: AnyAsset; next: string | null }[] = [];
        for (const entry of moving) {
            const asset = this.port.lookup(entry.type, entry.assetId);
            if (!asset) {
                // Gone from the library by some other way than this step. Nothing to write into.
                continue;
            }
            const answer = await this.port.keep(asset);
            if ("refusal" in answer) {
                plan.forEach(step => step.next !== null && this.port.release(step.entry.type, step.next));
                const failure = { name: asset.name, refusal: answer.refusal };
                this.port.report(failure);
                throw new AssetKeepError(failure);
            }
            plan.push({ entry, asset, next: "token" in answer ? answer.token : null });
        }

        for (const { entry, asset, next } of plan) {
            const written = await this.port.write(asset, entry.token);
            if (!written.success) {
                console.warn(`[AssetLibraryChange] could not restore ${asset.name}`, written.error);
                if (next !== null) {
                    this.port.release(entry.type, next);
                }
                continue;
            }
            this.port.release(entry.type, entry.token);
            entry.live = target;
            if (next === null) {
                // The file had gone missing, so there is no other side to hold: this asset leaves
                // the change with the bytes just written.
                this.held.delete(entry.assetId);
            } else {
                entry.token = next;
            }
        }
    }
}
