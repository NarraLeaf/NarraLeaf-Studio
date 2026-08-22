import { describe, expect, it } from "vitest";
import type { LiveEffect } from "@shared/live/ops";
import { LiveEffectLog } from "./effectLog";

function effect(seq: number): LiveEffect {
    return { kind: "effect", by: "host", seq, op: { op: "rename-story", name: `take ${seq}` } };
}

describe("the effect log", () => {
    it("hands back everything after the sequence a guest names, in order", () => {
        const log = new LiveEffectLog();
        for (const seq of [1, 2, 3, 4]) {
            log.append(effect(seq));
        }

        expect(log.after(2).map(entry => entry.seq)).toEqual([3, 4]);
        expect(log.after(0).map(entry => entry.seq)).toEqual([1, 2, 3, 4]);
        expect(log.after(4)).toEqual([]);
    });

    it("reports what it holds", () => {
        const log = new LiveEffectLog();
        expect(log.length).toBe(0);
        expect(log.lastSeq).toBe(0);

        log.append(effect(7));
        expect(log.length).toBe(1);
        expect(log.lastSeq).toBe(7);
    });

    it("hands back the effects themselves, not copies of them", () => {
        // A catch-up carries what the host broadcast the first time. A rebuilt effect would be a
        // second chance to get one wrong, and the guest applying it has no way to tell.
        const log = new LiveEffectLog();
        const only = effect(1);
        log.append(only);

        expect(log.after(0)[0]).toBe(only);
    });
});
