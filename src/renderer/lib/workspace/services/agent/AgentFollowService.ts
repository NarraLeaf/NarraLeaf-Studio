/**
 * What the author sees of an agent working in this workspace, and the two switches they hold over it.
 *
 * The bridge tells this service when a call starts and ends and what each write touched; the status
 * bar draws the call in flight from it, and the workspace host (`AgentWorkspaceHost`) opens the
 * editor tab a write landed in and briefly marks what changed - inside Studio only. Nothing here or
 * downstream of it focuses a window: an author typing in another application while the agent works
 * must not have the keyboard taken from them.
 *
 * - **Pause** is for this session only and refuses every write (`paused`) until it is lifted. It is
 *   deliberately not remembered: a paused agent the author forgot about across a restart would look
 *   like a broken connection.
 * - **Follow** is remembered per project, in the editor state `.nlstudio` keeps, and is on by
 *   default - the point of an agent working in the open project is that the author watches it.
 *
 * Comments in English per project convention.
 */

import { EventEmitter } from "../ui/EventEmitter";
import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import type { PanelStateService } from "../core/PanelStateService";

/** Where an agent's write landed, for follow mode. */
export type AgentWriteTarget =
    | { kind: "surface"; surfaceId: string; name: string; elementIds?: readonly string[] }
    | { kind: "component"; componentId: string; name: string; elementIds?: readonly string[] }
    | { kind: "scene"; storyId: string; sceneId: string; name: string; blockIds?: readonly string[] }
    | { kind: "blueprint"; blueprintId: string; name: string }
    /**
     * Translations or takes of one language. Follow mode opens that language's table on `unitId`, the
     * first unit the write changed; `storyId` names the story the table should be showing for it.
     */
    | { kind: "translation"; locale: string; unitId: string; storyId?: string; name: string }
    | { kind: "voice"; locale: string; unitId: string; storyId?: string; name: string };

/** The call in flight, as the status bar names it. */
export type AgentActivity = {
    callId: string;
    tool: string;
    /** The page, scene or other thing the call is about, once the handler knows it. */
    target: string | null;
};

export type AgentFollowState = {
    paused: boolean;
    follow: boolean;
    activity: AgentActivity | null;
    /** The last client that called, by the name it gave in `initialize`. Null before any call. */
    clientName: string | null;
    /** When the last call ended, epoch milliseconds; null before any call. */
    lastCallAt: number | null;
    /**
     * What the agent last changed, for a few seconds after it landed.
     *
     * A call is usually over in well under a second, so a cell that named only the call in flight
     * would flash too briefly to read. The author watching is the point of the feature, so the last
     * write stays named long enough to be seen ({@link LAST_WRITE_VISIBLE_MS}) and then goes.
     */
    lastWrite: { name: string } | null;
    /**
     * An agent is at work in this project: a call is in flight, one ended less than
     * {@link AGENT_ACTIVE_IDLE_MS} ago, or the author paused it. The status bar takes the agent wash
     * for as long as this holds.
     *
     * Not "a call is in flight": an agent spends most of its time between calls, thinking, and a bar
     * that changed colour with every call would flicker through a whole working session.
     */
    active: boolean;
};

/** How long the status bar keeps naming the last thing the agent changed. */
export const LAST_WRITE_VISIBLE_MS = 4000;

/** How long after its last call an agent still counts as at work. */
export const AGENT_ACTIVE_IDLE_MS = 15000;

type AgentFollowEvents = {
    changed: AgentFollowState;
    wrote: AgentWriteTarget;
    highlight: AgentWriteTarget;
};

const PANEL_STATE_ID = "narraleaf-studio:agent";

export class AgentFollowService extends Service<AgentFollowService> {
    private readonly events = new EventEmitter<AgentFollowEvents>();
    private state: AgentFollowState = { paused: false, follow: true, activity: null, clientName: null, lastCallAt: null, lastWrite: null, active: false };
    private panelState: PanelStateService | null = null;
    private lastWriteTimer: ReturnType<typeof setTimeout> | null = null;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const panelState = ctx.services.get<PanelStateService>(Services.PanelState);
        await depend([panelState]);
        this.panelState = panelState;
        const stored = panelState.getPanelState<{ follow?: boolean }>(PANEL_STATE_ID);
        this.state = {
            paused: false,
            follow: stored?.follow ?? true,
            activity: null,
            clientName: null,
            lastCallAt: null,
            lastWrite: null,
            active: false,
        };
    }

    public override dispose(_ctx: WorkspaceContext): void {
        if (this.lastWriteTimer) {
            clearTimeout(this.lastWriteTimer);
            this.lastWriteTimer = null;
        }
        this.clearIdleTimer();
        this.panelState = null;
        this.events.clear();
    }

    public getState(): AgentFollowState {
        return this.state;
    }

    public onChanged(handler: (state: AgentFollowState) => void): () => void {
        return this.events.on("changed", handler);
    }

    public onWrote(handler: (target: AgentWriteTarget) => void): () => void {
        return this.events.on("wrote", handler);
    }

    /**
     * Outline what a past write changed, now - the Agent log's row, once it has opened the tab. The
     * workspace host draws it, the same outline follow mode draws for a write as it lands.
     */
    public requestHighlight(target: AgentWriteTarget): void {
        this.events.emit("highlight", target);
    }

    public onHighlightRequested(handler: (target: AgentWriteTarget) => void): () => void {
        return this.events.on("highlight", handler);
    }

    public setPaused(paused: boolean): void {
        if (this.state.paused === paused) {
            return;
        }
        if (paused) {
            this.clearIdleTimer();
            this.update({ paused, active: true });
        } else {
            this.update({ paused });
            this.scheduleIdle();
        }
    }

    public setFollow(follow: boolean): void {
        if (this.state.follow === follow) {
            return;
        }
        this.update({ follow });
        this.panelState?.setPanelState(PANEL_STATE_ID, { follow });
    }

    public beginCall(callId: string, tool: string, clientName: string | null): void {
        this.clearIdleTimer();
        this.update({ activity: { callId, tool, target: null }, clientName: clientName ?? this.state.clientName, active: true });
    }

    /** Name what the call in flight is about, once the handler has resolved it. */
    public describeCall(callId: string, target: string): void {
        if (this.state.activity?.callId === callId) {
            this.update({ activity: { ...this.state.activity, target } });
        }
    }

    public endCall(callId: string): void {
        if (this.state.activity?.callId === callId) {
            this.update({ activity: null, lastCallAt: Date.now() });
            this.scheduleIdle();
        }
    }

    /**
     * A write landed. Always announced - the host decides whether to follow it - so that turning
     * follow on mid-session needs no catching up.
     */
    public noteWrite(target: AgentWriteTarget): void {
        this.events.emit("wrote", target);
        if (this.lastWriteTimer) {
            clearTimeout(this.lastWriteTimer);
        }
        this.update({ lastWrite: { name: target.name } });
        this.lastWriteTimer = setTimeout(() => {
            this.lastWriteTimer = null;
            this.update({ lastWrite: null });
        }, LAST_WRITE_VISIBLE_MS);
    }

    /** Count the agent as idle once {@link AGENT_ACTIVE_IDLE_MS} pass with no call. Paused stays active. */
    private scheduleIdle(): void {
        this.clearIdleTimer();
        this.idleTimer = setTimeout(() => {
            this.idleTimer = null;
            if (!this.state.paused && this.state.activity === null) {
                this.update({ active: false });
            }
        }, AGENT_ACTIVE_IDLE_MS);
    }

    private clearIdleTimer(): void {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }

    private update(patch: Partial<AgentFollowState>): void {
        this.state = { ...this.state, ...patch };
        this.events.emit("changed", this.state);
    }
}
