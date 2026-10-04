import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** A utility process double: it answers whatever it was asked with what the test scripts. */
class FakeWorker extends EventEmitter {
    readonly posted: unknown[] = [];
    killed = false;
    stdout = null;
    stderr = null;

    postMessage(message: unknown): void {
        this.posted.push(message);
    }

    kill(): boolean {
        this.killed = true;
        return true;
    }
}

const { fork } = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("electron", () => ({ utilityProcess: { fork } }));

const { readBuildPayloadInWorker } = await import("./readBuildPayloadInWorker");

const app = { getDistDir: () => "/studio/dist" };
const pack = { schemaVersion: 2, project: { name: "Sample" } };

describe("reading a build in the compile worker", () => {
    let worker: FakeWorker;

    beforeEach(() => {
        worker = new FakeWorker();
        fork.mockReset();
        fork.mockReturnValue(worker);
    });

    it("asks the compile worker, and answers only once that process has exited", async () => {
        let settled = false;
        const reading = readBuildPayloadInWorker(app, "/builds/win-unpacked", { digests: true })
            .then(summary => {
                settled = true;
                return summary;
            });
        expect(fork.mock.calls[0]?.[0]).toMatch(/compileWorker\.js$/);
        worker.emit("spawn");
        expect(worker.posted).toEqual([{ type: "read-payload", target: "/builds/win-unpacked", digests: true }]);

        worker.emit("message", { type: "payload", summary: { pack, digests: [["pack", "d1"]] } });
        expect(worker.killed).toBe(true);
        await Promise.resolve();
        // Still holding the build until it is gone.
        expect(settled).toBe(false);

        worker.emit("exit", 0);
        await expect(reading).resolves.toEqual({ pack, digests: [["pack", "d1"]] });
    });

    it("rejects with the worker's own sentence, also only after it has exited", async () => {
        const reading = readBuildPayloadInWorker(app, "/elsewhere", { digests: false });
        worker.emit("spawn");
        worker.emit("message", { type: "error", message: "/elsewhere does not look like a build of this game" });
        worker.emit("exit", 0);
        await expect(reading).rejects.toThrow("/elsewhere does not look like a build of this game");
    });

    it("says so when the worker dies without answering", async () => {
        const reading = readBuildPayloadInWorker(app, "/builds/win-unpacked", { digests: false });
        worker.emit("exit", 3);
        await expect(reading).rejects.toThrow(/exited before answering \(code 3\)/);
    });
});
