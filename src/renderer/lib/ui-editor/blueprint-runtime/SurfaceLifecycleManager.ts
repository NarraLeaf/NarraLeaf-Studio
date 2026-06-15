/**
 * Tracks surface lifecycle state for a single Dev Mode session.
 * Determines when surfaceInit events should fire and manages state reset policy.
 */

export type SurfaceResetPolicy = "preserve" | "reset";

export class SurfaceLifecycleManager {
    private readonly initializedSurfaces = new Set<string>();
    private readonly resetPolicy: SurfaceResetPolicy;

    constructor(resetPolicy: SurfaceResetPolicy = "preserve") {
        this.resetPolicy = resetPolicy;
    }

    /**
     * Called when a surface becomes the active surface (enters the top of navStack).
     * Returns true if this is the first time this surface is entered in the session
     * (surfaceInit should be dispatched).
     */
    public onSurfaceEnter(surfaceId: string): boolean {
        if (this.initializedSurfaces.has(surfaceId)) {
            return false;
        }
        this.initializedSurfaces.add(surfaceId);
        return true;
    }

    /** Whether a surface has been initialized in this session. */
    public isInitialized(surfaceId: string): boolean {
        return this.initializedSurfaces.has(surfaceId);
    }

    /** Current state reset policy for re-entered surfaces. */
    public getResetPolicy(): SurfaceResetPolicy {
        return this.resetPolicy;
    }

    /** Reset all tracking (e.g. on bundle reload). */
    public reset(): void {
        this.initializedSurfaces.clear();
    }
}
