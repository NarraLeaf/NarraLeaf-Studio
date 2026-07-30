/**
 * Mounting a Surface puppet widget's model — the packaged-game half of the seam.
 *
 * This file *replaces* `@/lib/workspace/hooks/useSurfacePuppetSession` in the runtime bundle. The
 * substitution is an esbuild `onResolve` alias registered in `runtimeAliasPlugin`
 * (`project/build/build-runtime.js`), which maps that exact specifier onto this path; the same
 * mechanism serves `useAssetObjectUrl` and every other shim beside this one. A widget renderer imports
 * the workspace path in both hosts and never learns which one it got.
 *
 * The editor reaches a model through `Services.PuppetDescription`, which resolves a project directory
 * and mints filesystem grants. A game has no workspace services and no project directory — it has a
 * pack, which already carries both halves: the author's runtime modules (published by
 * `copyPuppetRuntimes`) and every file of every model bundle. So this resolves both from the pack and
 * mounts with `puppetModelSession` directly.
 *
 * Nothing here names a renderer and nothing here may — card 2026-07-27-002.
 */

import { useEffect, useMemo, useState } from "react";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";
import { getGameRuntimeBridge } from "@/lib/ui-editor/runtime/gameRuntimeBridge";
import { createPuppetModelSession } from "@/lib/ui-editor/runtime/game/puppetModelSession";
import { resolveBundleEntry } from "@/lib/ui-editor/runtime/game/storyCompiler";
import {
    SurfacePuppetUnavailableError,
    type SurfacePuppetOpener,
    type SurfacePuppetSessionState,
} from "@/lib/ui-editor/runtime/game/surfacePuppetSession";
import {
    useSurfacePuppetMount,
    type UseSurfacePuppetSessionInput,
} from "@/lib/ui-editor/runtime/game/useSurfacePuppetMount";
import { findPackPuppetBackendSource, resolvePackModelBundleUrl } from "../puppetPackRuntimes";

export type { UseSurfacePuppetSessionInput };

/**
 * The pack, once per window.
 *
 * `GameRuntimeApp` holds it in React state, and a widget renderer is nowhere near that state — it is
 * mounted deep inside a `GameApp` surface tree that knows nothing about the shell. Rather than thread
 * it down (or have the shell write a module-level registry that would then have to be kept in step with
 * every relaunch), the pack is re-read here and memoised: `readPack()` is a pure read of a file the
 * shell already served, and it happens at most once per window.
 */
let packPromise: Promise<GameRuntimePackV1 | null> | null = null;

function readPackOnce(): Promise<GameRuntimePackV1 | null> {
    if (!packPromise) {
        const bridge = getGameRuntimeBridge();
        packPromise = bridge
            // A pack that cannot be read is not this widget's failure to report - the shell has
            // already put that on screen - so it degrades to "no runtimes published".
            ? bridge.readPack().catch(() => null)
            : Promise.resolve(null);
    }
    return packPromise;
}

/** Test seam: the module-level memo would otherwise leak one test's pack into the next. */
export function __resetSurfacePuppetPackCache(): void {
    packPromise = null;
}

export function useSurfacePuppetSession(input: UseSurfacePuppetSessionInput): SurfacePuppetSessionState {
    const [pack, setPack] = useState<GameRuntimePackV1 | null>(null);

    useEffect(() => {
        let cancelled = false;
        void readPackOnce().then(value => {
            if (!cancelled) {
                setPack(value);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const opener = useMemo<SurfacePuppetOpener | null>(() => {
        if (!pack) {
            // Not an error state: the pack is still being read, and the mount machine reports
            // `unmounted` until an opener exists. One extra render, no half-built model.
            return null;
        }
        const bridge = getGameRuntimeBridge();
        return async ({ request, container, size, onWarn }) => {
            const source = findPackPuppetBackendSource(bridge, pack, request.backend);
            if (!source) {
                // The exact condition the engine calls `missing-backend`: the box is there, nothing
                // answers to its backend name. A game published without the author's runtime draws
                // nothing and keeps running.
                throw new SurfacePuppetUnavailableError(
                    "backend-missing",
                    `No puppet runtime named "${request.backend}" was published with this game`,
                );
            }
            const bundleUrl = request.assetId
                ? resolvePackModelBundleUrl(bridge, pack, request.assetId)
                : null;
            if (!bundleUrl) {
                throw new SurfacePuppetUnavailableError(
                    "no-model",
                    `Model bundle ${request.assetId ?? "(none)"} is not in this game`,
                );
            }
            const override = request.entry?.trim() ?? "";
            return createPuppetModelSession({
                container,
                source,
                backend: request.backend,
                src: override ? resolveBundleEntry(bundleUrl, override) : bundleUrl,
                options: request.options ?? {},
                size,
                onWarn: warning => onWarn(warning.message),
            });
        };
    }, [pack]);

    return useSurfacePuppetMount(opener, input);
}

/**
 * The guard the shim mechanism itself cannot provide.
 *
 * `tsc` type-checks this file and the workspace hook as two unrelated modules — the runtime tsconfig
 * maps `@/*` onto the real renderer tree, so it never learns that one displaces the other — which means
 * a signature change on either side compiles clean today and only surfaces as a broken widget in a
 * shipped game. None of the other shims beside this one carry such a check.
 *
 * **Both directions, and that is not belt-and-braces.** A one-way assignment proves almost nothing
 * here: TypeScript happily assigns a function that takes fewer parameters to a type that takes more,
 * so `shim -> workspace` alone stays green after the workspace hook grows a required argument the shim
 * never learned about — which is exactly the drift worth catching. Mutual assignability is what pins
 * the two shapes together.
 *
 * `import type` is erased before esbuild resolves anything, so the runtime bundle still contains none
 * of the workspace module; the build verifies that (`puppetDescription` appears nowhere in
 * `dist/runtime/renderer.js`).
 */
import type { useSurfacePuppetSession as WorkspaceUseSurfacePuppetSession } from "@/lib/workspace/hooks/useSurfacePuppetSession";
const _shimSatisfiesWorkspace: typeof WorkspaceUseSurfacePuppetSession = useSurfacePuppetSession;
const _workspaceSatisfiesShim: typeof useSurfacePuppetSession =
    null as unknown as typeof WorkspaceUseSurfacePuppetSession;
void _shimSatisfiesWorkspace;
void _workspaceSatisfiesShim;
