import type { UIElement } from "@shared/types/ui-editor/document";
import {
    readUIInteractionSoundAssetId,
    type UIInteractionSoundKind,
} from "@shared/types/ui-editor/interactionSounds";
import { resolveNodeStoredAssetSet } from "@/lib/ui-editor/blueprint-nodes/built-in/nodeAssetSets";
import type { UIHostAdapterBlueprintRuntime } from "./types";

/**
 * Play the sound an element was given for a hover or a click.
 *
 * Through the host API's sound family, the path a `Play Sound` node takes, so the clip lands on the
 * same bus (the SFX track, which an unqualified play has always meant), follows the player's sound
 * volume and mute, and carries the in/out marks and gain set on the asset. An editor canvas has no
 * host API and plays nothing; a click there is a selection, not a press.
 *
 * Returns whether the element has a sound for this gesture, whether or not one could be played. That
 * is the question the callers ask: the nearest element with a sound is the one that sounds, and an
 * element whose file has gone missing still claims the gesture - the missing file is reported where
 * every missing asset is, rather than covered by an ancestor's sound the author did not choose.
 *
 * An asset set is answered at the moment of playing, in the player's language, the way a `Play
 * Sound` node answers one: the build writes the set's members onto the element beside the id.
 */
export function playUIElementInteractionSound(
    runtime: Pick<UIHostAdapterBlueprintRuntime, "hostApi"> | undefined,
    element: Pick<UIElement, "props" | "assetVariants"> | null | undefined,
    kind: UIInteractionSoundKind,
): boolean {
    const stored = readUIInteractionSoundAssetId(element, kind);
    if (!stored) {
        return false;
    }
    const sound = runtime?.hostApi?.sound;
    if (!sound) {
        return true;
    }
    const resolved = resolveNodeStoredAssetSet(element ?? undefined, stored);
    const assetId = typeof resolved === "string" && resolved.trim() ? resolved.trim() : stored;
    // Not awaited: the gesture's own handling must not wait on audio, and a clip that cannot be
    // resolved is reported by the transport itself.
    void sound.play({ assetId }).catch(() => undefined);
    return true;
}

type PendingHoverSound = {
    node: Node | null;
    play: () => void;
};

const pendingHoverSounds = new WeakMap<Event, PendingHoverSound[]>();

/**
 * Offer an element's hover sound for one pointer transition; the innermost offer plays.
 *
 * Entering an element enters every ancestor the pointer was not already inside, all on one native
 * event, outermost first - so a card with a hover sound and a button inside it with its own would
 * both sound when the pointer lands on the button from outside the card. Collecting the offers and
 * playing only the deepest keeps one gesture to one sound, the same rule the click walk follows.
 *
 * Settled in a microtask, which runs after every handler of the event and before anything is drawn.
 */
export function offerUIElementHoverSound(nativeEvent: Event, node: Node | null, play: () => void): void {
    const existing = pendingHoverSounds.get(nativeEvent);
    if (existing) {
        existing.push({ node, play });
        return;
    }
    const offers: PendingHoverSound[] = [{ node, play }];
    pendingHoverSounds.set(nativeEvent, offers);
    queueMicrotask(() => {
        pendingHoverSounds.delete(nativeEvent);
        innermostOffer(offers).play();
    });
}

function innermostOffer(offers: PendingHoverSound[]): PendingHoverSound {
    // The offers are all on one path from the entered element to the root, so the innermost is the
    // one every other contains. Without nodes to compare, the last offer made is the innermost,
    // because enter handlers run outermost first.
    let innermost = offers[offers.length - 1];
    for (const offer of offers) {
        if (offer.node && innermost.node && offer.node !== innermost.node && innermost.node.contains(offer.node)) {
            innermost = offer;
        }
    }
    return innermost;
}
