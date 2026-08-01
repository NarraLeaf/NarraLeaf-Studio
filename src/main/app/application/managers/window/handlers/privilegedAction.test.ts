import { describe, expect, it, vi } from "vitest";
import { WindowAppType } from "@shared/types/window";
import { IPCEventType, type IPCEvents } from "@shared/types/ipcEvents";
import type { AppWindow } from "../appWindow";

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
