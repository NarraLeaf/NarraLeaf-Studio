/**
 * Tracks mounted surface runtime scopes for a single Dev Mode session.
 * Determines when surfaceInit events should fire and manages state reset policy.
 */

export type SurfaceResetPolicy = "preserve" | "reset";

export class SurfaceLifecycleManager {
    private readonly mountedScopes = new Set<string>();
    private readonly resetPolicy: SurfaceResetPolicy;

    constructor(resetPolicy: SurfaceResetPolicy = "preserve") {
        this.resetPolicy = resetPolicy;
    }

    /**
     * Called when a surface runtime scope mounts.
     * Returns true when this mount should dispatch surfaceInit.
     */
    public onSurfaceEnter(runtimeScopeId: string): boolean {
        if (this.mountedScopes.has(runtimeScopeId)) {
            return false;
        }
        this.mountedScopes.add(runtimeScopeId);
        return true;
    }

    /** Called when a surface runtime scope unmounts. */
    public onSurfaceExit(runtimeScopeId: string): void {
        this.mountedScopes.delete(runtimeScopeId);
    }

    /** Whether a surface runtime scope is currently mounted. */
    public isInitialized(runtimeScopeId: string): boolean {
        return this.mountedScopes.has(runtimeScopeId);
    }

    /** Current state reset policy for re-entered surfaces. */
    public getResetPolicy(): SurfaceResetPolicy {
        return this.resetPolicy;
    }

    /** Reset all tracking (e.g. on bundle reload). */
    public reset(): void {
        this.mountedScopes.clear();
    }
}
