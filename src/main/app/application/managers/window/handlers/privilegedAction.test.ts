import { describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";
import { IPCEventType, type IPCEvents } from "@shared/types/ipcEvents";
import type { AppWindow } from "../appWindow";
import { WRITE_BATCH_MAX_ENTRIES } from "@shared/utils/writeBatchFrame";

/**
 * The file picker's chrome.
 *
 * `selectFile` is the one picker every workspace import goes through - story scripts, localization
 * CSVs, voice takes - and it hardcoded "Select Icon File", which was true of exactly one caller. The
 * title is the only sentence a native dialog gives the author about why it opened, so it has to be
 * the caller's; the default stays as it was so no existing caller changes.
 */

const showOpenDialog = vi.fn(async (_window: unknown, _options: Electron.OpenDialogOptions) => ({
    canceled: true,
    filePaths: [] as string[],
}));
vi.mock("electron", () => ({ dialog: { showOpenDialog } }));

/** Which paths this window may write. The batch grant asks once per path, exactly as the single-path
 *  verb does; the tests below are about what it does with a "no". */
const writable = new Set<string>();
vi.mock("../actorAuthorization", () => ({
    authorizeActorCapabilityRequest: () => ({ allowed: true }),
    authorizeActorFileSystemRequest: async (_window: unknown, _actor: unknown, fsPath: string) =>
        (writable.has(fsPath) ? { allowed: true } : { allowed: false, reason: `nope: ${fsPath}` }),
}));

const { PrivilegedFsCallHandler } = await import("./privilegedAction");

/** Only what the `selectFile` arm reads: the window's type (for its grant policy) and its native window. */
function workspaceWindow(): AppWindow {
    return {
        win: {},
        getWindowType: () => WindowAppType.Workspace,
    } as unknown as AppWindow;
}

async function openPicker(title?: string): Promise<Electron.OpenDialogOptions> {
    showOpenDialog.mockClear();
    const call: IPCEvents[IPCEventType.privilegedFsCall]["data"] = {
        actor: { kind: "facade", id: "default" },
        operation: "selectFile",
        filters: ["txt"],
        multiple: false,
        ...(title === undefined ? {} : { title }),
    };
    const result = await new PrivilegedFsCallHandler().handle(workspaceWindow(), call);
    expect(result.success).toBe(true);
    expect(showOpenDialog).toHaveBeenCalledTimes(1);
    return showOpenDialog.mock.calls[0][1];
}

describe("privileged selectFile dialog", () => {
    it("titles the dialog the way the caller asked", async () => {
        expect((await openPicker("Import Script")).title).toBe("Import Script");
    });

    it("keeps the old title when the caller names none, so no existing caller changes", async () => {
        expect((await openPicker()).title).toBe("Select Icon File");
    });
});

/**
 * A batched grant must not be a wider grant. Every path is authorized on its own, and a single "no"
 * refuses the whole thing - because the alternative is a set where the caller believes it holds a
 * grant over files that were in fact denied.
 */
describe("privileged requestWriteBatch", () => {
    function batchWindow(): { window: AppWindow; allocated: { entries: unknown[] }[]; readied: string[] } {
        const allocated: { entries: unknown[] }[] = [];
        const readied: string[] = [];
        const window = {
            win: {},
            getWindowType: () => WindowAppType.Workspace,
            app: {
                storageManager: {
                    allocateWriteBatchHash: (entries: unknown[]) => {
                        allocated.push({ entries });
                        return `grant-${allocated.length}`;
                    },
                    updateStatus: (hash: string) => readied.push(hash),
                },
            },
        } as unknown as AppWindow;
        return { window, allocated, readied };
    }

    async function request(paths: string[], host = batchWindow()) {
        const call: IPCEvents[IPCEventType.privilegedFsCall]["data"] = {
            actor: { kind: "facade", id: "default" },
            operation: "requestWriteBatch",
            entries: paths.map(target => ({ path: target, encoding: "utf-8" as const })),
        };
        const result = await new PrivilegedFsCallHandler().handle(host.window, call);
        return { host, result };
    }

    it("mints one grant naming every path, in order", async () => {
        writable.clear();
        for (const target of ["a.json", "b.json", "c.json"]) writable.add(target);

        const { host, result } = await request(["a.json", "b.json", "c.json"]);

        expect(result.success).toBe(true);
        expect((result.data as { ok: boolean; data: string }).ok).toBe(true);
        expect(host.allocated).toHaveLength(1);
        expect(host.allocated[0].entries).toEqual([
            { path: "a.json", raw: false, encoding: "utf-8" },
            { path: "b.json", raw: false, encoding: "utf-8" },
            { path: "c.json", raw: false, encoding: "utf-8" },
        ]);
        expect(host.readied).toEqual(["grant-1"]);
    });

    it("refuses the whole grant when one path is denied, and mints nothing", async () => {
        writable.clear();
        writable.add("allowed.json");

        const { host, result } = await request(["allowed.json", "../../etc/passwd"]);

        const answer = result.data as { ok: boolean; error?: { message: string } };
        expect(answer.ok).toBe(false);
        expect(answer.error!.message).toContain("../../etc/passwd");
        // The one that would have been let through must not be reachable either: half a grant is a
        // grant the caller cannot reason about.
        expect(host.allocated).toHaveLength(0);
    });

    it("refuses a grant that names one path twice", async () => {
        writable.clear();
        writable.add("same.json");

        const { host, result } = await request(["same.json", "same.json"]);

        const answer = result.data as { ok: boolean; error?: { message: string } };
        expect(answer.ok).toBe(false);
        expect(answer.error!.message).toContain("twice");
        expect(host.allocated).toHaveLength(0);
    });

    it("refuses an empty grant and one past the cap", async () => {
        writable.clear();

        const empty = await request([]);
        expect((empty.result.data as { ok: boolean }).ok).toBe(false);

        const many = Array.from({ length: WRITE_BATCH_MAX_ENTRIES + 1 }, (_, index) => `f${index}.json`);
        for (const target of many) writable.add(target);
        const overflowing = await request(many);
        const answer = overflowing.result.data as { ok: boolean; error?: { message: string } };
        expect(answer.ok).toBe(false);
        expect(answer.error!.message).toContain(String(WRITE_BATCH_MAX_ENTRIES));
        expect(overflowing.host.allocated).toHaveLength(0);
    });
});
