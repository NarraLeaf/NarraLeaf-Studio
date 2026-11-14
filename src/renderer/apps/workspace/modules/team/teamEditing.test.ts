import { describe, expect, it } from "vitest";
import type { TeamClientInstance } from "@shared/types/team";

import { othersEditing } from "./TeamEditingNotice";
import { teamEditingDocument } from "./teamEditing";

describe("the document a tab is about, in Team's terms", () => {
    it("names a story for any of its scenes and its flow, and a blueprint as ui:", () => {
        expect(teamEditingDocument({ id: "story:scene:s1:c1", payload: { storyId: "s1", sceneId: "c1" } })).toBe("story:s1");
        expect(teamEditingDocument({ id: "story:flow:s1" })).toBe("story:s1");
        expect(teamEditingDocument({ id: "narraleaf-studio:character-editor-x" })).toBeNull();
        expect(teamEditingDocument(null)).toBeNull();
    });
});

describe("who else is in it", () => {
    const client = (id: string, fields: Partial<TeamClientInstance>): TeamClientInstance =>
        ({ id, account: id, label: id, agent: "studio", since: 0, ...fields });

    it("leaves this window out, and puts whoever came first first", () => {
        const clients = [
            client("me", { editing: "story:s1", editingSince: 1 }),
            client("late", { editing: "story:s1", editingSince: 30 }),
            client("early", { editing: "story:s1", editingSince: 10 }),
            client("elsewhere", { editing: "story:s2", editingSince: 5 }),
            client("idle", {}),
        ];
        expect(othersEditing(clients, "story:s1", "me").map(c => c.id)).toEqual(["early", "late"]);
        expect(othersEditing(clients, null, "me")).toEqual([]);
    });
});
