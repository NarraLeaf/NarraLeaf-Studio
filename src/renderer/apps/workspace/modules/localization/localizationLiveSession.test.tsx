// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LiveSessionView } from "@/lib/workspace/services/live/liveSessionView";
import {
    othersLocalizationKeyClaims,
    othersTranslationClaims,
    useLocalizationKeyClaim,
    useTranslationClaim,
} from "./localizationLiveSession";

describe("localization claims", () => {
    it("treats inherited property names as unclaimed outside a session", () => {
        const { result } = renderHook(() => ({
            translation: useTranslationClaim("constructor"),
            key: useLocalizationKeyClaim("constructor"),
        }));
        expect(result.current).toEqual({ translation: null, key: null });
    });

    it("keeps arbitrary translation ids and valid key names as ordinary claims", () => {
        const view = {
            self: "self",
            session: { members: [{ instance: "self", account: "me" }] },
            claims: {
                "translation:ja:__proto__": "translator",
                "translation:ja:constructor": "another translator",
                "named-key:constructor": "author",
            },
        } as unknown as LiveSessionView;
        const translations = othersTranslationClaims(view, "ja");
        const keys = othersLocalizationKeyClaims(view);
        expect(Object.keys(translations).sort()).toEqual(["__proto__", "constructor"]);
        expect(translations["__proto__"]).toBe("translator");
        expect(translations.constructor).toBe("another translator");
        expect(keys.constructor).toBe("author");
    });
});
