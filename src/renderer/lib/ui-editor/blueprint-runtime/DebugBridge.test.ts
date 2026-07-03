import { describe, expect, it } from "vitest";
import {
    DebugBridge,
    MAX_DEBUG_EVENT_BUFFER_LENGTH,
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

    it("keeps the most recent events up to the debug buffer limit", () => {
        const debug = new DebugBridge();

        for (let i = 0; i < MAX_DEBUG_EVENT_BUFFER_LENGTH + 5; i += 1) {
            debug.emit({ type: "devtools.log", level: "info", message: `message-${i}` });
        }

        const snapshot = debug.snapshot();
        expect(snapshot).toHaveLength(MAX_DEBUG_EVENT_BUFFER_LENGTH);
        expect(snapshot[0]).toMatchObject({ message: "message-5" });
        expect(snapshot.at(-1)).toMatchObject({ message: `message-${MAX_DEBUG_EVENT_BUFFER_LENGTH + 4}` });
    });
});
