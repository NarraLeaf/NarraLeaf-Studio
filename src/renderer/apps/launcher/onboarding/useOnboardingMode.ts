import { useCallback, useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import { ONBOARDING_STATE_KEY, ONBOARDING_VERSION } from "@shared/constants/onboarding";
import { WindowAppType } from "@shared/types/window";

/**
 * `"unknown"` only for the moment between mount and the window answering what it was opened with.
 * Rendering nothing during it is deliberate: the alternative is to assume the home screen and
 * replace it a frame later, which is the flash this whole arrangement exists to avoid.
 */
export type OnboardingMode = "unknown" | "setup" | "home";

/**
 * Whether this launcher window opened in first-run setup, and the one way out of it.
 *
 * The decision is not made here - it arrives on the window's props, already taken by the main
 * process (`App.shouldRunOnboarding`). All this does is read it and, when the flow ends, record
 * that it did.
 */
export function useOnboardingMode(): { mode: OnboardingMode; finish: () => void } {
    const [mode, setMode] = useState<OnboardingMode>("unknown");

    useEffect(() => {
        let alive = true;
        void (async () => {
            try {
                const props = await getInterface().getWindowProps<WindowAppType.Launcher>();
                if (alive) {
                    setMode(props.success && props.data?.onboarding === true ? "setup" : "home");
                }
            } catch {
                // A launcher that cannot say how it was opened is still a launcher. Setup is the
                // skippable half, so an unanswerable question resolves to the home screen rather
                // than trapping someone in a flow nothing asked for.
                if (alive) {
                    setMode("home");
                }
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    /**
     * Leave setup, and stop offering it.
     *
     * Called both by finishing and by skipping, because they mean the same thing to this marker:
     * the author has been asked. Skipping loses nothing - the flow sets two preferences, and both
     * have a row in Settings.
     *
     * What deliberately does NOT call this is quitting mid-setup. Nothing is written then, so the
     * next launch asks again; marking completion on the way in would let one crash swallow the
     * language question forever.
     */
    const finish = useCallback(() => {
        setMode("home");
        void getInterface().app.state.setGlobalState(ONBOARDING_STATE_KEY, ONBOARDING_VERSION);
    }, []);

    return { mode, finish };
}
