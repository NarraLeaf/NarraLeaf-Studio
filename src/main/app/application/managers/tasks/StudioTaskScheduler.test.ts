import { describe, expect, it } from "vitest";
import { createTranslator } from "@shared/i18n";
import { STUDIO_TASK_KINDS, type StudioTaskOverview } from "@shared/types/studioTask";
import { StudioTaskScheduler, type StudioTaskRequest } from "./StudioTaskScheduler";

/** A task that finishes when the test says so, so ordering can be asserted rather than raced. */
function gate() {
    let open = (): void => undefined;
    const opened = new Promise<void>(resolve => {
        open = resolve;
    });
    return { open: () => open(), opened };
}

const task = (key: string, run: StudioTaskRequest<unknown>["run"]) =>
    ({ kind: "weatherBake" as const, key, priority: "idle" as const, run });

describe("StudioTaskScheduler", () => {
    it("runs one task at a time", async () => {
        const scheduler = new StudioTaskScheduler();
        const first = gate();
        const second = gate();
        let secondStarted = false;

        const a = scheduler.submit(task("a", async () => { await first.opened; }));
        const b = scheduler.submit(task("b", async () => { secondStarted = true; await second.opened; }));
        await Promise.resolve();

        expect(secondStarted).toBe(false);
        first.open();
        await a;
        second.open();
        await b;
        expect(secondStarted).toBe(true);
    });

    it("joins a second submission of the same work instead of running it twice", async () => {
        const scheduler = new StudioTaskScheduler();
        let runs = 0;
        const held = gate();
        const run = async () => { runs += 1; await held.opened; return "clip"; };

        const first = scheduler.submit(task("snow", run));
        const second = scheduler.submit(task("snow", run));
        held.open();

        expect(await first).toEqual({ status: "done", value: "clip" });
        // Both callers get the answer, and only one bake happened.
        expect(await second).toEqual({ status: "done", value: "clip" });
        expect(runs).toBe(1);
    });

    it("puts work someone is waiting on ahead of work nobody asked for", async () => {
        const scheduler = new StudioTaskScheduler();
        const order: string[] = [];
        const first = gate();

        void scheduler.submit(task("running", async () => { await first.opened; order.push("running"); }));
        await Promise.resolve();
        void scheduler.submit(task("idle", async () => { order.push("idle"); }));
        void scheduler.submit({ ...task("blocking", async () => { order.push("blocking"); }), priority: "blocking" });

        first.open();
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(order).toEqual(["running", "blocking", "idle"]);
    });

    it("adopts speculative work that someone starts waiting on", async () => {
        const scheduler = new StudioTaskScheduler();
        let runs = 0;
        const held = gate();
        const run = async () => { runs += 1; await held.opened; return "clip"; };

        // Studio started this early, before anyone asked.
        const speculative = scheduler.submit(task("snow", run));
        await Promise.resolve();
        // Now the author presses Run. The bake is already half done; waiting on it beats restarting.
        const awaited = scheduler.submit({ ...task("snow", run), priority: "blocking" });
        held.open();

        await speculative;
        expect(await awaited).toEqual({ status: "done", value: "clip" });
        expect(runs).toBe(1);
    });

    it("reports what is happening, and what is behind it", async () => {
        const scheduler = new StudioTaskScheduler();
        const seen: StudioTaskOverview[] = [];
        scheduler.onChanged(overview => seen.push(overview));
        const held = gate();

        const a = scheduler.submit(task("a", async ({ report }) => {
            report({ done: 1, total: 3, unit: "clip" });
            await held.opened;
        }));
        const b = scheduler.submit(task("b", async () => undefined));
        await Promise.resolve();

        // The first "running" overview is published before the second task is submitted, so the
        // assertion is about a state the trail reaches rather than about the first one in it.
        expect(seen.some(overview => overview.active?.status === "running" && overview.queued === 1)).toBe(true);
        expect(seen.some(overview => overview.active?.progress?.done === 1)).toBe(true);
        held.open();
        await Promise.all([a, b]);
        expect(scheduler.getOverview().active).toBeNull();
        expect(scheduler.getOverview().queued).toBe(0);
    });

    it("says whether anyone is actually waiting", async () => {
        const scheduler = new StudioTaskScheduler();
        const held = gate();
        const speculative = scheduler.submit(task("a", async () => { await held.opened; }));
        await Promise.resolve();
        // Speculative work alone is not a reason to tell the author the app is busy.
        expect(scheduler.getOverview().blocking).toBe(false);

        const awaited = scheduler.submit({ ...task("b", async () => undefined), priority: "blocking" });
        expect(scheduler.getOverview().blocking).toBe(true);
        held.open();
        await Promise.all([speculative, awaited]);
    });

    it("carries a failure to every caller rather than throwing at one", async () => {
        const scheduler = new StudioTaskScheduler();
        const run = async () => { throw new Error("no encoder"); };
        const first = scheduler.submit(task("x", run));
        const second = scheduler.submit(task("x", run));

        expect(await first).toEqual({ status: "error", error: "no encoder" });
        expect(await second).toEqual({ status: "error", error: "no encoder" });
        // A failure must not wedge the queue.
        expect(await scheduler.submit(task("y", async () => "fine"))).toEqual({ status: "done", value: "fine" });
    });

    it("cancels a queued task without running it", async () => {
        const scheduler = new StudioTaskScheduler();
        const held = gate();
        let ran = false;
        const active = scheduler.submit(task("busy", async () => { await held.opened; }));
        await Promise.resolve();
        const queued = scheduler.submit(task("later", async () => { ran = true; }));

        scheduler.cancel("later");
        expect(await queued).toEqual({ status: "cancelled" });
        held.open();
        await active;
        expect(ran).toBe(false);
    });

    it("reaches the running task's own stop, and reports it cancelled", async () => {
        const scheduler = new StudioTaskScheduler();
        const held = gate();
        let stopped = false;

        const running = scheduler.submit(task("busy", async ({ onCancel }) => {
            onCancel(() => { stopped = true; held.open(); });
            await held.opened;
        }));
        await Promise.resolve();
        scheduler.cancel("busy");

        expect(await running).toEqual({ status: "cancelled" });
        expect(stopped).toBe(true);
    });

    it("reports a task that threw on its way out as cancelled rather than failed", async () => {
        // What an encoder does when it is killed mid-frame. Reading that as a failure would fill the
        // log with the ordinary consequence of an author changing a number, and bury the bakes that
        // really did break.
        const scheduler = new StudioTaskScheduler();
        const held = gate();

        const running = scheduler.submit(task("busy", async ({ onCancel }) => {
            onCancel(() => held.open());
            await held.opened;
            throw new Error("ffmpeg was killed");
        }));
        await Promise.resolve();
        scheduler.cancel("busy");

        expect(await running).toEqual({ status: "cancelled" });
    });
});

describe("a caller that changes its mind", () => {
    it("drops what it asked for before, once it asks for something else", async () => {
        // The author typed another digit. Same caller, a different number, and the bake in flight is
        // now for a value nobody will ever see - while the one they are waiting for queues behind it.
        const scheduler = new StudioTaskScheduler();
        const held = gate();
        let stopped = false;

        const stale = scheduler.submitAll([task("density-1", async ({ onCancel }) => {
            onCancel(() => { stopped = true; held.open(); });
            await held.opened;
        })], { owner: "inspector", attempt: "1" });
        await Promise.resolve();
        const wanted = scheduler.submitAll(
            [task("density-12", async () => "clip")],
            { owner: "inspector", attempt: "2" },
        );

        expect(await stale).toEqual([{ status: "cancelled" }]);
        expect(stopped).toBe(true);
        expect(await wanted).toEqual([{ status: "done", value: "clip" }]);
    });

    it("keeps work the new ask still names, rather than starting it over", async () => {
        const scheduler = new StudioTaskScheduler();
        let runs = 0;
        const held = gate();
        const run = async () => { runs += 1; await held.opened; return "clip"; };

        const first = scheduler.submitAll([task("snow", run)], { owner: "prebake", attempt: "1" });
        await Promise.resolve();
        // Still wants the snow, and now some rain as well.
        const second = scheduler.submitAll([task("snow", run), task("rain", run)], { owner: "prebake", attempt: "2" });
        held.open();

        expect(await first).toEqual([{ status: "done", value: "clip" }]);
        await second;
        // Three would mean the snow was retired and baked again from nothing, which is the whole
        // thing this concept exists to avoid.
        expect(runs).toBe(2);
    });

    it("lets one ask arrive in pieces, as a compile's rows do", async () => {
        const scheduler = new StudioTaskScheduler();
        const held = gate();
        let ran = 0;

        const snow = scheduler.submitAll(
            [task("snow", async () => { ran += 1; await held.opened; })],
            { owner: "devMode", attempt: "bundle:1" },
        );
        await Promise.resolve();
        const sakura = scheduler.submitAll(
            [task("sakura", async () => { ran += 1; })],
            { owner: "devMode", attempt: "bundle:1" },
        );
        held.open();

        expect(await snow).toEqual([{ status: "done", value: undefined }]);
        await sakura;
        expect(ran).toBe(2);
    });

    it("never drops work somebody who cannot change their mind is waiting on", async () => {
        const scheduler = new StudioTaskScheduler();
        const held = gate();

        const speculative = scheduler.submitAll(
            [task("snow", async () => { await held.opened; return "clip"; })],
            { owner: "prebake", attempt: "1" },
        );
        await Promise.resolve();
        // A build wants the same clip and named nobody, which is a want that cannot be withdrawn.
        const build = scheduler.submit({ ...task("snow", async () => "clip"), priority: "blocking" });
        scheduler.submitAll([], { owner: "prebake", attempt: "2" });
        held.open();

        expect(await build).toEqual({ status: "done", value: "clip" });
        expect(await speculative).toEqual([{ status: "done", value: "clip" }]);
    });

    it("drops its own interest without touching another owner's", async () => {
        const scheduler = new StudioTaskScheduler();
        const held = gate();

        const speculative = scheduler.submitAll(
            [task("snow", async () => { await held.opened; return "clip"; })],
            { owner: "prebake", attempt: "1" },
        );
        await Promise.resolve();
        const devMode = scheduler.submitAll(
            [{ ...task("snow", async () => "clip"), priority: "blocking" as const }],
            { owner: "devMode", attempt: "bundle:1" },
        );
        scheduler.submitAll([], { owner: "prebake", attempt: "2" });
        held.open();

        expect(await devMode).toEqual([{ status: "done", value: "clip" }]);
        expect(await speculative).toEqual([{ status: "done", value: "clip" }]);
    });

    it("hears an owner that wants nothing at all", async () => {
        // Deleting the last weather row: the ask is empty, and the bake for the row that is gone has
        // to stop on that news rather than on whatever happens to be asked for next.
        const scheduler = new StudioTaskScheduler();
        const held = gate();
        let ran = false;

        const busy = scheduler.submit(task("busy", async () => { await held.opened; }));
        await Promise.resolve();
        const stale = scheduler.submitAll([task("gone", async () => { ran = true; })], { owner: "prebake", attempt: "1" });
        scheduler.submitAll([], { owner: "prebake", attempt: "2" });

        expect(await stale).toEqual([{ status: "cancelled" }]);
        held.open();
        await busy;
        expect(ran).toBe(false);
    });
});

describe("the words a task is shown by", () => {
    // The status bar reaches these through a cast, so the compiler cannot see them and the i18n
    // parity test cannot either - parity compares the three languages against each other, and a key
    // all three are missing is perfectly aligned. A missing one would put a raw key path in front of
    // an author waiting on their project.
    // Imported at the top rather than awaited inside the test: pulling the whole catalogue takes
    // seconds under a loaded run, and a test that times out under parallelism is a test that fails
    // for a reason unrelated to what it checks.
    it("has a label for every kind of task", () => {
        const translator = createTranslator("en");
        // Negative control: without it this would pass against a translator that answered true to
        // everything, which is the shape of a test that cannot fail.
        expect(translator.has("workspace.shell.statusBar.task.notATask" as never)).toBe(false);
        expect(STUDIO_TASK_KINDS.filter(kind => !translator.has(`workspace.shell.statusBar.task.${kind}` as never))).toEqual([]);
    });
});
