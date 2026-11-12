import { describe, expect, it } from "vitest";
import { storyDocumentSpec } from "@shared/documents/specs";
import { interfaceDocumentFreezeScope } from "../ui-editor/uiLiveSession";
import { agentLockBlocking } from "./useAgentEditorLocks";

/** Which controls an agent's editor lock reaches: those whose scope names a document of the locked editor. */
describe("agentLockBlocking", () => {
    const story = storyDocumentSpec.pathFor({ storyId: "s1" });

    it("locks a control scoped to a document of the locked editor", () => {
        expect(agentLockBlocking({ story: { overridden: false } }, story)).toBe("story");
        expect(agentLockBlocking({ interface: { overridden: false } }, interfaceDocumentFreezeScope())).toBe("interface");
    });

    it("leaves the other editor, an overridden lock and an unscoped control alone", () => {
        expect(agentLockBlocking({ interface: { overridden: false } }, story)).toBeNull();
        expect(agentLockBlocking({ story: { overridden: true } }, story)).toBeNull();
        expect(agentLockBlocking({ story: { overridden: false } }, undefined)).toBeNull();
    });
});
