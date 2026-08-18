/**
 * The two halves of a language restart, driven directly.
 *
 * What is worth asserting here is not that the calls happen but the order and the refusals: the run
 * is written before the marker that points at it, the marker is cleared before the load that could
 * throw, and a save that could not be written stops the restart instead of taking the playthrough
 * down with it. Every one of those is a single line that reads as fine either way.
 */
import { describe, expect, it, vi } from "vitest";
import { LOCALE_RESTART_RESUME_KEY } from "@shared/types/localization";
import { LOCALE_RESTART_SAVE_ID } from "@shared/types/saves";
import {
    applyLocaleChange,
    resumeAfterLocaleRestart,
    type LocaleChangeSeam,
    type LocaleResumeSeam,
} from "./localeRestart";

function changeSeam(overrides: Partial<LocaleChangeSeam> = {}): {
    seam: LocaleChangeSeam;
    trace: string[];
    reports: Array<{ level: string; message: string }>;
} {
    const trace: string[] = [];
    const reports: Array<{ level: string; message: string }> = [];
    const seam: LocaleChangeSeam = {
        isPlaythroughRunning: () => true,
        writeSave: async id => {
            trace.push(`write:${id}`);
        },
        persistenceSet: async (key, value) => {
            trace.push(`persist:${key}=${String(value)}`);
        },
        restartApplication: async () => {
            trace.push("restart");
        },
        report: (level, message) => {
            reports.push({ level, message });
        },
        ...overrides,
    };
    return { seam, trace, reports };
}

describe("applyLocaleChange", () => {
    it("leaves a title screen alone", async () => {
        const { seam, trace } = changeSeam({ isPlaythroughRunning: () => false });

        await expect(applyLocaleChange(seam)).resolves.toBe("switched");

        // The common case by far: most players pick a language before they start playing, and
        // restarting the game for them would be a restart of nothing.
        expect(trace).toEqual([]);
    });

    it("parks the run, marks the resume, then restarts - in that order", async () => {
        const { seam, trace } = changeSeam();

        await expect(applyLocaleChange(seam)).resolves.toBe("restarting");

        expect(trace).toEqual([
            `write:${LOCALE_RESTART_SAVE_ID}`,
            `persist:${LOCALE_RESTART_RESUME_KEY}=${LOCALE_RESTART_SAVE_ID}`,
            "restart",
        ]);
    });

    it("does not restart when the run could not be saved", async () => {
        const { seam, trace, reports } = changeSeam({
            writeSave: async () => {
                throw new Error("the store is full");
            },
        });

        await expect(applyLocaleChange(seam)).resolves.toBe("failed");

        // A restart here would be the playthrough gone, which is worse than a session that shows
        // two languages until it ends.
        expect(trace).toEqual([]);
        expect(reports[0]?.level).toBe("error");
        expect(reports[0]?.message).toContain("the store is full");
    });

    it("does not restart when the resume marker could not be written", async () => {
        const { seam, trace } = changeSeam({
            persistenceSet: async () => {
                throw new Error("no store");
            },
        });

        await expect(applyLocaleChange(seam)).resolves.toBe("failed");

        // The save exists but nothing would ever read it, so the restart would land on the title
        // screen with the run stranded.
        expect(trace).toEqual([`write:${LOCALE_RESTART_SAVE_ID}`]);
    });

    it("says so when the host cannot restart at all", async () => {
        const { seam, trace, reports } = changeSeam({ restartApplication: undefined });

        await expect(applyLocaleChange(seam)).resolves.toBe("unsupported");

        expect(trace).toEqual([]);
        expect(reports[0]?.level).toBe("warning");
    });
});

function resumeSeam(overrides: Partial<LocaleResumeSeam> = {}): {
    seam: LocaleResumeSeam;
    trace: string[];
    reports: Array<{ level: string; message: string }>;
} {
    const trace: string[] = [];
    const reports: Array<{ level: string; message: string }> = [];
    const seam: LocaleResumeSeam = {
        persistenceGetAsync: async () => LOCALE_RESTART_SAVE_ID,
        persistenceSet: async (key, value) => {
            trace.push(`persist:${key}=${String(value)}`);
        },
        loadSave: async id => {
            trace.push(`load:${id}`);
            return true;
        },
        deleteSave: async id => {
            trace.push(`delete:${id}`);
        },
        report: (level, message) => {
            reports.push({ level, message });
        },
        ...overrides,
    };
    return { seam, trace, reports };
}

describe("resumeAfterLocaleRestart", () => {
    it("does nothing on an ordinary boot", async () => {
        const { seam, trace } = resumeSeam({ persistenceGetAsync: async () => undefined });

        await expect(resumeAfterLocaleRestart(seam)).resolves.toBe("none");

        expect(trace).toEqual([]);
    });

    it("clears the marker before loading, then drops the parked save", async () => {
        const { seam, trace } = resumeSeam();

        await expect(resumeAfterLocaleRestart(seam)).resolves.toBe("resumed");

        expect(trace).toEqual([
            `persist:${LOCALE_RESTART_RESUME_KEY}=undefined`,
            `load:${LOCALE_RESTART_SAVE_ID}`,
            `delete:${LOCALE_RESTART_SAVE_ID}`,
        ]);
    });

    it("cannot be tried twice by the next boot when the load throws", async () => {
        // The failure mode this order exists for: a save the engine will not take, retried by every
        // boot, is a game that can never reach its title screen again.
        const { seam, trace } = resumeSeam({
            loadSave: async () => {
                throw new Error("deserialize failed");
            },
        });

        await expect(resumeAfterLocaleRestart(seam)).resolves.toBe("failed");

        expect(trace).toEqual([`persist:${LOCALE_RESTART_RESUME_KEY}=undefined`]);
    });

    it("keeps the parked save when it was refused", async () => {
        const { seam, trace, reports } = resumeSeam({ loadSave: async () => false });

        await expect(resumeAfterLocaleRestart(seam)).resolves.toBe("failed");

        // Not deleted: it is the only copy of a run the player did not choose to end, and the load
        // path has already reported why it would not take it. What is said here is only that the
        // record is still there, which nothing else would tell anyone.
        expect(trace).not.toContain(`delete:${LOCALE_RESTART_SAVE_ID}`);
        expect(reports.map(entry => entry.level)).toEqual(["info", "warning"]);
        expect(reports[1]?.message).toContain("still stored");
    });

    it("still counts as resumed when the parked save cannot be deleted", async () => {
        const deleteSave = vi.fn(async () => {
            throw new Error("read-only");
        });
        const { seam } = resumeSeam({ deleteSave });

        await expect(resumeAfterLocaleRestart(seam)).resolves.toBe("resumed");

        expect(deleteSave).toHaveBeenCalled();
    });
});
