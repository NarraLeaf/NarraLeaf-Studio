import {describe, expect, it} from "vitest";
import type {DocumentMergeDecision} from "./diff";
import {
    applyMergeDecisions,
    MergeChangeUnaddressableError,
    MergeChangeUndecidedError,
    mergeDecisionKey,
} from "./mergeApply";

/**
 * Putting the author's per-change answers back into a document.
 *
 * The half of tier two that can lose somebody's work without anything failing, so every case below
 * is one way that could happen: a conflict answered by nobody, a choice keyed differently from the
 * decision it belongs to, a removal that renumbers the rows around it.
 */

const unit = (target: string) => ({target, sourceHash: "h", status: "translated"});

function decision(
    path: readonly string[],
    outcome: DocumentMergeDecision["outcome"],
    mine: unknown,
    theirs: unknown,
): DocumentMergeDecision {
    return {
        path,
        outcome,
        mine: mine === undefined ? {present: false} : {present: true, value: mine},
        theirs: theirs === undefined ? {present: false} : {present: true, value: theirs},
    };
}

describe("mergeDecisionKey", () => {
    /**
     * The collision that would settle one change with the side chosen for another.
     *
     * Unit ids legitimately contain the separators anyone would join a path with - `key:ui/start`
     * is a valid one - so a joined key makes two different decisions indistinguishable, and the
     * author's answer lands on whichever one the map happened to keep.
     */
    it("does not collide when a segment contains a separator", () => {
        expect(mergeDecisionKey(["units", "a/b"])).not.toBe(mergeDecisionKey(["units/a", "b"]));
        expect(mergeDecisionKey(["units", "a.b"])).not.toBe(mergeDecisionKey(["units", "a", "b"]));
    });
});

describe("applyMergeDecisions", () => {
    const base = {
        schemaVersion: 1,
        locale: "ja",
        units: {greeting: unit("held"), onlyMine: unit("mine")},
    };

    it("takes the chosen side for a conflict", () => {
        const settled = applyMergeDecisions(
            "editor/localization/ja.json",
            base,
            [decision(["units", "greeting"], "conflict", unit("mine"), unit("theirs"))],
            {[mergeDecisionKey(["units", "greeting"])]: "theirs"},
        );
        expect(settled.units.greeting.target).toBe("theirs");
        // The value written is a copy, not the decision's own object: a caller that mutated the
        // result would otherwise change what a second apply of the same decisions produces.
        expect(settled.units.onlyMine.target).toBe("mine");
    });

    /**
     * **The rule the whole tier rests on.** Every other answer to "no choice recorded" ends with a
     * side nobody picked being written into a file the author will not re-read.
     */
    it("refuses a conflict nobody answered, naming it", () => {
        expect(() => applyMergeDecisions(
            "editor/localization/ja.json",
            base,
            [decision(["units", "greeting"], "conflict", unit("mine"), unit("theirs"))],
            {},
        )).toThrow(MergeChangeUndecidedError);
        expect(() => applyMergeDecisions(
            "editor/localization/ja.json",
            base,
            [decision(["units", "greeting"], "conflict", unit("mine"), unit("theirs"))],
            {},
        )).toThrow(/greeting/);
    });

    /**
     * An automatic row needs no entry, and flipping one is the same operation as answering a
     * conflict - which is what lets the main process rebuild the document from the flips alone.
     */
    it("keeps an automatic side by default and flips it on request", () => {
        const decisions = [decision(["units", "greeting"], "auto-theirs", unit("mine"), unit("theirs"))];
        expect(applyMergeDecisions("d.json", base, decisions, {}).units.greeting.target).toBe("theirs");
        expect(
            applyMergeDecisions("d.json", base, decisions, {
                [mergeDecisionKey(["units", "greeting"])]: "mine",
            }).units.greeting.target,
        ).toBe("mine");
    });

    /** A side that does not hold the entry: taking it removes it, which is a real answer. */
    it("removes an entry the chosen side does not have", () => {
        const settled = applyMergeDecisions(
            "d.json",
            base,
            [decision(["units", "onlyMine"], "conflict", unit("mine"), undefined)],
            {[mergeDecisionKey(["units", "onlyMine"])]: "theirs"},
        );
        expect(Object.prototype.hasOwnProperty.call(settled.units, "onlyMine")).toBe(false);
    });

    it("leaves the caller's document untouched", () => {
        const before = JSON.stringify(base);
        applyMergeDecisions(
            "d.json",
            base,
            [decision(["units", "greeting"], "conflict", unit("mine"), unit("theirs"))],
            {[mergeDecisionKey(["units", "greeting"])]: "mine"},
        );
        expect(JSON.stringify(base)).toBe(before);
    });

    /** An empty path names the document itself - what a spec answers with when it cannot merge. */
    it("takes a whole-document decision as the document", () => {
        const settled = applyMergeDecisions(
            "d.json",
            base,
            [decision([], "conflict", {schemaVersion: 1, locale: "ja", units: {}}, base)],
            {[mergeDecisionKey([])]: "theirs"},
        );
        expect(settled.units.greeting.target).toBe("held");
    });

    it("refuses a path the merged document does not have", () => {
        expect(() => applyMergeDecisions(
            "d.json",
            base,
            [decision(["glossary", "term"], "conflict", "a", "b")],
            {[mergeDecisionKey(["glossary", "term"])]: "mine"},
        )).toThrow(MergeChangeUnaddressableError);
    });

    /**
     * A list of records with ids is a keyed collection that happens to be stored in order, and it
     * is addressed as one: sibling order is the author's arrangement, identity is the id. The
     * mixer is the first format to need this - see `audioTracks.ts`.
     */
    it("settles an element of a list by its id rather than by where it sits", () => {
        const document = {tracks: [{id: "bgm", volume: 1}, {id: "sfx", volume: 1}]};

        const settled = applyMergeDecisions(
            "d.json",
            document,
            [decision(["tracks", "sfx"], "conflict", {id: "sfx", volume: 0.3}, {id: "sfx", volume: 0.9})],
            {[mergeDecisionKey(["tracks", "sfx"])]: "theirs"},
        );

        expect(settled.tracks).toEqual([{id: "bgm", volume: 1}, {id: "sfx", volume: 0.9}]);
    });

    /**
     * Removing by id is sound where removing by position is not: nothing in the list is addressed
     * by where it sits, so taking one out moves nothing any other decision names.
     */
    it("removes an element of a list by id, and says nothing when it is already gone", () => {
        const document = {tracks: [{id: "bgm", volume: 1}, {id: "sfx", volume: 1}]};

        const settled = applyMergeDecisions(
            "d.json",
            document,
            [
                decision(["tracks", "sfx"], "conflict", {id: "sfx", volume: 1}, undefined),
                decision(["tracks", "gone"], "conflict", {id: "gone", volume: 1}, undefined),
            ],
            {
                [mergeDecisionKey(["tracks", "sfx"])]: "theirs",
                [mergeDecisionKey(["tracks", "gone"])]: "theirs",
            },
        );

        expect(settled.tracks).toEqual([{id: "bgm", volume: 1}]);
    });

    /** The other direction: a record the merged document does not hold yet is appended. */
    it("puts back an element the chosen side has and the merged document does not", () => {
        const document = {tracks: [{id: "bgm", volume: 1}]};

        const settled = applyMergeDecisions(
            "d.json",
            document,
            [decision(["tracks", "sfx"], "conflict", undefined, {id: "sfx", volume: 0.5})],
            {[mergeDecisionKey(["tracks", "sfx"])]: "theirs"},
        );

        expect(settled.tracks).toEqual([{id: "bgm", volume: 1}, {id: "sfx", volume: 0.5}]);
    });

    /**
     * Deleting element 3 renumbers everything after it, so the rest of the list - addressed by
     * index - would settle the wrong elements. Refused rather than silently renumbering; an id
     * escapes this because it names an element rather than a position.
     */
    it("refuses to remove one element of a list by position", () => {
        const document = {order: ["a", "b", "c"]};
        expect(() => applyMergeDecisions(
            "d.json",
            document,
            [decision(["order", "1"], "conflict", "b", undefined)],
            {[mergeDecisionKey(["order", "1"])]: "theirs"},
        )).toThrow(/renumber/);
    });
});
