/**
 * Synchronous "which file does this set mean, right now" for a mounted game.
 *
 * A story row carries its own answer, written into the row when the package was assembled. Nothing
 * else can: a character's sprite belongs to the character rather than to a row, a widget's picture
 * is a prop at an arbitrary depth of the UI document, and a blueprint hands a widget an asset id
 * while the game is running. Those read the table the package carries (`bundle.assetSets`), and this
 * is where they read it.
 *
 * Registered rather than passed, for the reason the avatar table above it is registered: the places
 * that resolve an asset id are ordinary hooks inside widget renderers, several layers below anything
 * holding a bundle, and threading a table through every one of them would put a build concern in the
 * signature of every widget.
 *
 * **Synchronous, and it must stay so.** A widget resolves its picture during a render, and the whole
 * point of resolving here rather than at the id → URL hop is that the answer is a map read.
 *
 * Lifetime is the mounted session's: a remount re-registers, and a game with no sets clears the
 * table rather than leaving the previous project's answers resolvable.
 */

import { resolveShippedAssetSetMember, type ShippedAssetSetTable } from "@shared/build/assetSetTable";

type Registration = {
    table: ShippedAssetSetTable;
    /**
     * The language the player is in, read at CALL time.
     *
     * A function rather than a value because a locale change does not remount this: the game reads
     * the player's stored language reactively, and a captured string would keep answering with the
     * language the session started in - which shows up as one picture in the old language on a stage
     * that has otherwise changed.
     */
    getLocale: () => string | undefined;
    sourceLocale?: string;
};

let registration: Registration | null = null;

/** Publish this session's table. Pass null when a session with no sets mounts, which clears it. */
export function registerAssetSetTable(next: Registration | null): void {
    registration = next && Object.keys(next.table).length > 0 ? next : null;
}

/**
 * The member this id resolves to, or null when it is not a set this game carries answers for.
 *
 * Null is the common case by a wide margin - every ordinary asset id - so callers use it as a
 * pass-through: `resolveMountedAssetSetMember(id) ?? id`.
 */
export function resolveMountedAssetSetMember(assetId: string | null | undefined): string | null {
    if (!assetId || !registration) {
        return null;
    }
    return resolveShippedAssetSetMember(
        registration.table,
        assetId,
        registration.getLocale(),
        registration.sourceLocale,
    );
}

export function clearAssetSetTable(): void {
    registration = null;
}
