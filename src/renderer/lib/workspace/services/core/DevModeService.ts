import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import { getInterface } from "@/lib/app/bridge";
import type { DevModeEntry, DevModeStatus } from "@shared/types/devMode";
import { EventEmitter } from "../ui/EventEmitter";
import { flushPendingSaves } from "../autosave/flushPendingSaves";
import { refreshDependenciesForRun } from "./refreshDependenciesForRun";
import { translate } from "@/lib/i18n";
import type { UIService } from "./UIService";
import type { AgentFollowService } from "../agent/AgentFollowService";

type DevModeServiceEvents = {
    statusChanged: DevModeStatus;
    agentHeldChanged: boolean;
};

/** Who is asking: the author (the default), or an agent's play-test tool. */
export type DevModeCaller = { agent?: boolean; agentClient?: string };

export class DevModeService extends Service<DevModeService> {
    private status: DevModeStatus = "idle";
    /** An agent holds the running session; see `agent` on `IPCEventType.devModeLaunch`. */
    private agentHeld = false;
    private timer: ReturnType<typeof setInterval> | null = null;
    private timerInterval: number | null = null;
    private refreshInFlight = false;
    // Set when a read is asked for while one is already on its way: the answer that read brings may
    // predate whatever prompted the second ask, so one more read follows it.
    private refreshAgain = false;
    // True from the click until the launch IPC resolves. While set, the status poll is suppressed so
    // it cannot momentarily revert the optimistic "starting" back to "idle" before the main process
    // has registered the launch.
    private launchInFlight = false;
    private consoleLogToken: { cancel: () => void } | null = null;
    private takenOverToken: { cancel: () => void } | null = null;
    private handedBackToken: { cancel: () => void } | null = null;
    private stopWatchingPause: (() => void) | null = null;
    private readonly events = new EventEmitter<DevModeServiceEvents>();

    protected async init(_ctx: WorkspaceContext): Promise<void> {
        return;
    }

    public override activate(_ctx: WorkspaceContext): void {
        void this.refreshStatus();
        this.watchAgentTakeover();
        // The session reports every step of its pipeline to this window's console, a status change
        // included, and nothing else is pushed: a hot reload that is over well inside one poll
        // interval would otherwise never reach the run cell. A line from Dev Mode while a session is
        // up is the cue to read the status again; it is read, never parsed out of the line.
        this.consoleLogToken?.cancel();
        this.consoleLogToken = getInterface().devMode.onConsoleLog(() => {
            if (this.shouldPoll(this.status)) {
                void this.refreshStatus();
            }
        });
    }

    /**
     * The author taking Dev Mode over from an agent, and giving it back.
     *
     * Taken over in the Dev Mode window: the session is the author's and the agent is paused with that
     * reason. Handed back there: the agent holds it again and is resumed. Resumed from the status bar
     * instead: the session stays the author's, and main is told so the window stops offering to hand
     * it back.
     */
    private watchAgentTakeover(): void {
        const follow = this.getContext().services.get<AgentFollowService>(Services.AgentFollow);
        this.takenOverToken?.cancel();
        this.takenOverToken = getInterface().devMode.onAgentTakenOver(() => {
            this.updateAgentHeld(false);
            follow.setPaused(true, "devModeTakeover");
        });
        this.handedBackToken?.cancel();
        this.handedBackToken = getInterface().devMode.onAgentHandedBack(() => {
            this.updateAgentHeld(true);
            if (follow.getState().pausedBy === "devModeTakeover") {
                follow.setPaused(false);
            }
        });
        this.stopWatchingPause?.();
        let pausedForTakeover = follow.getState().pausedBy === "devModeTakeover";
        this.stopWatchingPause = follow.onChanged(state => {
            const now = state.pausedBy === "devModeTakeover";
            if (pausedForTakeover && !now) {
                void getInterface().devMode.endAgentTakeover(this.projectPath());
            }
            pausedForTakeover = now;
        });
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.stopPolling();
        this.consoleLogToken?.cancel();
        this.consoleLogToken = null;
        this.takenOverToken?.cancel();
        this.takenOverToken = null;
        this.handedBackToken?.cancel();
        this.handedBackToken = null;
        this.stopWatchingPause?.();
        this.stopWatchingPause = null;
        this.events.clear();
    }

    public getStatus(): DevModeStatus {
        return this.status;
    }

    public onStatusChanged(handler: (status: DevModeStatus) => void): () => void {
        return this.events.on("statusChanged", handler);
    }

    /** Whether an agent's play-test holds the running session. */
    public isAgentHeld(): boolean {
        return this.agentHeld;
    }

    public onAgentHeldChanged(handler: (held: boolean) => void): () => void {
        return this.events.on("agentHeldChanged", handler);
    }

    /**
     * Show the Dev Mode window. The way the author looks at a session an agent holds: its window opens
     * hidden, and stays read-only while shown.
     */
    public async reveal(): Promise<boolean> {
        const result = await getInterface().devMode.reveal(this.projectPath());
        return result.success && result.data.revealed;
    }

    public async refreshStatus(): Promise<DevModeStatus> {
        if (this.launchInFlight) {
            return this.status;
        }
        if (this.refreshInFlight) {
            this.refreshAgain = true;
            return this.status;
        }
        this.refreshInFlight = true;
        try {
            do {
                this.refreshAgain = false;
                const result = await getInterface().devMode.getStatus(this.projectPath());
                if (result.success) {
                    this.updateAgentHeld(result.data.agentHeld === true);
                    this.updateStatus(result.data.status);
                }
            } while (this.refreshAgain && !this.launchInFlight);
        } finally {
            this.refreshInFlight = false;
            this.refreshAgain = false;
        }
        return this.status;
    }

    /**
     * Start a Dev Mode session on this window's project.
     *
     * Which project that is, is not an argument. These three used to take an optional path that
     * defaulted to the window's own and that nothing ever passed; the main process now takes the
     * project from the window regardless, so an argument here could only ever name a project the
     * call would be refused for. A parameter whose every value but one is rejected is a place a
     * caller is invited to make a mistake.
     */
    public async launch(entry: DevModeEntry, caller: DevModeCaller = {}): Promise<DevModeStatus> {
        if (!caller.agent && !(await this.confirmTakeOver("launch"))) {
            return this.status;
        }
        this.launchInFlight = true;
        // Flip to a running state up front so the toolbar Run button and the status bar react the
        // instant the user clicks — not after the flush and compile the launch entails.
        this.updateStatus("starting");
        try {
            try {
                await this.prepareProjectForPreview();
            } catch (error) {
                console.error("[DevMode] failed to prepare project before launch", error);
                this.updateStatus("error");
                return this.status;
            }
            const result = await getInterface().devMode.launch(this.projectPath(), entry, {
                agent: caller.agent === true,
                ...(caller.agent && caller.agentClient ? { agentClient: caller.agentClient } : {}),
            });
            if (result.success) {
                // The launch decides who holds the session: an agent's takes it, the author's gives it back.
                this.updateAgentHeld(caller.agent === true && result.data.status !== "error");
                this.updateStatus(result.data.status);
            } else {
                this.updateStatus("error");
            }
            return this.status;
        } finally {
            this.launchInFlight = false;
        }
    }

    /**
     * Put everything the author has done on disk, because the run is compiled from the disk.
     *
     * The same flush a window close runs, and for the same reason: it settles the editors that are
     * still holding words first, then writes every store. A row open for editing keeps its line in
     * the field and moves it into the story a moment after the typing stops, or when the field loses
     * focus - and that blur is handled on a timer, which a quick press of a row's play control
     * outruns. Flushing only the savers then wrote the story without the line the author had just
     * changed, the run started on the old one, and the auto-save that followed a second later
     * reloaded it with the new one. Writing only four of the stores had the same effect on a
     * translation, a voice take or a variable edited just before pressing play.
     *
     * A store that cannot be written does not stop the run. Its failure is already on screen as a
     * save notice and in the Storage console; refusing here as well would add an unexplained
     * failure for a store the run may not even read.
     */
    private async prepareProjectForPreview(): Promise<void> {
        const result = await flushPendingSaves(this.getContext());
        if (!result.flushed) {
            console.warn("[DevMode] launching with stores that could not be saved:", result.failures.join(", "));
        }
        // After the flush: the scan reads the documents the run is about to be compiled from.
        await refreshDependenciesForRun(this.getContext());
    }

    public async stop(caller: DevModeCaller = {}): Promise<DevModeStatus> {
        if (!caller.agent && !(await this.confirmTakeOver("stop"))) {
            return this.status;
        }
        const result = await getInterface().devMode.stop(this.projectPath());
        if (result.success) {
            this.updateAgentHeld(false);
            this.updateStatus(result.data.status);
        }
        return this.status;
    }

    /**
     * Ask the author before they stop or relaunch a session an agent holds: the agent is in the middle
     * of a play-test, and ending it is the one thing it cannot recover from. Read fresh, so a session
     * the agent has just let go of (or the idle timer has just closed) does not ask.
     */
    private async confirmTakeOver(action: "launch" | "stop"): Promise<boolean> {
        if (!this.agentHeld) {
            return true;
        }
        await this.refreshStatus();
        if (!this.agentHeld) {
            return true;
        }
        const ui = this.getContext().services.get<UIService>(Services.UI);
        return ui.showDestructiveConfirm(
            translate("workspace.agent.devMode.confirmTitle"),
            translate(action === "stop" ? "workspace.agent.devMode.confirmStopDetail" : "workspace.agent.devMode.confirmLaunchDetail"),
            translate(action === "stop" ? "workspace.agent.devMode.confirmStop" : "workspace.agent.devMode.confirmLaunch"),
        );
    }

    private updateAgentHeld(held: boolean): void {
        if (this.agentHeld === held) {
            return;
        }
        this.agentHeld = held;
        this.events.emit("agentHeldChanged", held);
    }

    public async reload(): Promise<DevModeStatus> {
        const result = await getInterface().devMode.reload(this.projectPath());
        if (result.success) {
            this.updateStatus(result.data.status);
        } else {
            this.updateStatus("error");
        }
        return this.status;
    }

    /**
     * Clear this project's Dev Mode save slots and persistence store.
     *
     * Only the path travels. The stores are named by the project's identifier when it has one, and
     * the main process reads that out of this window's project for this call and for every save the
     * running game makes, so the two cannot name different stores. Rejects on a failing call so the
     * caller can report it; leaves the running state untouched, since this touches disk rather than
     * the game.
     */
    public async resetData(): Promise<void> {
        const result = await getInterface().devMode.resetData({
            projectPath: this.projectPath(),
        });
        if (!result.success) {
            throw new Error(result.error ?? "Failed to reset Dev Mode data");
        }
    }

    /** This window's project - every Dev Mode call is scoped to it, never to "whatever is running". */
    private projectPath(): string {
        return this.getContext().project.getConfig().projectPath;
    }

    private updateStatus(nextStatus: DevModeStatus): void {
        if (nextStatus === "idle" || nextStatus === "error") {
            this.updateAgentHeld(false);
        }
        this.syncPolling(nextStatus);
        if (this.status === nextStatus) {
            return;
        }
        this.status = nextStatus;
        this.events.emit("statusChanged", nextStatus);
    }

    private syncPolling(status: DevModeStatus): void {
        if (this.shouldPoll(status)) {
            this.startPolling(devModePollInterval(status));
        } else {
            this.stopPolling();
        }
    }

    private shouldPoll(status: DevModeStatus): boolean {
        return status !== "idle" && status !== "error";
    }

    private startPolling(intervalMs: number): void {
        if (this.timer && this.timerInterval === intervalMs) {
            return;
        }
        this.stopPolling();
        this.timerInterval = intervalMs;
        this.timer = setInterval(() => {
            void this.refreshStatus();
        }, intervalMs);
    }

    private stopPolling(): void {
        if (!this.timer) {
            return;
        }
        clearInterval(this.timer);
        this.timer = null;
        this.timerInterval = null;
    }
}

/**
 * How often the status is read while a session is up.
 *
 * Once per second while the session is moving between states, where the run cell has to follow it.
 * A running game is read only every few seconds: everything that moves it on - a reload, an error,
 * a stop, the window being closed - writes a line to this window's console first, and that line is
 * already the cue to read again (see `activate`). The slow read is the net under that, not the way
 * the change arrives, so it no longer wakes the workspace and crosses IPC every second for as long
 * as the author leaves the game open.
 */
export function devModePollInterval(status: DevModeStatus): number {
    return status === "running" ? DEV_MODE_STEADY_POLL_MS : DEV_MODE_ACTIVE_POLL_MS;
}

const DEV_MODE_ACTIVE_POLL_MS = 1000;
const DEV_MODE_STEADY_POLL_MS = 5000;
