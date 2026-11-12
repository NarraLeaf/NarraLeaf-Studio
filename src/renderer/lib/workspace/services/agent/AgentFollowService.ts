/**
 * What the author sees of an agent working in this workspace, and the two switches they hold over it.
 *
 * The bridge tells this service when a call starts and ends and what each write touched; the status
 * bar draws the call in flight from it, and the workspace host (`AgentWorkspaceHost`) opens the
 * editor tab a write landed in and outlines what changed until the next write lands elsewhere or a
 * few seconds pass - inside Studio only. Nothing here or downstream of it focuses a window: an
 * author typing in another application while the agent works must not have the keyboard taken from
 * them.
 *
 * - **Pause** is for this session only and refuses every write (`paused`) until it is lifted. It is
 *   deliberately not remembered: a paused agent the author forgot about across a restart would look
 *   like a broken connection.
 * - **Follow** is a Studio-wide setting (`AGENT_FOLLOW_KEY`, the "Follow the agent's edits" row in
 *   Settings ▸ Agent access), on by default: every write an agent makes takes the editor's foreground,
 *   because seeing what the agent is doing must not depend on reading its transcript. The Agent menu
 *   and the status bar cell switch the same setting through {@link setFollow}; there is no
 *   per-project copy. Switched anywhere - another window, Settings - it applies here at once.
 *
 * Comments in English per project convention.
 */

import { EventEmitter } from "../ui/EventEmitter";
import { AGENT_EDITOR_LOCK_IDLE_MS, type AgentLockArea } from "@shared/agent/editorLock";
import { NO_AGENT_EDITOR_LOCKS, setAgentEditorLocks, type AgentEditorLocks } from "./agentEditorLockStore";
import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import type { GlobalSettingsService } from "../GlobalSettingsService";
import { AGENT_FOLLOW_DEFAULT, AGENT_FOLLOW_KEY, resolveAgentFollow } from "@shared/agent/follow";

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

/**
 * Why the agent is paused: the author's switch in the status bar, or the author taking over the Dev
 * Mode an agent's play-test was holding. The agent is told which, and both end the same way, with the
 * author resuming it.
 */
export type AgentPauseReason = "author" | "devModeTakeover";

export type { AgentEditorLocks };

const NO_EDITOR_LOCKS: AgentEditorLocks = NO_AGENT_EDITOR_LOCKS;

export type AgentFollowState = {
    paused: boolean;
    /** Set while `paused`; see {@link AgentPauseReason}. */
    pausedBy: AgentPauseReason | null;
    /**
     * The editors the agent has set read-only for the author (`@shared/agent/editorLock`), and for
     * each whether the author switched it back to read-write. An overridden lock stays listed, so the
     * author can switch it to read-only again, and so the agent locking it a second time does not undo
     * the author's choice.
     */
    editorLocks: AgentEditorLocks;
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

export class AgentFollowService extends Service<AgentFollowService> {
    private readonly events = new EventEmitter<AgentFollowEvents>();
    private state: AgentFollowState = { paused: false, pausedBy: null, editorLocks: NO_EDITOR_LOCKS, follow: AGENT_FOLLOW_DEFAULT, activity: null, clientName: null, lastCallAt: null, lastWrite: null, active: false };
    private settings: GlobalSettingsService | null = null;
    private stopFollowingSetting: (() => void) | null = null;
    private lastWriteTimer: ReturnType<typeof setTimeout> | null = null;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private lockIdleTimer: ReturnType<typeof setTimeout> | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const settings = ctx.services.get<GlobalSettingsService>(Services.GlobalSettings);
        await depend([settings]);
        this.settings = settings;
        this.state = {
            paused: false,
            pausedBy: null,
            editorLocks: NO_EDITOR_LOCKS,
            follow: resolveAgentFollow(settings.getSync(AGENT_FOLLOW_KEY)),
            activity: null,
            clientName: null,
            lastCallAt: null,
            lastWrite: null,
            active: false,
        };
        this.stopFollowingSetting = settings.onChange(AGENT_FOLLOW_KEY, value => {
            const follow = resolveAgentFollow(value);
            if (follow !== this.state.follow) {
                this.update({ follow });
            }
        });
    }

    public override dispose(_ctx: WorkspaceContext): void {
        if (this.lastWriteTimer) {
            clearTimeout(this.lastWriteTimer);
            this.lastWriteTimer = null;
        }
        this.clearIdleTimer();
        this.clearLockIdleTimer();
        setAgentEditorLocks(NO_AGENT_EDITOR_LOCKS);
        this.stopFollowingSetting?.();
        this.stopFollowingSetting = null;
        this.settings = null;
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

    public setPaused(paused: boolean, reason: AgentPauseReason = "author"): void {
        if (this.state.paused === paused) {
            if (paused && this.state.pausedBy !== reason) {
                this.update({ pausedBy: reason });
            }
            return;
        }
        if (paused) {
            this.clearIdleTimer();
            // A paused agent is not editing anything: its locks go with it.
            this.clearLockIdleTimer();
            this.update({ paused, pausedBy: reason, active: true, editorLocks: NO_EDITOR_LOCKS });
        } else {
            this.update({ paused, pausedBy: null });
            this.scheduleIdle();
        }
    }

    /**
     * Switch follow mode - the Studio-wide setting, not something of this project's. Applied here at
     * once; the write reaches the other windows and Settings through the main process's broadcast,
     * whose echo back to this window then changes nothing.
     */
    public setFollow(follow: boolean): void {
        if (this.state.follow === follow) {
            return;
        }
        this.update({ follow });
        void this.settings?.set(AGENT_FOLLOW_KEY, follow).catch(error => {
            console.warn("[agent] Failed to save the follow setting.", error);
        });
    }

    /**
     * The agent sets an editor read-only for the author. A lock the author already switched back to
     * read-write stays that way: locking again is the agent repeating itself, not the author changing
     * their mind.
     */
    public lockEditor(area: AgentLockArea): void {
        if (this.state.paused || this.state.editorLocks[area]) {
            return;
        }
        this.update({ editorLocks: { ...this.state.editorLocks, [area]: { overridden: false } } });
        this.scheduleLockIdle();
    }

    public unlockEditor(area: AgentLockArea): void {
        if (!this.state.editorLocks[area]) {
            return;
        }
        const { [area]: _released, ...rest } = this.state.editorLocks;
        this.update({ editorLocks: rest });
        if (Object.keys(rest).length === 0) {
            this.clearLockIdleTimer();
        }
    }

    /** The author's switch: read-write (`true`) or read-only again (`false`). Nothing reaches the agent. */
    public setEditorLockOverridden(area: AgentLockArea, overridden: boolean): void {
        const lock = this.state.editorLocks[area];
        if (!lock || lock.overridden === overridden) {
            return;
        }
        this.update({ editorLocks: { ...this.state.editorLocks, [area]: { overridden } } });
    }

    /** Lift every lock once {@link AGENT_EDITOR_LOCK_IDLE_MS} pass with no call from the agent. */
    private scheduleLockIdle(): void {
        this.clearLockIdleTimer();
        if (Object.keys(this.state.editorLocks).length === 0) {
            return;
        }
        this.lockIdleTimer = setTimeout(() => {
            this.lockIdleTimer = null;
            if (this.state.activity !== null) {
                // A call still running is not an idle agent; it ends through `endCall`, which re-arms this.
                return;
            }
            this.update({ editorLocks: NO_EDITOR_LOCKS });
        }, AGENT_EDITOR_LOCK_IDLE_MS);
    }

    private clearLockIdleTimer(): void {
        if (this.lockIdleTimer) {
            clearTimeout(this.lockIdleTimer);
            this.lockIdleTimer = null;
        }
    }

    public beginCall(callId: string, tool: string, clientName: string | null): void {
        this.clearIdleTimer();
        this.clearLockIdleTimer();
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
            this.scheduleLockIdle();
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
        if (patch.editorLocks !== undefined) {
            setAgentEditorLocks(this.state.editorLocks);
        }
        this.events.emit("changed", this.state);
    }
}
