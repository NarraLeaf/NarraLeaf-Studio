import type { ReactNode } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/lib/components/elements";
import { AGENT_HOLD_CAPSULE_ATTRIBUTE } from "../agentHoldShield";

/**
 * The notice floating over the top of the Dev Mode window while an agent holds the session, or
 * after the author took it over: two lines and one action.
 *
 * Put away while main photographs the window for the agent (`prepareWindowCapture`). Centred by a
 * flex row, not a translate: the engine's stylesheet in this window overrides Tailwind's transform
 * utilities.
 *
 * Comments in English per project convention.
 */
export function AgentHoldCapsule(props: {
    title: string;
    detail: string;
    action: string;
    onAction: () => void;
    /** Names the action for scripts that drive the window (`data-agent-<name>`). */
    actionId: "take-over" | "hand-back";
}): ReactNode {
    const { title, detail, action, onAction, actionId } = props;
    return (
        <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center" style={{ zIndex: 2147483647 }}>
            <div
                {...{ [AGENT_HOLD_CAPSULE_ATTRIBUTE]: "" }}
                role="status"
                className="pointer-events-auto flex items-center gap-3 rounded-full border border-edge bg-surface-overlay py-1.5 pl-3.5 pr-1.5 shadow-md"
            >
                <Bot className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
                <div className="flex flex-col leading-tight">
                    <span className="text-xs text-fg">{title}</span>
                    <span className="text-2xs text-fg-muted">{detail}</span>
                </div>
                <Button
                    size="sm"
                    variant="secondary"
                    className="rounded-full"
                    {...{ [`data-agent-${actionId}`]: "" }}
                    onClick={onAction}
                >
                    {action}
                </Button>
            </div>
        </div>
    );
}
