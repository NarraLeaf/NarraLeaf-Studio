/**
 * Handing an asset's bytes from one workspace window to another.
 *
 * Studio opens one project per window, and a window may read only its own project directory. Story
 * rows copied out of project A and pasted into project B therefore reference files that B's
 * renderer is not allowed to open. What crosses the clipboard is a *manifest* of those files plus a
 * token; the bytes never travel with it, and neither do the paths.
 *
 * ## Why the token has to be recorded rather than derived
 *
 * A token is a capability grant, not an address. It is minted from `crypto.randomBytes(32)`, so
 * nothing about the files is recoverable from the string by any amount of work. The mapping from
 * token to paths is *recorded* in the main process at the one instant both halves of it are true:
 * when the offering window has just proved it may read every file in the manifest. Only a
 * successful redeem tells the pasting window where those files are.
 *
 * ## What would make it lie
 *
 *  - **Persisting the table.** Offers are held in memory by one Studio process, and die with the
 *    window that made them. A token that survived a restart would answer for a grant that no longer
 *    exists, and a token minted by a second running instance is simply unknown to this one. Both
 *    degrade the same way: the manifest is unavailable, the paste keeps its rows, and the files it
 *    could not import surface as reference errors the author can act on. Unavailability is an
 *    ordinary outcome, never a failure.
 *  - **Checking at redeem instead of at offer.** The question a grant answers is whether the
 *    *source* window may read the file, and the source window is the one that closes while the
 *    clipboard lives on. It is asked once, before the token exists.
 *  - **Offering part of a manifest.** The pasting side cannot tell a short manifest from a complete
 *    one, so a manifest that cannot be honoured whole is not offered at all.
 *
 * ## Directory-backed assets
 *
 * A model bundle's payload is a directory: its manifest, textures and motions all live below the
 * path the library records. Such an entry says so - {@link AssetTransferManifestEntry.isDirectory} -
 * and the grant minted for it is recursive, so a redeem reaches the tree rather than only its root.
 * The offer is checked recursively to match: a window may hand out a subtree only where it holds a
 * recursive grant over it, so an offer never reaches further than the window that made it.
 */

/** What the clipboard says about one file: enough to describe it, never where it is. */
export interface AssetTransferManifestEntry {
    /**
     * The asset's id in the source project, which the importing project reuses.
     *
     * Reusing it is what lets the rows that travelled alongside keep pointing at their files
     * without being rewritten, and it makes a second paste of the same clipboard a no-op: the id
     * is already in the library, so there is nothing to import.
     */
    assetId: string;
    /** Author-facing file name, extension included: what the file is called once imported. */
    fileName: string;
    /**
     * The `AssetType` value as a string.
     *
     * Structural for the reason `assetSet.ts` gives for the same field: the enum lives under the
     * renderer and cannot be imported here.
     */
    type: string;
    /** Size in bytes, when the offering side already knew it. */
    size?: number;
    /**
     * Whether the payload is a directory rather than a single file.
     *
     * True for model bundles, the one asset type whose contents are a tree. It decides both halves
     * of the transfer: the grant covering the entry reaches everything below the path, and the
     * importing project copies the tree instead of writing bytes.
     */
    isDirectory?: boolean;
}

/** A manifest entry once a token has been honoured: the same description plus where to read it. */
export interface AssetTransferEntry extends AssetTransferManifestEntry {
    /** Absolute path in the source project. Known to the main process from the offer onwards. */
    sourcePath: string;
}

/** Why an offer was not taken. Each one refuses the whole manifest, never part of it. */
export type AssetTransferRefusal =
    /** The calling window's type does not take part in asset transfer. */
    | "not-permitted"
    /** An entry did not describe a file: no id, no name, or a path that is not absolute. */
    | "invalid-entry"
    /**
     * An entry named a file the offering window may not read - or, for a directory entry, a tree it
     * may not read all of.
     */
    | "unreadable"
    /** An entry named Studio's own application storage. */
    | "protected"
    /** There was nothing to offer. */
    | "empty";

export type AssetTransferOfferResult =
    | { offered: true; token: string }
    | { offered: false; reason: AssetTransferRefusal };

/**
 * `available: false` with `unknown-token` is the expected answer whenever the offering window has
 * closed or the copy came from another Studio process, and callers treat it as "rows only".
 */
export type AssetTransferRedeemResult =
    | { available: true; entries: AssetTransferEntry[] }
    | { available: false; reason: "unknown-token" | "not-permitted" };
