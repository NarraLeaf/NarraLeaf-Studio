import { describe, expect, it } from "vitest";
import type { LocalizationUnit } from "@shared/types/localization";
import type { VoiceUnit } from "@shared/types/voice";
import { takesDigest, translationsDigest } from "./libraries";

const UNIT: LocalizationUnit = { target: "遅いよ。", sourceHash: "h1", status: "translated" };
const TAKE: VoiceUnit = { assetId: "clip-1", sourceHash: "h1", status: "linked" };

describe("translationsDigest", () => {
    it("agrees for two copies built in different key orders", () => {
        // Two machines assemble a library by different routes - one parsed off disk, one written
        // entry by entry as effects arrived - and a comparison that saw those as different would
        // report a disagreement nobody could act on.
        const one = { a: UNIT, b: { ...UNIT, target: "早いね。" } };
        const other = { b: { ...UNIT, target: "早いね。" }, a: { sourceHash: "h1", status: UNIT.status, target: UNIT.target } };
        expect(translationsDigest(one)).toBe(translationsDigest(other));
    });

    it("differs when a word differs, which is the whole point of computing it", () => {
        expect(translationsDigest({ a: UNIT })).not.toBe(translationsDigest({ a: { ...UNIT, target: "早いね。" } }));
    });

    it("differs when an entry is removed, so a missed operation cannot hide", () => {
        // Clearing a translation removes its entry, which is how this document spells "no
        // translation" - so a machine that missed the clearing has to be caught by the same value.
        expect(translationsDigest({ a: UNIT })).not.toBe(translationsDigest({}));
    });

    it("notices a status change, because a review is work somebody did", () => {
        expect(translationsDigest({ a: UNIT })).not.toBe(translationsDigest({ a: { ...UNIT, status: "reviewed" } }));
    });

    it("hashes a library nobody holds to a value rather than to nothing", () => {
        // ⚠ The difference between this and a missing scene. Every language is read into memory on
        // the way into a session, so arriving at an effect without one means this machine failed at
        // something - and answering "nothing was compared" would excuse exactly the case where two
        // copies have already parted company.
        expect(translationsDigest(null)).not.toBe(translationsDigest({}));
        expect(translationsDigest(null)).toEqual(expect.any(String));
    });

    it("is short enough to ride on every effect", () => {
        expect(translationsDigest({ a: UNIT })).toHaveLength(16);
    });
});

describe("takesDigest", () => {
    it("notices a clip being re-pointed, and a take being removed", () => {
        expect(takesDigest({ a: TAKE })).not.toBe(takesDigest({ a: { ...TAKE, assetId: "clip-2" } }));
        expect(takesDigest({ a: TAKE })).not.toBe(takesDigest({}));
    });

    it("hashes a library nobody holds to a value, for the translations' reason", () => {
        expect(takesDigest(null)).not.toBe(takesDigest({}));
    });

    it("notices a take being approved, because a sign-off is work somebody did", () => {
        expect(takesDigest({ a: TAKE })).not.toBe(takesDigest({ a: { ...TAKE, status: "approved" } }));
    });
});
