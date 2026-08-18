/**
 * The React half of the Surface puppet seam, written once for both hosts.
 *
 * `useSurfacePuppetSession` exists in two copies — one per host, swapped at build time (see
 * `surfacePuppetSession.ts` for the mechanism) — and the *only* thing that legitimately differs
 * between them is how a session comes into being. So the copies are ~25 lines each and everything
 * they would otherwise both have to get right (mount keying, teardown ordering, carrying pose and box
 * changes to a live instance) is here, in the shared tree, tested once.
 */

import { useEffect, useRef, useState } from "react";
import type { PuppetSize, PuppetState } from "narraleaf-react";
import {
  SurfacePuppetMount,
  UNMOUNTED_SURFACE_PUPPET,
  type SurfacePuppetOpener,
  type SurfacePuppetRequest,
  type SurfacePuppetSessionState,
  type SurfacePuppetSnapshot
} from "./surfacePuppetSession";
import { surfacePuppetIdentity } from "./surfacePuppetIdentity";

export interface UseSurfacePuppetSessionInput {
  /** The widget's box. The model draws into a child of it, created fresh per mount attempt. */
  host: HTMLElement | null;
  /** Null, or one with no asset/backend yet, leaves the box empty and reports `missing-backend`. */
  request: SurfacePuppetRequest | null;
  /** The complete state, always — never a patch. See {@link SurfacePuppetMount.apply}. */
  state: PuppetState;
  size: PuppetSize;
  /**
   * False holds the mount off without changing anything else.
   *
   * Each mounted model is one WebGL context and a browser grants roughly sixteen, so a canvas with a
   * dozen model widgets has to be able to say "not this one, not yet" — offscreen, or not selected.
   * Flipping it back mounts, using whatever state and size arrived in the meantime.
   */
  enabled?: boolean;
  /** Backend `warn()` output and teardown trouble. Advisory: none of it changes the status. */
  onWarn?: (message: string) => void;
}

export function useSurfacePuppetMount(
  /**
   * Null means no arm of the chain in `surfacePuppetHosts.ts` can look a runtime up in this window.
   * The mount machine reports that as `missing-backend`, not as `unmounted` — the difference is
   * "nothing can draw this" versus "the host chose not to draw it yet", and only the second is a
   * decision a widget made.
   */
  opener: SurfacePuppetOpener | null,
  input: UseSurfacePuppetSessionInput
): SurfacePuppetSessionState {
  const { host, request, state, size, enabled = true, onWarn } = input;
  const [snapshot, setSnapshot] = useState<SurfacePuppetSnapshot>(UNMOUNTED_SURFACE_PUPPET);
  const mountRef = useRef<SurfacePuppetMount | null>(null);

  // Read through a ref so a re-pose or a resize cannot re-key the mount: a puppet cannot change its
  // `src` (the engine says so outright), so a new model is a new instance while a new pose is an
  // `apply` on the instance already up.
  const latest = useRef({ request, state, size, onWarn });
  latest.current = { request, state, size, onWarn };

  // "" whenever there is nothing to mount, so the effect below does not even build a machine for a
  // widget the author has not configured.
  const mountKey = request && enabled ? surfacePuppetIdentity(request) : "";

  useEffect(() => {
    // `opener` is deliberately absent from this test: a null one still builds a machine, which
    // reports `missing-backend` for a configured widget nothing in this window can draw.
    if (!host || !mountKey) {
      setSnapshot(UNMOUNTED_SURFACE_PUPPET);
      return;
    }
    const mount = new SurfacePuppetMount({
      host,
      open: opener,
      onChange: setSnapshot,
      onWarn: (message) => latest.current.onWarn?.(message)
    });
    mountRef.current = mount;
    mount.mount(latest.current.request, latest.current.state, latest.current.size);
    return () => {
      mount.dispose();
      if (mountRef.current === mount) {
        mountRef.current = null;
      }
    };
    // `request` / `state` / `size` are read through `latest` on purpose - `mountKey` is what
    // identifies a model, and the two effects below carry pose and box changes to the live instance.
  }, [host, opener, mountKey]);

  // Separate effects rather than one: the effect above must not re-run when the pose changes, and
  // these must. Both no-op on an unchanged value (compared by value, not by reference - a caller
  // builds these objects fresh every render).
  useEffect(() => {
    mountRef.current?.apply(state);
  }, [state]);

  useEffect(() => {
    mountRef.current?.resize(size);
  }, [size]);

  return {
    ...snapshot,
    mounted: snapshot.status === "ready" || snapshot.status === "loading"
  };
}
