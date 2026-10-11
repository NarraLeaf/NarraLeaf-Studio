import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import { getInterface } from "@/lib/app/bridge";
import type { DevModeEntry, DevModeStatus } from "@shared/types/devMode";
import { EventEmitter } from "../ui/EventEmitter";
import { flushPendingSaves } from "../autosave/flushPendingSaves";
import { refreshDependenciesForRun } from "./refreshDependenciesForRun";

type DevModeServiceEvents = {
    statusChanged: DevModeStatus;
};

export class DevModeService extends Service<DevModeService> {
    private status: DevModeStatus = "idle";
    private timer: ReturnType<typeof setInterval> | null = null;
    private refreshInFlight = false;
    // Set when a read is asked for while one is already on its way: the answer that read brings may
    // predate whatever prompted the second ask, so one more read follows it.
    private refreshAgain = false;
    // True from the click until the launch IPC resolves. While set, the status poll is suppressed so
    // it cannot momentarily revert the optimistic "starting" back to "idle" before the main process
    // has registered the launch.
    private launchInFlight = false;
    private consoleLogToken: { cancel: () => void } | null = null;
    private readonly events = new EventEmitter<DevModeServiceEvents>();

    protected async init(_ctx: WorkspaceContext): Promise<void> {
        return;
    }

    public override activate(_ctx: WorkspaceContext): void {
        void this.refreshStatus();
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

    public override dispose(_ctx: WorkspaceContext): void {
        this.stopPolling();
        this.consoleLogToken?.cancel();
        this.consoleLogToken = null;
        this.events.clear();
    }

    public getStatus(): DevModeStatus {
        return this.status;
    }

    public onStatusChanged(handler: (status: DevModeStatus) => void): () => void {
        return this.events.on("statusChanged", handler);
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
    public async launch(entry: DevModeEntry): Promise<DevModeStatus> {
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
            const result = await getInterface().devMode.launch(this.projectPath(), entry);
            if (result.success) {
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

    public async stop(): Promise<DevModeStatus> {
        const result = await getInterface().devMode.stop(this.projectPath());
        if (result.success) {
            this.updateStatus(result.data.status);
        }
        return this.status;
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
        this.syncPolling(nextStatus);
        if (this.status === nextStatus) {
            return;
        }
        this.status = nextStatus;
        this.events.emit("statusChanged", nextStatus);
    }

    private syncPolling(status: DevModeStatus): void {
        if (this.shouldPoll(status)) {
            this.startPolling();
        } else {
            this.stopPolling();
        }
    }

    private shouldPoll(status: DevModeStatus): boolean {
        return status !== "idle" && status !== "error";
    }

    private startPolling(): void {
        if (this.timer) {
            return;
        }
        this.timer = setInterval(() => {
            void this.refreshStatus();
        }, 1000);
    }

    private stopPolling(): void {
        if (!this.timer) {
            return;
        }
        clearInterval(this.timer);
        this.timer = null;
    }
}
