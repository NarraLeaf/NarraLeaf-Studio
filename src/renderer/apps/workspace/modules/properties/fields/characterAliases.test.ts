import { describe, expect, it } from "vitest";
import { characterAliasIssue, normalizeCharacterAliases } from "./characterAliases";

describe("normalizeCharacterAliases", () => {
    it("trims, drops blanks, repeats and the character's own name", () => {
        expect(normalizeCharacterAliases([" 饼姐 ", "", "  ", "饼姐", "责编", "编辑"], "责编")).toEqual(["饼姐", "编辑"]);
    });
});

describe("characterAliasIssue", () => {
    const self = { id: "editor", name: "责编" };
    const cast = [
        { id: "editor", name: "责编", nicknames: ["饼姐"] },
        { id: "mio", name: "美绪", nicknames: ["小美"] },
        { id: "aoi", name: "Aoi", nicknames: [] },
    ];

    it("passes an alias nobody else uses", () => {
        expect(characterAliasIssue("饼姐", self, cast)).toBeNull();
    });

    it("flags an alias that is the character's own name", () => {
        expect(characterAliasIssue("责编", self, cast)).toEqual({ kind: "ownName" });
    });

    it("flags an alias another character is named, since names bind first", () => {
        expect(characterAliasIssue("Aoi", self, cast)).toEqual({ kind: "name", names: ["Aoi"] });
    });

    it("flags an alias another character shares, which makes the speaker ambiguous", () => {
        expect(characterAliasIssue("小美", self, cast)).toEqual({ kind: "alias", names: ["美绪"] });
    });

    it("matches exactly, as the story compiler does", () => {
        expect(characterAliasIssue("aoi", self, cast)).toBeNull();
    });
});
