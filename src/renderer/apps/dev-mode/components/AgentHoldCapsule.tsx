import type { ReactNode } from "react";
import { AgentCapsule } from "@/lib/components/agent/AgentCapsule";
import { AGENT_HOLD_CAPSULE_ATTRIBUTE } from "../agentHoldShield";

/**
 * The agent notice over the Dev Mode window while an agent holds the session, or after the author
 * took it over. Put away while main photographs the window for the agent (`prepareWindowCapture`),
 * which finds it by {@link AGENT_HOLD_CAPSULE_ATTRIBUTE}.
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
        <AgentCapsule
            title={title}
            detail={detail}
            action={action}
            onAction={onAction}
            capsuleProps={{ [AGENT_HOLD_CAPSULE_ATTRIBUTE]: "" }}
            actionProps={{ [`data-agent-${actionId}`]: "" }}
            zIndex={2147483647}
        />
    );
}
