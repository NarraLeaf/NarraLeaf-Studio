/**
 * The packaged-game copy of the `nl.character` preview hook.
 *
 * This file *replaces* `@/lib/workspace/hooks/useCharacterPreviewSrcs` in the runtime bundle, through
 * the same esbuild `onResolve` alias every other shim beside it uses
 * (`runtimeAliasPlugin` in `project/build/build-runtime.js`).
 *
 * There is nothing to do here, and that is the honest answer rather than a stub. The workspace copy
 * exists for one situation — an author laying out a frame with no story running — which cannot arise
 * in a shipped game: a frame is on the stage because a story row put it there, so the engine is
 * already handing over what the character looks like. Compositing a second answer here would be the
 * drift the whole feature is arranged to avoid.
 *
 * The workspace copy also imports `@/apps/workspace/context` and `@/lib/workspace/services`, which
 * the runtime bundle's import guard rejects outright.
 */

const NO_SRCS: { srcs: (string | null)[] } = { srcs: [] };

export function useCharacterPreviewSrcs(_characterId: string | null): { srcs: (string | null)[] } {
    void _characterId;
    return NO_SRCS;
}

/**
 * The guard the shim mechanism cannot provide — see the long note in `useSurfacePuppetSession.ts`.
 * Mutual assignability, not one-way: a one-way check stays green after the workspace hook grows a
 * required argument this copy never learned about.
 */
import type { useCharacterPreviewSrcs as WorkspaceUseCharacterPreviewSrcs } from "@/lib/workspace/hooks/useCharacterPreviewSrcs";
const _shimSatisfiesWorkspace: typeof WorkspaceUseCharacterPreviewSrcs = useCharacterPreviewSrcs;
const _workspaceSatisfiesShim: typeof useCharacterPreviewSrcs =
    null as unknown as typeof WorkspaceUseCharacterPreviewSrcs;
void _shimSatisfiesWorkspace;
void _workspaceSatisfiesShim;
