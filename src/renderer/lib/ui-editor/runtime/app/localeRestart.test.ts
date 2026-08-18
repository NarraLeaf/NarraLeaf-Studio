/**
 * The two halves of a language restart, driven directly.
 *
 * What is worth asserting here is not that the calls happen but the order and the refusals: the run
 * is written before the marker that points at it, the marker is cleared before the load that could
 * throw, and a save that could not be written stops the restart instead of taking the playthrough
 * down with it. Every one of those is a single line that reads as fine either way.
 */
import { describe, expect, it, vi } from "vitest";
import {
    LOCALE_PENDING_KEY,
    LOCALE_RESTART_FRESH_KEY,
    LOCALE_RESTART_RESUME_KEY,
    LOCALE_STORAGE_KEY,
} from "@shared/types/localization";
import { LOCALE_RESTART_SAVE_ID } from "@shared/types/saves";
import {
    applyLocaleChange,
    consumeFreshRestart,
    promotePendingLocale,
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
        inGame: "resume",
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

        await expect(applyLocaleChange(seam, "ja")).resolves.toBe("switched");

        // The common case by far: most players pick a language before they start playing. The
        // language is stored and nothing else happens - no save, no restart.
        expect(trace).toEqual([`persist:${LOCALE_STORAGE_KEY}=ja`]);
    });

    it("parks the run, marks the resume, then restarts - in that order", async () => {
        const { seam, trace } = changeSeam();

        await expect(applyLocaleChange(seam, "ja")).resolves.toBe("restarting");

        expect(trace).toEqual([
            // The language first: the boot that follows reads it to know what to come back in.
            `persist:${LOCALE_STORAGE_KEY}=ja`,
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

        await expect(applyLocaleChange(seam, "ja")).resolves.toBe("failed");

        // A restart here would be the playthrough gone, which is worse than a session that shows
        // two languages until it ends. The language itself still changed.
        expect(trace).toEqual([`persist:${LOCALE_STORAGE_KEY}=ja`]);
        expect(reports[0]?.level).toBe("error");
        expect(reports[0]?.message).toContain("the store is full");
    });

    it("does not restart when the resume marker could not be written", async () => {
        // Only the marker refuses. The language itself landed, which is why the run is still worth
        // protecting: without the marker nothing would ever read the save the restart left behind.
        const { seam, trace } = changeSeam({
            persistenceSet: async (key, value) => {
                if (key === LOCALE_RESTART_RESUME_KEY) {
                    throw new Error("no store");
                }
                trace.push(`persist:${key}=${String(value)}`);
            },
        });

        await expect(applyLocaleChange(seam, "ja")).resolves.toBe("failed");

        // The save exists but nothing would ever point a boot at it, so a restart would land on
        // the title screen with the run stranded.
        expect(trace).toEqual([`persist:${LOCALE_STORAGE_KEY}=ja`, `write:${LOCALE_RESTART_SAVE_ID}`]);
    });

    it("restarts without keeping the run when the project asked for that", async () => {
        const { seam, trace, reports } = changeSeam({ inGame: "restart" });

        await expect(applyLocaleChange(seam, "ja")).resolves.toBe("restartingWithoutSave");

        // No save of the run is written at all: this project asked for a language change to be a
        // fresh start. The one write besides the language is the note that says so to the launch
        // that follows, which is what keeps Dev Mode from quietly keeping the run.
        expect(trace).toEqual([
            `persist:${LOCALE_STORAGE_KEY}=ja`,
            `persist:${LOCALE_RESTART_FRESH_KEY}=1`,
            "restart",
        ]);
        expect(reports.map(entry => entry.level)).toEqual(["info"]);
    });

    it("keeps the choice for the next launch without touching this session", async () => {
        // The whole point of this answer: the player is left in the language they were reading,
        // interface included, so the live key must not be written.
        const { seam, trace, reports } = changeSeam({ inGame: "nextLaunch" });

        await expect(applyLocaleChange(seam, "ja")).resolves.toBe("deferred");

        expect(trace).toEqual([`persist:${LOCALE_PENDING_KEY}=ja`]);
        expect(reports).toEqual([]);
    });

    it("applies a deferred choice at once on a title screen", async () => {
        // Nothing is running to be inconsistent with, so deferring would only mean the player
        // picking a language and watching nothing happen.
        const { seam, trace } = changeSeam({ inGame: "nextLaunch", isPlaythroughRunning: () => false });

        await expect(applyLocaleChange(seam, "ja")).resolves.toBe("switched");

        expect(trace).toEqual([`persist:${LOCALE_STORAGE_KEY}=ja`]);
    });

    it("says so when the host cannot restart at all", async () => {
        const { seam, trace, reports } = changeSeam({ restartApplication: undefined });

        await expect(applyLocaleChange(seam, "ja")).resolves.toBe("unsupported");

        // The language still changes; what cannot happen is the restart that would make the rest of
        // the session agree with it.
        expect(trace).toEqual([`persist:${LOCALE_STORAGE_KEY}=ja`]);
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

describe("consumeFreshRestart", () => {
    function freshSeam(stored: unknown) {
        const trace: string[] = [];
        return {
            trace,
            seam: {
                persistenceGetAsync: async () => stored,
                persistenceSet: async (key: string, value: unknown) => {
                    trace.push(`persist:${key}=${String(value)}`);
                },
            },
        };
    }

    it("says no on an ordinary launch, and writes nothing", async () => {
        const { seam, trace } = freshSeam(undefined);

        await expect(consumeFreshRestart(seam)).resolves.toBe(false);

        expect(trace).toEqual([]);
    });

    it("says yes once and clears the note", async () => {
        // Cleared as it is answered: a note left behind would end the playthrough of every launch
        // after this one.
        const { seam, trace } = freshSeam("1");

        await expect(consumeFreshRestart(seam)).resolves.toBe(true);

        expect(trace).toEqual([`persist:${LOCALE_RESTART_FRESH_KEY}=undefined`]);
    });
});

describe("promotePendingLocale", () => {
    function pendingSeam(stored: unknown) {
        const trace: string[] = [];
        return {
            trace,
            seam: {
                persistenceGetAsync: async () => stored,
                persistenceSet: async (key: string, value: unknown) => {
                    trace.push(`persist:${key}=${String(value)}`);
                },
            },
        };
    }

    it("does nothing on an ordinary launch", async () => {
        const { seam, trace } = pendingSeam(undefined);

        await expect(promotePendingLocale(seam)).resolves.toBeNull();

        expect(trace).toEqual([]);
    });

    it("moves the deferred choice into place and clears it", async () => {
        const { seam, trace } = pendingSeam("ja");

        await expect(promotePendingLocale(seam)).resolves.toBe("ja");

        // Cleared as it is applied, so the launch after this one is an ordinary launch.
        expect(trace).toEqual([
            `persist:${LOCALE_STORAGE_KEY}=ja`,
            `persist:${LOCALE_PENDING_KEY}=undefined`,
        ]);
    });

    it("ignores anything that is not a language", async () => {
        const { seam, trace } = pendingSeam(42);

        await expect(promotePendingLocale(seam)).resolves.toBeNull();

        expect(trace).toEqual([]);
    });
});
