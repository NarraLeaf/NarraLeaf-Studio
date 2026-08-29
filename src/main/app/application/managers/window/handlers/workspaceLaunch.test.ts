import { describe, expect, it, vi } from "vitest";
import type { AppWindow } from "../appWindow";
import { WorkspaceLaunchHandler } from "./workspaceAction";

/**
 * What a launcher asking for a project carries with it.
 *
 * ⚠ **The props are not passed on.** `openProject` builds the window's props itself - it has to,
 * because the project may already be open and the request then goes to that window instead - so
 * this handler has to name every field it wants carried, one at a time. A field it does not name
 * is a field that silently never arrives, and the two ends both look right: the launcher set it and
 * the workspace read its props.
 *
 * That is not hypothetical. `joinLive` was added at both ends, unit-tested at both ends, and did
 * nothing at all on a real machine because this line was `{ replaceOpener }` and nothing else.
 */

function handler() {
    const openProject = vi.fn(async () => undefined);
    const window = { getApp: () => ({ openProject }) } as unknown as AppWindow;
    return { window, openProject };
}

describe("launching a workspace from the launcher", () => {
    it("carries the room the launcher wants this project joined to", async () => {
        const { window, openProject } = handler();

        await new WorkspaceLaunchHandler().handle(window, {
            props: { projectPath: "D:/games/moonlit", joinLive: { session: "room-1" } },
            closeCurrentWindow: true,
        });

        expect(openProject).toHaveBeenCalledWith(window, "D:/games/moonlit", {
            replaceOpener: true,
            joinLive: { session: "room-1" },
        });
    });

    it("carries a passcode as a passcode, because a code room refuses its own id", async () => {
        const { window, openProject } = handler();

        await new WorkspaceLaunchHandler().handle(window, {
            props: { projectPath: "D:/games/moonlit", joinLive: { code: "4821" } },
            closeCurrentWindow: false,
        });

        expect(openProject).toHaveBeenCalledWith(window, "D:/games/moonlit", {
            replaceOpener: false,
            joinLive: { code: "4821" },
        });
    });

    it("says nothing about a room for an ordinary open", async () => {
        // Absent rather than undefined: `openProject` spreads what it is given into window props,
        // and a key with no value is a key the canonical encoder and every reader has to think about.
        const { window, openProject } = handler();

        await new WorkspaceLaunchHandler().handle(window, {
            props: { projectPath: "D:/games/moonlit" },
            closeCurrentWindow: false,
        });

        expect(openProject).toHaveBeenCalledWith(window, "D:/games/moonlit", { replaceOpener: false });
    });
});
