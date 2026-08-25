import { describe, expect, it } from "vitest";
import type { LiveEffect } from "@shared/live/ops";
import { DEFAULT_RECEIPT_MEMORY, LiveReceipts } from "./receipts";

function effect(seq: number): LiveEffect {
    return {
        kind: "effect",
        by: "host",
        seq,
        document: { doc: "story", storyId: "story-1" },
        op: { op: "rename-story", name: `take ${seq}` },
    };
}

describe("the receipt memory", () => {
    it("hands back the very answer it was given", () => {
        const receipts = new LiveReceipts();
        const answer = effect(1);
        receipts.remember("c1", answer);

        expect(receipts.get("c1")).toBe(answer);
        expect(receipts.get("c2")).toBeNull();
    });

    it("drops the oldest answer once it is full", () => {
        const receipts = new LiveReceipts(2);
        receipts.remember("c1", effect(1));
        receipts.remember("c2", effect(2));
        receipts.remember("c3", effect(3));

        expect(receipts.size).toBe(2);
        // A retry of c1 now looks like an intent nobody has seen, and is applied a second time.
        expect(receipts.get("c1")).toBeNull();
        expect(receipts.get("c2")).not.toBeNull();
        expect(receipts.get("c3")).not.toBeNull();
    });

    it("keeps a sane number of answers by default", () => {
        const receipts = new LiveReceipts();
        for (let index = 0; index < DEFAULT_RECEIPT_MEMORY + 10; index += 1) {
            receipts.remember(`c${index}`, effect(index));
        }

        expect(receipts.size).toBe(DEFAULT_RECEIPT_MEMORY);
    });
});
