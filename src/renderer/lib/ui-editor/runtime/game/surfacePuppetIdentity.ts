/**
 * When a Surface puppet widget is looking at a *different model*, and when it is merely posed
 * differently.
 *
 * The distinction is the whole reason this file exists, and getting it wrong is expensive in both
 * directions. A puppet cannot change its `src` — the engine says so outright — so a different model
 * means tearing down a WebGL context and building another. A different *pose* is one `apply()` on the
 * instance already up. Treat a pose change as an identity change and every keystroke in the inspector
 * reloads a multi-megabyte skeleton; treat an identity change as a pose change and the widget keeps
 * drawing the previous model.
 *
 * Both hosts' hooks receive freshly-built `state` and `size` objects on every render, so neither can be
 * used as a React dependency directly. Hence value comparison here rather than reference comparison
 * there.
 */

import type { PuppetSize, PuppetState } from "narraleaf-react";
import { encodeStableJson } from "@shared/utils/stableJson";
import type { SurfacePuppetRequest } from "./surfacePuppetSession";

/**
 * Which model, drawn by which runtime, as one comparable string.
 *
 * `options` is in it because it is handed to the backend at mount time and a backend is free to load
 * different files for different options — the same reason `puppetDescriptionKey` includes it. It is
 * stringified stably rather than compared field-wise because its contents are the author's and
 * arbitrary.
 */
export function surfacePuppetIdentity(request: SurfacePuppetRequest): string {
  return encodeStableJson({
    assetId: request.assetId ?? null,
    backend: request.backend,
    entry: request.entry ?? null,
    options: request.options ?? {}
  });
}

function sameRecord<T>(left: Record<string, T>, right: Record<string, T>): boolean {
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) {
    return false;
  }
  for (const key of keys) {
    // `in` rather than a truthiness check: `slots` uses an explicit `null` to mean "cleared", and a
    // key present-with-null is a different state from a key that was never set.
    if (!(key in right) || left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}

/**
 * Whether two complete states would pose a model identically.
 *
 * Purpose-built rather than a generic deep-equal: the shape is fixed and shallow (three nullable names
 * plus two flat records of primitives), and this repo's generic `deepEqual` is known to swallow changes
 * in value types it does not enumerate. There is nothing here it could swallow, and nothing here that
 * needs it.
 */
export function surfacePuppetStateEquals(left: PuppetState, right: PuppetState): boolean {
  return (
    left.motion === right.motion &&
    left.expression === right.expression &&
    left.skin === right.skin &&
    sameRecord(left.params ?? {}, right.params ?? {}) &&
    sameRecord(left.slots ?? {}, right.slots ?? {})
  );
}

export function surfacePuppetSizeEquals(left: PuppetSize, right: PuppetSize): boolean {
  return left.width === right.width && left.height === right.height;
}
