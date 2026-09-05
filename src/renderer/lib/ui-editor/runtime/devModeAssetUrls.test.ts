import { afterEach, describe, expect, it } from "vitest";
import {
    clearDevModeAssetUrls,
    devModeAssetUrlCount,
    publishDevModeAssetUrls,
    resolveDevModeAssetUrl,
} from "./devModeAssetUrls";

afterEach(() => {
    clearDevModeAssetUrls();
});

/**
 * The contract every consumer leans on is the *fallback*, not the hit: an id this map cannot answer
 * has to come back as null, because the caller's next move is to ask for a grant of its own. A map
 * that answered a stale URL, or threw, would leave the widget drawing nothing.
 */
describe("devModeAssetUrls", () => {
    it("answers null until a window has published its map", () => {
        expect(resolveDevModeAssetUrl("a")).toBeNull();
        expect(devModeAssetUrlCount()).toBe(0);
    });

    it("answers the published URL, and null for an id it has never heard of", () => {
        publishDevModeAssetUrls(new Map([["a", "app://fs/token-a"]]));
        expect(resolveDevModeAssetUrl("a")).toBe("app://fs/token-a");
        expect(resolveDevModeAssetUrl("b")).toBeNull();
    });

    it("answers null again once the assets under it may have moved", () => {
        publishDevModeAssetUrls(new Map([["a", "app://fs/token-a"]]));
        clearDevModeAssetUrls();
        expect(resolveDevModeAssetUrl("a")).toBeNull();
    });

    it("replaces the map rather than merging into it", () => {
        publishDevModeAssetUrls(new Map([["a", "app://fs/one"]]));
        publishDevModeAssetUrls(new Map([["b", "app://fs/two"]]));
        expect(resolveDevModeAssetUrl("a")).toBeNull();
        expect(resolveDevModeAssetUrl("b")).toBe("app://fs/two");
    });

    it("says nothing for an empty id, which is what an unset prop looks like", () => {
        publishDevModeAssetUrls(new Map([["a", "app://fs/one"]]));
        expect(resolveDevModeAssetUrl("")).toBeNull();
        expect(resolveDevModeAssetUrl(null)).toBeNull();
        expect(resolveDevModeAssetUrl(undefined)).toBeNull();
    });
});
