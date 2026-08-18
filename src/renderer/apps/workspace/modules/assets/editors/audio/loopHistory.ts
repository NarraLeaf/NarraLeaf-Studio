import { normalizeAudioClipRegion } from "@shared/types/audio";
import type { AssetAudioLoop, AssetExtras } from "@/lib/workspace/services/assets/types";

/**
 * The audio preview's in, loop and out points: what they mean, and the moves over them.
 *
 * The preview is read-only over the samples, so this region is the *only* authored state it has -
 * which is why it once carried its own `{past, present, future}` reducer. Undo now lives where every
 * other editor's does (`HistoryService`, scope `audio-loop:<assetId>`); what is left here is the
 * region itself and the rules about what a legal region is.
 *
 * Pure by construction - no React, no services, no time source. That is what makes the marker
 * ordering rules below testable on their own.
 */

/** Which marker a gesture or command is about. */
export type LoopMarker = "in" | "loop" | "out";

/** The three markers in milliseconds; `null` means that one has not been marked. */
export interface LoopPoints {
  inMs: number | null;
  /** Where each repeat returns to. `null` falls back to {@link inMs} - a plain loop. */
  loopStartMs: number | null;
  outMs: number | null;
}

export const EMPTY_LOOP: LoopPoints = { inMs: null, loopStartMs: null, outMs: null };

export function sameLoop(a: LoopPoints, b: LoopPoints): boolean {
  return a.inMs === b.inMs && a.loopStartMs === b.loopStartMs && a.outMs === b.outMs;
}

export function fromAssetLoop(loop: AssetAudioLoop | undefined): LoopPoints {
  return {
    inMs: loop?.inMs ?? null,
    loopStartMs: loop?.loopStartMs ?? null,
    outMs: loop?.outMs ?? null
  };
}

/** The marker's own value, so callers do not repeat the three-way branch. */
export function loopPointAt(loop: LoopPoints, marker: LoopMarker): number | null {
  return marker === "in" ? loop.inMs : marker === "loop" ? loop.loopStartMs : loop.outMs;
}

/**
 * The stored region, falling back to the cue-point list that preceded it.
 *
 * Delegates to the shared normalizer rather than reading `extras` itself: the game bundle reduces
 * the same records through the same function, so a clip cannot loop one way in this preview and
 * another way in the running game.
 */
export function fromAssetExtras(extras: AssetExtras | undefined): LoopPoints {
  return fromAssetLoop(normalizeAudioClipRegion(extras) ?? undefined);
}

/** Back to the stored shape, or `undefined` when nothing is marked so the key leaves the record. */
export function toAssetLoop(loop: LoopPoints): AssetAudioLoop | undefined {
  if (loop.inMs === null && loop.loopStartMs === null && loop.outMs === null) {
    return undefined;
  }
  return {
    ...(loop.inMs !== null ? { inMs: loop.inMs } : {}),
    ...(loop.outMs !== null ? { outMs: loop.outMs } : {}),
    ...(loop.loopStartMs !== null ? { loopStartMs: loop.loopStartMs } : {})
  };
}

/**
 * Mark one marker, dropping any other the new position would put out of order.
 *
 * The three have to read `in <= loop < out`; anything else describes nothing playable. Silently
 * swapping them would move a marker the author did not touch, so the stale ones are cleared
 * instead - that says what happened, and leaves the marker just placed exactly where it was put.
 *
 * The loop point may sit *on* the in point (that is a plain loop, the pre-loop-point behaviour),
 * which is why its comparisons against the in point are the inclusive ones.
 */
export function markPoint(loop: LoopPoints, marker: LoopMarker, timeMs: number): LoopPoints {
  if (marker === "in") {
    return {
      inMs: timeMs,
      loopStartMs:
        loop.loopStartMs !== null && loop.loopStartMs >= timeMs ? loop.loopStartMs : null,
      outMs: loop.outMs !== null && loop.outMs > timeMs ? loop.outMs : null
    };
  }
  if (marker === "loop") {
    return {
      inMs: loop.inMs !== null && loop.inMs <= timeMs ? loop.inMs : null,
      loopStartMs: timeMs,
      outMs: loop.outMs !== null && loop.outMs > timeMs ? loop.outMs : null
    };
  }
  return {
    inMs: loop.inMs !== null && loop.inMs < timeMs ? loop.inMs : null,
    loopStartMs: loop.loopStartMs !== null && loop.loopStartMs < timeMs ? loop.loopStartMs : null,
    outMs: timeMs
  };
}

export function clearPoint(loop: LoopPoints, marker: LoopMarker): LoopPoints {
  if (marker === "in") {
    return { ...loop, inMs: null };
  }
  return marker === "loop" ? { ...loop, loopStartMs: null } : { ...loop, outMs: null };
}
