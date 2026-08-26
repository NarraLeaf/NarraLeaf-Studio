// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
    assetClaimKey,
    characterClaimKey,
    localizationKeyClaimKey,
    storyRowClaimKey,
    translationClaimKey,
    variableClaimKey,
} from "@shared/live/ops";
import { IDLE_LIVE_SESSION, type LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import type { TeamLiveSession } from "@shared/types/team";
import { othersVariableClaims } from "./variablesLiveSession";
import { othersLocalizationKeyClaims } from "../localization/localizationLiveSession";

/**
 * Which entries wear somebody else's name, out of a claim set that holds every kind at once.
 *
 * ⚠ **The failure this pins has happened.** `view.claims` is one map carrying rows, character
 * records, translations, asset records and now registry entries, under a prefixed key space; a
 * reader that took the whole map produced marks that never appeared and a holder lookup that always
 * answered null - the injury the claim exists to prevent, one gesture late, with every test passing.
 *
 * So the fixtures below build their keys with the product's own key functions and never by hand,
 * which is the only way a test and a reader cannot be wrong together.
 */

function room(): TeamLiveSession {
    return {
        id: "room-1",
        project: "abc",
        openedBy: "bob",
        openedByInstance: "bob-1",
        openedAt: 1,
        members: [
            { instance: "mine", account: "ada", label: "Nomen", joinedAt: 1 },
            { instance: "bob-1", account: "bob", label: "iMac", joinedAt: 1 },
        ],
    };
}

function session(claims: Record<string, string>): LiveSessionView {
    return {
        ...IDLE_LIVE_SESSION,
        phase: "active",
        role: "guest",
        session: room(),
        self: "mine",
        claims,
    };
}

/** One set holding one claim of every kind, keyed as the wire keys them. */
const MIXED = session({
    [variableClaimKey("v1")]: "bob",
    [variableClaimKey("v2")]: "ada",
    [localizationKeyClaimKey("menu.start")]: "bob",
    [localizationKeyClaimKey("menu.quit")]: "ada",
    [storyRowClaimKey("v1")]: "bob",
    [characterClaimKey("v1")]: "bob",
    [assetClaimKey("v1")]: "bob",
    [translationClaimKey("ja", "key:menu.start")]: "bob",
});

describe("the variable entries somebody else is inside", () => {
    it("reads its own prefix and strips it, and reads no other kind", () => {
        // ⚠ `translation:ja:key:menu.start` and `named-key:menu.start` are both in the set: the same
        // string has a claim over its source text and one per language over its translation.
        expect(othersVariableClaims(MIXED)).toEqual({ v1: "bob" });
    });

    it("leaves this window's own claims out, so a mark is never about its reader", () => {
        expect(othersVariableClaims(MIXED).v2).toBeUndefined();
    });

    it("answers nothing outside a session", () => {
        expect(othersVariableClaims(IDLE_LIVE_SESSION)).toEqual({});
    });
});

describe("the named strings somebody else is inside", () => {
    it("reads its own prefix and strips it, and never the translation of the same string", () => {
        expect(othersLocalizationKeyClaims(MIXED)).toEqual({ "menu.start": "bob" });
    });

    it("answers nothing outside a session", () => {
        expect(othersLocalizationKeyClaims(IDLE_LIVE_SESSION)).toEqual({});
    });
});
