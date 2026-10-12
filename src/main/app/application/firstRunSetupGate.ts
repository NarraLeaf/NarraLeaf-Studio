import { needsOnboarding } from "@shared/constants/onboarding";
import { WindowAppType } from "@shared/types/window";

/** The two things the gate asks of a window. */
export type FirstRunSetupGateWindow = {
    getWindowType(): WindowAppType;
    isClosed(): boolean;
};

/**
 * Which launcher windows are showing first-run setup, as the main process decided it.
 *
 * Setup's agent access screen is let through a few agent handlers that otherwise answer only the
 * Settings window and workspaces. The question "is this window setup?" used to be answered from the
 * stored marker (`app.onboardingVersion`), which any window can write, so a plugin in a workspace
 * could have written it back to 0 and every launcher would have passed. The answer is now a mark main
 * puts on the one window it opened in setup, when it opens it: nothing a renderer writes can put a
 * window in this set.
 *
 * The marks are dropped together when the marker says setup is finished (finishing and skipping both
 * write it), so the gate closes the moment the launcher becomes the home screen - also in a
 * development launch with `--onboarding`, where the profile's marker alone would have kept it open.
 */
export class FirstRunSetupGate {
    private windows = new WeakSet<FirstRunSetupGateWindow>();

    /** The launcher main is opening to show first-run setup. */
    public open(window: FirstRunSetupGateWindow): void {
        this.windows.add(window);
    }

    /** Whether `window` is a launcher, still open, that main opened in first-run setup. */
    public passes(window: FirstRunSetupGateWindow): boolean {
        return window.getWindowType() === WindowAppType.Launcher && !window.isClosed() && this.windows.has(window);
    }

    /**
     * The marker was written. A value that says setup is done closes the gate for every window;
     * anything else changes nothing, since writing the marker never opens it.
     */
    public noteMarker(value: unknown): void {
        if (!needsOnboarding(value)) {
            this.windows = new WeakSet();
        }
    }
}
