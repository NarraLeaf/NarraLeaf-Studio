import { describe, expect, it } from "vitest";
import { GlobalSettingDraft } from "./globalSettingDraft";

function pending() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

describe("editable preference persistence", () => {
    it("retains a failed draft and writes it again on retry", async () => {
        let fail = true;
        const writes: string[] = [];
        const draft = new GlobalSettingDraft("old", value => value, async value => {
            writes.push(value);
            if (fail) throw new Error("disk full");
        });
        draft.edit("new");
        await Promise.resolve();
        expect(draft.getSnapshot()).toEqual({ value: "new", failed: true, saving: false });
        draft.receive("external");
        expect(draft.getSnapshot().value).toBe("new");
        fail = false;
        draft.retry();
        await Promise.resolve();
        expect(writes).toEqual(["new", "new"]);
        expect(draft.getSnapshot().failed).toBe(false);
    });

    it("serializes changes and keeps partial draft fields through its own broadcast", async () => {
        const requests: ReturnType<typeof pending>[] = [];
        const values: string[] = [];
        const draft = new GlobalSettingDraft("", value => value.trim(), value => {
            values.push(value);
            const request = pending();
            requests.push(request);
            return request.promise;
        });
        draft.edit(" first ");
        draft.edit(" second ");
        expect(values).toEqual(["first"]);
        draft.receive("first");
        expect(draft.getSnapshot().value).toBe(" second ");
        requests[0].resolve();
        await Promise.resolve();
        expect(values).toEqual(["first", "second"]);
        requests[1].resolve();
        await Promise.resolve();
        draft.receive("second");
        expect(draft.getSnapshot()).toEqual({ value: " second ", failed: false, saving: false });
    });

    it("does not persist incomplete rows that normalize to the confirmed value", () => {
        const writes: string[] = [];
        const draft = new GlobalSettingDraft("", value => value.trim(), async value => { writes.push(value); });
        draft.edit(" ");
        expect(writes).toEqual([]);
        expect(draft.getSnapshot().value).toBe(" ");
    });
});
