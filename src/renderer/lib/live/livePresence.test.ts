import { describe, expect, it } from "vitest";
import { isLivePresenceMessage, type LivePresenceMessage } from "@shared/live/presence";

import { LivePresence } from "./livePresence";

function room(self: string) {
    const sent: LivePresenceMessage[] = [];
    let changes = 0;
    let clock = 1000;
    const presence = new LivePresence({
        self,
        send: message => sent.push(message),
        changed: () => {
            changes += 1;
        },
        now: () => (clock += 1),
    });
    return { presence, sent, changes: () => changes };
}

describe("what a live room says about the people in it", () => {
    it("sends a cursor only when it moves", () => {
        const { presence, sent } = room("me");
        presence.setCursor("story:s1", "c1/b1");
        presence.setCursor("story:s1", "c1/b1");
        presence.setCursor("story:s1", "c1/b2");
        presence.setCursor(null, "c1/b2");
        expect(sent).toEqual([
            { kind: "cursor", document: "story:s1", element: "c1/b1" },
            { kind: "cursor", document: "story:s1", element: "c1/b2" },
            { kind: "cursor", document: null },
        ]);
    });

    it("keeps each other window's latest cursor, by the instance the server stamped, and never its own", () => {
        const { presence } = room("me");
        presence.receive({ kind: "cursor", document: "story:s1", element: "c/a" }, "w1", "bob");
        presence.receive({ kind: "cursor", document: "story:s1", element: "c/b" }, "w1", "bob");
        presence.receive({ kind: "cursor", document: "ui:x" }, "me", "ada");
        expect(presence.get().cursors.map(c => [c.instance, c.account, c.element])).toEqual([["w1", "bob", "c/b"]]);

        presence.receive({ kind: "cursor", document: null }, "w1", "bob");
        expect(presence.get().cursors).toEqual([]);
    });

    it("answers a window it has not heard from with where it is, once", () => {
        const { presence, sent } = room("me");
        presence.setCursor("story:s1", "c/a");
        sent.length = 0;
        presence.receive({ kind: "cursor", document: "story:s2" }, "w1", "bob");
        presence.receive({ kind: "cursor", document: "story:s3" }, "w1", "bob");
        expect(sent).toEqual([{ kind: "cursor", document: "story:s1", element: "c/a" }]);
    });

    it("shows a chat line once however often it arrives, and says which are its own", () => {
        const { presence, sent } = room("me");
        expect(presence.say("   ")).toBe(false);
        expect(presence.say(" hello ")).toBe(true);
        const mine = sent[0]!;
        presence.receive(mine, "me", "ada");
        presence.receive(mine, "me", "ada");
        presence.receive({ kind: "chat", id: "x1", text: "hi" }, "w1", "bob");
        expect(presence.get().chat.map(line => [line.account, line.text, line.mine])).toEqual([
            ["ada", "hello", true],
            ["bob", "hi", false],
        ]);
    });

    it("forgets windows that left", () => {
        const { presence } = room("me");
        presence.receive({ kind: "cursor", document: "story:s1" }, "w1", "bob");
        presence.receive({ kind: "cursor", document: "story:s1" }, "w2", "cy");
        presence.keepOnly(new Set(["w2"]));
        expect(presence.get().cursors.map(c => c.instance)).toEqual(["w2"]);
    });
});

describe("which payloads are presence", () => {
    it("takes well-formed cursors and chat lines, and nothing else", () => {
        expect(isLivePresenceMessage({ kind: "cursor", document: null })).toBe(true);
        expect(isLivePresenceMessage({ kind: "cursor", document: "story:s", element: "c/b" })).toBe(true);
        expect(isLivePresenceMessage({ kind: "cursor", document: "" })).toBe(false);
        expect(isLivePresenceMessage({ kind: "chat", id: "1", text: "x".repeat(2001) })).toBe(false);
        expect(isLivePresenceMessage({ kind: "intent" })).toBe(false);
        expect(isLivePresenceMessage(null)).toBe(false);
    });
});
