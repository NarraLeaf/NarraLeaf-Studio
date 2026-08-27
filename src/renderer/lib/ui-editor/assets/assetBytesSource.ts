/**
 * The seam a historical render resolves its pictures through.
 *
 * ## Why this exists
 *
 * Every visual in Studio reaches its bytes through `useAssetObjectUrl`, which reads `AssetsService`
 * off the LIVE workspace and mints an object URL over the file on disk right now. A version-control
 * comparison renders documents as they stood at an earlier version - but every image, video, font
 * and clip inside that render is today's. It is a confident wrong answer, with nothing on screen to
 * say so. This module is the contract that lets a caller say "resolve these against THAT version
 * instead", without a single consumer of the hook changing.
 *
 * ## Why the read is a plain function and not a hook
 *
 * A source is a context value, and a context value can be swapped while the tree beneath it stays
 * mounted - a comparison surface stepping from one version to another does exactly that. If the
 * value carried a hook, calling it from a widget would make that widget's hook count depend on
 * which source happens to be mounted, and React tears the whole tree down the moment the count
 * changes ("rendered more hooks than during the previous render"). A plain async function has no
 * such coupling: it is called from an effect, never from a render.
 *
 * ## Why it hands back bytes and not a URL
 *
 * `useAssetObjectUrl` owns `URL.createObjectURL` and the matching `revokeObjectURL`, and it has to
 * go on owning both: it revokes on replacement and again on unmount. A second minter would either
 * leak the blob for the life of the window or revoke one the hook still has on screen. So a source
 * hands over bytes plus the media type it believes they are, and the hook does the rest.
 *
 * ## What is mounted today
 *
 * Nothing. The context default is `null`, meaning "resolve live, exactly as before", and no
 * provider exists yet - so this module changes no behaviour anywhere, in Studio or in a packaged
 * game. A later change supplies a source backed by an actual version.
 *
 * ## Why it lives here and not in `@shared`
 *
 * The game runtime bundles part of the Studio renderer and refuses most of the rest at the esbuild
 * step, but that gate only inspects `@/apps` and `@/lib` specifiers - `@shared` is never looked at
 * at all, and the runtime tsconfig compiles the whole of it. A contract parked there would cross
 * the boundary silently, which is the exact hazard this repository keeps re-discovering. Here, the
 * gate sees it.
 */

import { createContext, useContext } from "react";

/**
 * Which library pool an id is looked up in, as a bare string.
 *
 * The workspace hook names its pools with an enum (`AssetType`) defined in a workspace service
 * module this file may not import - the runtime boundary refuses that path. The enum's members are
 * strings, so its values arrive here unchanged and a source that cares can compare against them.
 */
export type AssetBytesPool = string;

/**
 * What a source answers with.
 *
 * The two refusals are separate members on purpose. "The project had no such asset at that
 * version" is a fact about the version - a picture added last week is genuinely absent from last
 * month's tree, and the surface should say so plainly rather than imply a fault. "The read failed"
 * IS a fault: an unreadable pack, a corrupt object, a revision that no longer resolves. Collapsing
 * the two into `null` - which is all the live ladder can do today - throws the distinction away at
 * the one point where it is still known.
 */
export type AssetBytesResult =
    | {
        readonly kind: "bytes";
        readonly bytes: Uint8Array;
        /**
         * The MIME type the source believes the bytes are, or `null` when it cannot tell. Passed to
         * `Blob` so the object URL the hook mints is typed.
         */
        readonly mediaType: string | null;
    }
    | { readonly kind: "absent" }
    | {
        readonly kind: "failed";
        /**
         * Diagnostic detail, in the same register as the untranslated strings the live ladder
         * already puts in the hook's `error` field. Not a localised message.
         */
        readonly reason: string;
    };

/**
 * A resolver for asset bytes as of some particular version of the project.
 */
export interface AssetBytesSource {
    /**
     * What this source resolves against, as a stable string - a version hash, a snapshot id.
     *
     * `useAssetObjectUrl` keys its effect on this rather than on the object, so a provider that
     * rebuilds its value every render does not restart every fetch on the surface. Two sources
     * sharing an id must answer identically; change the id when the version changes.
     */
    readonly id: string;

    /**
     * Read one asset's bytes as of this source's version.
     *
     * Takes the id the caller asked for, untouched - including an asset SET id, which the source
     * resolves itself, because which file a set answers with is a function of the tags at that
     * version and not of the tags today.
     *
     * A plain async function, not a hook: see the note at the top of this file.
     */
    read(assetId: string, pool: AssetBytesPool): Promise<AssetBytesResult>;
}

/**
 * `null` means "resolve live", which is every surface in Studio today.
 */
export const AssetBytesSourceContext = createContext<AssetBytesSource | null>(null);

/**
 * The source in force for this part of the tree, or `null` when there is none.
 */
export function useAssetBytesSource(): AssetBytesSource | null {
    return useContext(AssetBytesSourceContext);
}
