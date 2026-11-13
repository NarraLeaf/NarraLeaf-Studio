import { useId } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The run button's stop mark while an agent's play-test holds Dev Mode: the stop square with a small
 * robot hung on its corner, so the author sees at a glance that pressing it stops the agent's run.
 *
 * Drawn in `currentColor` with the gap around the robot and its eyes cut out by masks rather than
 * painted in the button's colour, so it stays right on the hover shade and on any theme.
 *
 * Comments in English per project convention.
 */
export function AgentStopIcon({ className }: { className?: string }) {
    const id = useId().replace(/:/g, "");
    const squareMask = `agent-stop-square-${id}`;
    const robotMask = `agent-stop-robot-${id}`;
    return (
        <svg viewBox="0 0 24 24" className={cn("shrink-0", className)} aria-hidden data-agent-stop-icon="">
            <defs>
                <mask id={squareMask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                    <rect x="0" y="0" width="24" height="24" fill="white" />
                    <rect x="10" y="11.5" width="15" height="13" rx="3" fill="black" />
                </mask>
                <mask id={robotMask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
                    <rect x="12" y="13.5" width="11" height="9" rx="2" fill="white" />
                    <circle cx="15.6" cy="18" r="1.2" fill="black" />
                    <circle cx="19.4" cy="18" r="1.2" fill="black" />
                </mask>
            </defs>
            <rect x="2" y="2" width="15" height="15" rx="2" fill="currentColor" mask={`url(#${squareMask})`} />
            <rect x="12" y="13.5" width="11" height="9" rx="2" fill="currentColor" mask={`url(#${robotMask})`} />
        </svg>
    );
}
