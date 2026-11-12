import { useSyncExternalStore, useCallback, type ReactNode } from "react";
import { useTranslation } from "@/lib/i18n";
import { AgentCapsule } from "@/lib/components/agent/AgentCapsule";
import { Services } from "@/lib/workspace/services/services";
import type { AgentFollowService } from "@/lib/workspace/services/agent/AgentFollowService";
import type { AgentLockArea } from "@shared/agent/editorLock";
import { useWorkspace } from "../../context";
import { useAgentEditorLocks } from "./useAgentEditorLocks";

const NO_SUBSCRIPTION = () => () => {};

/**
 * The capsule an editor shows while an agent has set it read-only, and the author's switch: to
 * read-write, and back to read-only. The agent is not told either way.
 *
 * Silent unless an agent holds a lock on this editor. Place it inside the editor's positioned root.
 *
 * Comments in English per project convention.
 */
export function AgentEditorLockCapsule({ area, position }: {
    area: AgentLockArea;
    /** See `AgentCapsule.position`: an editor's own chrome to keep clear of. */
    position?: { left?: string; offset?: string };
}): ReactNode {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const follow = context ? context.services.get<AgentFollowService>(Services.AgentFollow) : null;
    const lock = useAgentEditorLocks()[area];
    const subscribe = useCallback(
        (listener: () => void) => (follow ? follow.onChanged(listener) : NO_SUBSCRIPTION()),
        [follow],
    );
    const readClient = () => follow?.getState().clientName ?? null;
    const clientName = useSyncExternalStore(subscribe, readClient, readClient);
    if (!follow || !lock) {
        return null;
    }
    const client = clientName ?? t("workspace.agent.editorLock.fallbackClient");
    const readOnly = !lock.overridden;
    return (
        <AgentCapsule
            title={t(`workspace.agent.editorLock.title.${area}`, { client })}
            detail={t(readOnly ? "workspace.agent.editorLock.detail.readOnly" : "workspace.agent.editorLock.detail.readWrite")}
            action={t(readOnly ? "workspace.agent.editorLock.action.readWrite" : "workspace.agent.editorLock.action.readOnly")}
            onAction={() => follow.setEditorLockOverridden(area, readOnly)}
            capsuleProps={{ "data-agent-editor-lock": area, "data-agent-editor-lock-state": readOnly ? "read-only" : "read-write" }}
            actionProps={{ "data-agent-editor-lock-toggle": "" }}
            placement="bottom"
            position={position}
        />
    );
}
