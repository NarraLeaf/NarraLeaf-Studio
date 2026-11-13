import { createContext, useContext } from "react";
import type { CommandLineRunJob } from "@shared/types/commandLineRun";
import type { Workspace } from "@/lib/workspace/workspace";
import type { WorkspaceContext as WorkspaceCtx } from "@/lib/workspace/services/services";
import type { WorkspaceStartupStage } from "../components/WorkspaceOpeningOverlay";

/**
 * The workspace React context and the hooks that read it, apart from the provider that fills it.
 *
 * Kept out of `WorkspaceContext.tsx` on purpose. The provider imports the whole workspace - every
 * service, the lint rules, the agent tools - and the hooks are read by shared `@/lib` code that also
 * renders in the Dev Mode window, where no provider exists and the answer is simply "no workspace".
 * Importing the hooks from the provider's module dragged that whole tree into the Dev Mode bundle.
 * Everything here is a type import except React, so reading the context costs nothing.
 */
export interface WorkspaceContextValue {
    workspace: Workspace | null;
    context: WorkspaceCtx | null;
    isInitialized: boolean;
    error: Error | null;
    /**
     * Whether this window is a recovery shell rather than a workspace.
     *
     * Read from the window's props, so it is settled before the first service starts and cannot
     * change while the window lives - switching modes is a reload. Everything downstream keys off
     * this: no plugins, a different shell, a different set of services.
     */
    recovery: boolean;
    /** What sent the author into recovery mode, when something did. Shown first in the panel. */
    recoveryReason: string | null;
    /**
     * Which part of the startup is running, for as long as one is.
     *
     * Only the overlay reads it, but it belongs to the provider: the provider is what performs the
     * steps, and a window that stays blank through all of them is the thing being fixed.
     */
    startupStage: WorkspaceStartupStage;
    /**
     * The job this window was opened by `--build`, `--test` or `--lint` to do, or null for an
     * ordinary workspace.
     *
     * Read from the window's props alongside `recovery` and settled for the same reason: it decides
     * what this window is before the first service starts, so nothing has to be told twice and no
     * editor is mounted on the way. See `CommandLineRunHost`.
     */
    commandLineRun: CommandLineRunJob | null;
    /**
     * Start the whole initialization over.
     *
     * Worth having because most of what makes this fail is not the project: a file still being
     * written by another tool, a network volume that had not woken up, a plugin that threw once.
     * Before this existed the only way to try again was to kill the window.
     */
    retry: () => void;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * Hook to access workspace context
 */
export function useWorkspace() {
    const ctx = useContext(WorkspaceContext);
    if (!ctx) {
        throw new Error("useWorkspace must be used within WorkspaceProvider");
    }
    return ctx;
}

/**
 * The same read for code that legitimately runs both inside and outside a workspace window.
 *
 * The shared `@/lib/ui-editor` tree renders in the editor (provider present) and in the Dev Mode
 * window (no provider), and "no workspace" is an ordinary answer there, not a mistake. Catching
 * {@link useWorkspace}'s throw was the previous way to ask - which built and threw an Error, stack
 * capture and all, once per element per render: 1424 of them in a single Dev Mode page switch.
 */
export function useOptionalWorkspace() {
    return useContext(WorkspaceContext) ?? null;
}
