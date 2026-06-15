import { describe, expect, it } from "vitest";
import {
    DebugBridge,
    MAX_DEBUG_EVENT_MESSAGE_CHARS,
    truncateDebugEventMessage,
} from "./DebugBridge";

describe("DebugBridge", () => {
    it("truncates oversized devtools log messages before buffering", () => {
        const debug = new DebugBridge();
        const message = "x".repeat(MAX_DEBUG_EVENT_MESSAGE_CHARS + 100);

        debug.emit({ type: "devtools.log", level: "info", message });

        const [event] = debug.snapshot();
        expect(event).toEqual({
            type: "devtools.log",
            level: "info",
            message: truncateDebugEventMessage(message),
        });
        expect(event.type === "devtools.log" ? event.message.length : 0).toBeLessThan(message.length);
    });

    it("preserves messages that are already within the debug event size limit", () => {
        const debug = new DebugBridge();
        const message = "short message";

        debug.emit({ type: "devtools.log", level: "info", message });

        expect(debug.snapshot()).toEqual([{ type: "devtools.log", level: "info", message }]);
    });
});
