/**
 * What a PSD looks like once Studio has read it, and what the author decided to do with it.
 *
 * Shared because the parse happens in a utility process and the decisions happen in the renderer;
 * only plain data crosses between them.
 */

/** One entry of the PSD's layer tree, geometry only — pixels never cross until a bake is asked for. */
export type PsdLayerNode = {
    /** Position in the tree, top-level first. Stable across re-imports; this is the reconnect key. */
    path: string[];
    name: string;
    /** Absent for a group. Document coordinates. */
    bounds?: { left: number; top: number; right: number; bottom: number };
    /** Photoshop's name for the mode, `normal` when it is the plain stack. */
    blendMode: string;
    opacity: number;
    hidden: boolean;
    /** True when Photoshop clips this layer to the one below it. */
    clipping: boolean;
    children?: PsdLayerNode[];
};

export type PsdDocument = {
    width: number;
    height: number;
    fileName: string;
    layers: PsdLayerNode[];
};

/**
 * What to do with a layer whose blend mode the engine cannot reproduce.
 *
 * The engine draws a plain stack, so a `multiply` layer imported as-is would look wrong in the game
 * and right in Photoshop. The plan forbids importing it silently: the author picks. `merge` flattens
 * it down onto the layer below (which is what Photoshop shows), `skip` leaves it out.
 */
export type BlendResolution = "merge" | "skip";

/**
 * A layer flattened onto another during the bake, with its own blend mode.
 *
 * `clip` is Photoshop's clipping mask: the source is restricted to the target layer's own alpha
 * before it is composited, so a blush clipped to a face stops at the edge of the face. It is not the
 * author's choice — the PSD says so — which is why it rides along with the merge rather than being
 * one more thing the wizard asks about.
 */
export type PsdMergeSource = {
    path: string[];
    clip?: boolean;
};

/**
 * One output layer. `mergeFrom` are layers flattened onto this one, bottom first, each combined with
 * its own blend mode — which is what makes a `multiply` shadow survive an import into an engine that
 * only stacks.
 */
export type PsdBakeTarget = {
    path: string[];
    mergeFrom?: PsdMergeSource[];
    /**
     * What to call the baked file, before sanitising. The asset library takes an asset's name from
     * the file it imported, so this is where `<character>_<layer>_<tag>` gets decided — the Photoshop
     * layer name alone would land a stack of "Happy.png"s in the library with nothing to tell them
     * apart. A file name, never a path: the output directory stays the main process's business.
     */
    name?: string;
};

export type PsdBakeRequest = {
    filePath: string;
    layers: PsdBakeTarget[];
};

/** What the main process adds before handing the request to the worker. */
export type PsdBakeJob = PsdBakeRequest & {
    /** Where the baked PNGs are written. Chosen by the main process; the renderer never names a path. */
    outputDir: string;
};

export type PsdBakedLayer = {
    path: string[];
    name: string;
    /**
     * Where the baked PNG was written: full document size, contents at their document position.
     *
     * A path rather than the bytes, because a six-layer character sheet is a hundred megabytes of
     * PNG to push through IPC — and because it lets the import reuse the asset library's own
     * file-import pipeline instead of growing a second way to make an asset.
     */
    filePath: string;
};

/**
 * Where one PSD layer ended up in the character. The layer path is the reconnect key: it survives
 * everything the author can do in Studio afterwards, because Studio renames ids-first and never
 * writes back to the PSD.
 */
export type PsdFingerprintSlot = {
    path: string[];
    /** The Studio layer this PSD layer feeds. */
    layerId: string;
    /** The tag it feeds, when that layer is bound to an axis. Absent for a constant layer. */
    tagId?: string;
};

/**
 * Enough to recognise the same PSD again without keeping it. The plan is explicit that Studio does
 * not hold on to the file — this is what lets a re-import reconnect to the layers it already made.
 *
 * `slots` is the mapping memory, and it is the whole reason this record exists: a second import of
 * the same PSD refreshes the art in place, leaving the author's renames, stack order and axis
 * bindings alone. Without it a re-import could only mean "build it all again".
 */
export type PsdFingerprint = {
    fileName: string;
    width: number;
    height: number;
    slots: PsdFingerprintSlot[];
    importedAt: number;
};
