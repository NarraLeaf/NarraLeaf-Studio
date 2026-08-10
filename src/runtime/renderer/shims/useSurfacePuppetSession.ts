/**
 * Mounting a Surface puppet widget's model — the packaged-game copy of the hook.
 *
 * This file *replaces* `@/lib/workspace/hooks/useSurfacePuppetSession` in the runtime bundle. The
 * substitution is an esbuild `onResolve` alias registered in `runtimeAliasPlugin`
 * (`project/build/build-runtime.js`), which maps that exact specifier onto this path; the same mechanism
 * serves `useAssetObjectUrl` and every other shim beside this one. A widget renderer imports the
 * workspace path in both hosts and never learns which one it got.
 *
 * ## Why this file is one line of logic
 *
 * Because the difference between the hosts is exactly one arm of the resolution chain, and no more. The
 * whole order — workspace services, else the Dev Mode registry, else the packaged bridge, else a quiet
 * `missing-backend` — lives in `surfacePuppetHosts.ts` and is shared. This copy exists only because the
 * workspace copy imports `@/apps/workspace/context` and `@/lib/workspace/services`, which the runtime
 * bundle's import guard rejects; passing `null` for that arm is the entire distinction.
 *
 * Anything more here would be a second implementation of the order, in the one place the type checker
 * cannot compare it against the first — see the guard at the bottom.
 *
 * Nothing here names a renderer and nothing here may.
 */

import { useSurfacePuppetOpener } from "@/lib/ui-editor/runtime/game/surfacePuppetHosts";
import type { SurfacePuppetSessionState } from "@/lib/ui-editor/runtime/game/surfacePuppetSession";
import {
    useSurfacePuppetMount,
    type UseSurfacePuppetSessionInput,
} from "@/lib/ui-editor/runtime/game/useSurfacePuppetMount";

export type { UseSurfacePuppetSessionInput };

export function useSurfacePuppetSession(input: UseSurfacePuppetSessionInput): SurfacePuppetSessionState {
    // No workspace services in a packaged game, so the first arm declines and the chain falls through to
    // the pack. The Dev Mode arm is never installed here, which costs one null check.
    return useSurfacePuppetMount(useSurfacePuppetOpener(null), input);
}

/**
 * The guard the shim mechanism itself cannot provide.
 *
 * `tsc` type-checks this file and the workspace hook as two unrelated modules — the runtime tsconfig maps
 * `@/*` onto the real renderer tree, so it never learns that one displaces the other — which means a
 * signature change on either side compiles clean today and only surfaces as a broken widget in a shipped
 * game. None of the other shims beside this one carry such a check.
 *
 * **Both directions, and that is not belt-and-braces.** A one-way assignment proves almost nothing here:
 * TypeScript happily assigns a function that takes fewer parameters to a type that takes more, so
 * `shim -> workspace` alone stays green after the workspace hook grows a required argument the shim never
 * learned about — which is exactly the drift worth catching. Mutual assignability is what pins the two
 * shapes together; it was verified by giving the workspace hook an extra parameter and watching this fail.
 *
 * `import type` is erased before esbuild resolves anything, so the runtime bundle still contains none of
 * the workspace module; the build verifies that (`puppetDescription` appears nowhere in
 * `dist/runtime/renderer.js`).
 */
import type { useSurfacePuppetSession as WorkspaceUseSurfacePuppetSession } from "@/lib/workspace/hooks/useSurfacePuppetSession";
const _shimSatisfiesWorkspace: typeof WorkspaceUseSurfacePuppetSession = useSurfacePuppetSession;
const _workspaceSatisfiesShim: typeof useSurfacePuppetSession =
    null as unknown as typeof WorkspaceUseSurfacePuppetSession;
void _shimSatisfiesWorkspace;
void _workspaceSatisfiesShim;
