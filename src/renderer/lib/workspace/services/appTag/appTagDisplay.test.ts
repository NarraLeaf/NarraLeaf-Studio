import { describe, expect, it } from "vitest";
import { RELEASE_APP_TAG, type ProjectAppTag } from "@shared/types/appTag";
import { appTagDisplayName, displayedAppTags } from "./appTagDisplay";

/**
 * The release variant is synthesized under an untranslated name, and two surfaces show it. These
 * hold what went wrong when each substituted the catalog word for itself: the panel said the
 * translated word and the build dialog's picker said "Release", in the same language, with nothing
 * on screen to say they were the same variant.
 */

const demo: ProjectAppTag = { id: "tag-demo", name: "Demo", overrides: {} };

describe("app tag display names", () => {
    it("shows the release variant under the word the catalog gives", () => {
        expect(appTagDisplayName(RELEASE_APP_TAG, "正式版")).toBe("正式版");
    });

    it("leaves an authored variant's own name alone", () => {
        expect(appTagDisplayName(demo, "正式版")).toBe("Demo");
    });

    it("falls back to the model's word when no translation was passed", () => {
        expect(appTagDisplayName(RELEASE_APP_TAG, "   ")).toBe("Release");
    });

    it("names the picker's whole list the way the panel names its rows", () => {
        expect(displayedAppTags([RELEASE_APP_TAG, demo], "正式版").map(tag => tag.name))
            .toEqual(["正式版", "Demo"]);
    });

    it("renames nothing else about the release variant, so ids and overrides still resolve", () => {
        const [release] = displayedAppTags([RELEASE_APP_TAG], "正式版");

        expect(release.id).toBe(RELEASE_APP_TAG.id);
        expect(release.overrides).toEqual({});
        // The frozen model value is not mutated - the surfaces get a copy.
        expect(RELEASE_APP_TAG.name).toBe("Release");
    });
});
