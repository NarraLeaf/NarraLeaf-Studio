import type { DownloadProgressEvent } from "@shared/types/downloadProgress";
import type { StudioTaskKind } from "@shared/types/studioTask";
import type { StudioTaskScheduler } from "./StudioTaskScheduler";

/**
 * Turns downloads happening somewhere else into tasks the status bar can show.
 *
 * The scheduler's ordinary client hands over a function and is told when it finished. A download
 * reported over {@link DownloadProgressEvent} is the opposite shape: the bytes are already moving in
 * another process, and the only thing this side can do is say so and wait to be told it stopped. So
 * the task's work is exactly that wait - a promise this bridge resolves when the `end` arrives -
 * which is what puts a transfer nobody here controls onto the same strip as everything else Studio
 * is doing.
 *
 * That shape is only honest because those tasks run in the network lane, where nothing queues. A
 * queued one would report a wait that is not happening, and then finish the instant it started
 * because the download it describes was over minutes ago.
 *
 * One bridge per thing being watched (a build run, a compile), so {@link endAll} can close whatever
 * is still open when that thing goes away. A worker killed mid-download sends no `end`, and a task
 * left spinning for the life of the app is the one failure mode this must not have.
 */
export class DownloadTaskBridge {
    private readonly open = new Map<string, { finish: () => void; report: (done: number, total: number | null) => void }>();

    /**
     * @param scheduler Where the tasks go.
     * @param scope Distinguishes this bridge's transfer ids from another bridge's. Two builds
     *              running in two windows both number their downloads from the same worker code, and
     *              a shared key would make them one task - which is what the key contract means by
     *              describing the output: these are different files on their way to different places.
     */
    public constructor(
        private readonly scheduler: StudioTaskScheduler,
        private readonly scope: string,
    ) {}

    /** Apply one event from the downloading side. Unknown ids are ignored rather than throwing. */
    public accept(event: DownloadProgressEvent): void {
        if (event.phase === "start") {
            this.begin(event.id, event.kind);
            return;
        }
        const entry = this.open.get(event.id);
        if (!entry) {
            return;
        }
        if (event.phase === "advance") {
            entry.report(event.done, event.total);
            return;
        }
        this.open.delete(event.id);
        entry.finish();
    }

    /** Close every transfer still open, for a watched thing that has ended or died. */
    public endAll(): void {
        const entries = [...this.open.values()];
        this.open.clear();
        for (const entry of entries) {
            entry.finish();
        }
    }

    private begin(id: string, kind: StudioTaskKind): void {
        if (this.open.has(id)) {
            return;
        }
        let finish = () => {};
        let report: (done: number, total: number | null) => void = () => {};
        // Registered before the submission so an `advance` that lands in the same tick is not
        // dropped: `submit` runs the task synchronously up to its first await.
        this.open.set(id, {
            finish: () => finish(),
            report: (done, total) => report(done, total),
        });
        void this.scheduler.submit({
            kind,
            key: `download:${this.scope}:${id}`,
            priority: "blocking",
            lane: "network",
            run: context => new Promise<void>(resolve => {
                finish = resolve;
                report = (done, total) => {
                    // No total means the server did not say how many bytes are coming. The task then
                    // reports nothing at all rather than a fraction of a number nobody knows, and the
                    // readout stays a spinner - which is the truth about a chunked response.
                    if (total !== null && total > 0) {
                        context.report({ done, total, unit: "byte" });
                    }
                };
                // Cancelling reaches the downloader through whatever owns it - killing a build worker
                // is what stops its transfers - so there is nothing for this end to stop. Registering
                // the resolve keeps the task from outliving a cancel that arrives before the `end`.
                context.onCancel(() => resolve());
            }),
        });
    }
}
