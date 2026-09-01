import { useEffect, useState } from "react";
import { isProjectTrusted } from "@/lib/workspace/projectTrust";
import { useWorkspace } from "../context";

/**
 * Whether this window's project is one Studio will refuse to run things for, as React state.
 *
 * **Affordance only.** Main refuses a build, a preview, a Dev Mode launch and a spawn on its own
 * account; a keybinding, a plugin or a second window can all still ask, and that is why the refusal
 * is not here. What this is for is not offering a control that would be refused - the same division
 * `useWorkspaceOperationsFrozen` sits on.
 *
 * # Why it may be briefly wrong, and why that is the right trade
 *
 * The answer comes from main over IPC, so there is one render before it arrives. It starts at
 * "trusted", which means a distrusted project shows its run controls for a few milliseconds before
 * they grey out. The alternative - start at "distrusted" - would grey every control in every window
 * on every launch, including the overwhelming majority of projects the author wrote themselves, to
 * spare a flicker in the rare case. Nothing can be *started* in that window either way.
 *
 * The answer never changes afterwards: trust is settled when a workspace starts, and revoking a
 * grant takes effect on the project's next launch.
 */
export function useProjectDistrusted(): boolean {
    const { context } = useWorkspace();
    const projectPath = context?.project.resolve() ?? null;
    const [distrusted, setDistrusted] = useState(false);

    useEffect(() => {
        if (!projectPath) {
            return;
        }
        let live = true;
        void isProjectTrusted(projectPath).then(trusted => {
            if (live) {
                setDistrusted(!trusted);
            }
        });
        return () => {
            live = false;
        };
    }, [projectPath]);

    return distrusted;
}
