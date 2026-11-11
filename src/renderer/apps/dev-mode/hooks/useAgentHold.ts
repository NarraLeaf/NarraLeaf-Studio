import { useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";

/** Key events the author's keyboard could reach the game with. */
const BLOCKED_KEY_EVENTS = ["keydown", "keyup", "keypress"] as const;

/**
 * Whether an agent's play-test holds this Dev Mode session, as main reports it. While it does, the
 * author's own key presses are turned away before the game sees them; their pointer is stopped by
 * the shield the window draws over the game. The agent's acts are synthetic events (`isTrusted` is
 * false), so they pass both.
 */
export function useAgentHold(): boolean {
    const [held, setHeld] = useState(false);

    useEffect(() => {
        const token = getInterface().devMode.onAgentHoldChanged(({ held: next }) => setHeld(next));
        return () => token.cancel();
    }, []);

    useEffect(() => {
        if (!held) {
            return;
        }
        const block = (event: Event) => {
            if (!event.isTrusted) {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
        };
        // On the window, in the capture phase: before any listener the game or Dev Mode installed.
        for (const type of BLOCKED_KEY_EVENTS) {
            window.addEventListener(type, block, true);
        }
        // Whatever had focus would otherwise go on receiving keys the shield cannot intercept.
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
        return () => {
            for (const type of BLOCKED_KEY_EVENTS) {
                window.removeEventListener(type, block, true);
            }
        };
    }, [held]);

    return held;
}
