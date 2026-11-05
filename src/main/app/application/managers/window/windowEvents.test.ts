import { describe, expect, it } from "vitest";
import type { AppWindow } from "./appWindow";
import { WindowEventManager } from "./windowEvents";

const window = {} as AppWindow;

function subscribed() {
    const events = new WindowEventManager();
    const heard: string[] = [];
    events.onClose(() => heard.push("close"));
    events.onEvent("closed", () => {
        heard.push("closed");
    });
    return { events, heard };
}

describe("WindowEventManager.emitClosed", () => {
    it("tells close subscribers about a window that went without a close request", () => {
        // `destroy()`, or the page calling `window.close()`: Electron fires `closed` and nothing else.
        const { events, heard } = subscribed();

        events.emitClosed(window);

        expect(heard).toEqual(["close", "closed"]);
    });

    it("does not tell them twice about a window that was closed the ordinary way", () => {
        const { events, heard } = subscribed();

        events.emit("close", window);
        events.emitClosed(window);

        expect(heard).toEqual(["close", "closed"]);
    });
});
