/**
 * Mounting a Surface puppet widget's model — the workspace half of the seam.
 *
 * The packaged game runtime never sees this file. Its build replaces the specifier
 * `@/lib/workspace/hooks/useSurfacePuppetSession` with `src/runtime/renderer/shims/useSurfacePuppetSession.ts`
 * through an esbuild `onResolve` alias (`runtimeAliasPlugin` in `project/build/build-runtime.js`),
 * exactly as it does for `useAssetObjectUrl`. A widget renderer imports this one path in both hosts and
 * gets whichever implementation belongs there.
 *
 * The two copies keep the same signature by hand — the type checker cannot see the substitution,
 * because the runtime tsconfig resolves `@/*` to the real renderer tree. The shim carries an explicit
 * assertion that its shape still matches this one.
 *
 * Everything that is not "how does a session come into being" lives in {@link useSurfacePuppetMount}.
 */

import { useMemo } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { PuppetDescriptionService } from "@/lib/workspace/services/puppet/PuppetDescriptionService";
import type { SurfacePuppetOpener, SurfacePuppetSessionState } from "@/lib/ui-editor/runtime/game/surfacePuppetSession";
import {
    useSurfacePuppetMount,
    type UseSurfacePuppetSessionInput,
} from "@/lib/ui-editor/runtime/game/useSurfacePuppetMount";

export type { UseSurfacePuppetSessionInput };

/**
 * The lifecycle a Surface puppet widget needs, in the editor canvas.
 *
 * Never throws and never rejects: an unconfigured widget, a project with no runtime installed, and a
 * model asset that has gone missing all come back as `missing-backend` with a reason. See the
 * degradation contract in `surfacePuppetSession.ts`.
 */
export function useSurfacePuppetSession(input: UseSurfacePuppetSessionInput): SurfacePuppetSessionState {
    let context: ReturnType<typeof useWorkspace>["context"] | null = null;
    try {
        context = useWorkspace().context;
    } catch {
        // Dev Mode draws Surfaces outside the workspace provider - the same allowance
        // `useAssetObjectUrl` makes. There is no project object to find the author's runtime through
        // there, so the widget stays an empty box rather than half-mounting.
        context = null;
    }

    const opener = useMemo<SurfacePuppetOpener | null>(() => {
        if (!context) {
            return null;
        }
        const service = context.services.get<PuppetDescriptionService>(Services.PuppetDescription);
        // `openSession` already distinguishes "nothing to mount" (a typed
        // `SurfacePuppetUnavailableError` carrying the reason) from "it broke" (anything else), which
        // is precisely the split the mount machine degrades on - so nothing here reads messages.
        return ({ request, container, size, onWarn }) => service.openSession({
            assetId: request.assetId ?? "",
            backend: request.backend,
            entry: request.entry ?? null,
            options: request.options ?? {},
            size,
        }, container, { size, onWarn });
    }, [context]);

    return useSurfacePuppetMount(opener, input);
}
