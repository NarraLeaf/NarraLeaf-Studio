import { encodeCanonicalJson } from "@shared/documents/canonicalJson";
import { fnv1a64BytesHex } from "@shared/utils/contentHash";
import type { StoryScene } from "@shared/types/story";

/**
 * A short, order-independent fingerprint of one scene's content.
 *
 * **What it is for is disagreement, not change detection.** Every machine in a live session applies
 * the same operations in the same order and should therefore hold the same scene; a digest that
 * differs from the host's means one of them is wrong, and neither can tell which. That is the most
 * expensive way this design can fail - two documents that differ, each saved into its own version
 * history, with nothing anywhere reporting a problem - so a guest that computes a different digest
 * leaves the session and says so rather than carrying on.
 *
 * Built on the canonical encoder because the comparison has to survive key order: two copies of one
 * scene may have been built by different code paths, and `JSON.stringify` would call them different
 * for no reason anybody could act on. Sixty-four bits rather than thirty-two for the reason the
 * hashing module gives: this guards a decision, and at thirty-two bits a collision is a coin flip
 * over a few tens of thousands of edits - here a collision means the guard stays quiet while two
 * documents drift.
 */
export function sceneDigest(scene: StoryScene): string {
    return fnv1a64BytesHex(new TextEncoder().encode(encodeCanonicalJson(contentOf(scene))));
}

/**
 * The scene without the bookkeeping each machine writes for itself.
 *
 * `meta` holds when the scene was last touched, and it is stamped from the clock of whichever
 * machine did the touching - so two machines that applied the same operation to the same scene hold
 * two different timestamps and agree about everything that matters. Hashing it would make a rename
 * eject every guest in the room, every time, over a difference that says nothing about the text.
 *
 * Everything else stays in, including the parts that look like bookkeeping and are not: a block's
 * `diagnosticsMeta` is where an imported line came from, which travels with the line and is the same
 * on every machine that received it.
 */
function contentOf(scene: StoryScene): Omit<StoryScene, "meta"> {
    const { meta: _meta, ...content } = scene;
    return content;
}
