import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { GAME_EXIT_CODES } from "./gameExitCodes";
import { createCrashTeardown } from "./mainProcessErrors";
import { RuntimePersistenceStore, RuntimeSaveStore } from "./runtimeStorage";

it("reports that waiting finished when a pending save fails during crash teardown", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nls-crash-save-"));
    try {
        const saves = new RuntimeSaveStore(dir);
        const persistence = new RuntimePersistenceStore(dir);
        await saves.write("slot", { scene: "saved" });
        vi.spyOn(fs, "rename").mockRejectedValueOnce(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
        const failedWrite = expect(saves.write("slot", { scene: "later" }))
            .rejects.toMatchObject({ code: "ENOSPC" });
        const logs: string[] = [];
        let finish!: () => void;
        const exited = new Promise<void>(resolve => { finish = resolve; });
        const end = createCrashTeardown({
            log: (_level, message) => { logs.push(message); },
            flushForCrash: () => Promise.allSettled([saves.flush(), persistence.flush()]),
            crashFlushBudgetMs: 3000,
            wait: () => new Promise<void>(() => undefined),
            reportFatal: () => undefined,
            exit: finish,
        });

        end("failure");
        await exited;
        expect(saves.hasPendingWrites()).toBe(false);
        await failedWrite;
        expect(logs).toContain(
            `[Crash] Closing the game (exit ${GAME_EXIT_CODES.crashed}); finished waiting for pending save operations.`,
        );
        expect((await new RuntimeSaveStore(dir).read("slot"))?.savedGame).toEqual({ scene: "saved" });
    } finally {
        vi.restoreAllMocks();
        await fs.rm(dir, { recursive: true, force: true });
    }
});
