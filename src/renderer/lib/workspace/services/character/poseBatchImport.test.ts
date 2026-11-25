import { describe, expect, it } from "vitest";
import {
    defaultPoseNamingRule,
    derivePoseName,
    fileStem,
    imageNameStem,
    matchPosePrefix,
    normalizePoseNamingRule,
    planPoseFiles,
    splitPoseSegments,
    uniquePoseNames,
    type PoseNamingRule,
} from "./poseBatchImport";

const rule = (patch: Partial<PoseNamingRule> = {}): PoseNamingRule => ({ ...defaultPoseNamingRule("Miki"), ...patch });

describe("poseBatchImport", () => {
    it("names a file after what follows the character's name", () => {
        expect(derivePoseName("Miki_Seifuku_Frown", rule())).toBe("Seifuku Frown");
        expect(derivePoseName("miki-casual smile", rule())).toBe("casual smile");
    });

    it("uses the chosen joiner and separators", () => {
        expect(derivePoseName("Miki_Seifuku_Frown", rule({ joiner: "_" }))).toBe("Seifuku_Frown");
        expect(derivePoseName("Miki.Seifuku.Frown", rule({ separators: "." }))).toBe("Seifuku Frown");
        // A separator the rule does not list stays part of the name.
        expect(derivePoseName("Miki_Seifuku-Frown", rule({ separators: "_" }))).toBe("Seifuku-Frown");
    });

    it("keeps the prefix as the name when nothing follows it", () => {
        expect(derivePoseName("Miki", rule())).toBe("Miki");
        expect(derivePoseName("Miki__", rule())).toBe("Miki");
    });

    it("only matches a prefix that ends at a separator", () => {
        expect(matchPosePrefix("Mikiko_smile", rule())).toBeNull();
        expect(matchPosePrefix("MIKI_smile", rule())).toBe("Miki");
        expect(matchPosePrefix("Miki", rule())).toBe("Miki");
    });

    it("prefers the longest of several matching prefixes", () => {
        const r = rule({ prefixes: ["Miki", "Miki_Casual"] });
        expect(matchPosePrefix("Miki_Casual_Smile", r)).toBe("Miki_Casual");
        expect(derivePoseName("Miki_Casual_Smile", r)).toBe("Smile");
        expect(derivePoseName("Miki_Seifuku_Smile", r)).toBe("Seifuku Smile");
    });

    it("splits at whitespace runs and drops empty segments", () => {
        expect(splitPoseSegments("  a__b  c-", "_-")).toEqual(["a", "b", "c"]);
    });

    it("reads a stem from either kind of path", () => {
        expect(fileStem("C:\\art\\Miki_Smile.png")).toBe("Miki_Smile");
        expect(fileStem("/art/Miki.Smile.webp")).toBe("Miki.Smile");
        expect(fileStem("/art/.hidden")).toBe(".hidden");
    });

    it("takes an image extension off a library name and nothing else", () => {
        expect(imageNameStem("Miki_Smile.PNG", ["png", "webp"])).toBe("Miki_Smile");
        expect(imageNameStem("Miki.Smile", ["png"])).toBe("Miki.Smile");
        expect(imageNameStem("Miki_Smile", ["png"])).toBe("Miki_Smile");
    });

    it("filters a folder down to the character's files, in natural order", () => {
        const paths = [
            "/art/Miki_Smile10.png",
            "/art/Miki_Smile2.png",
            "/art/Nanami_Smile.png",
            "/art/sub/Mikiko_Smile.png",
            "/art/Miki_Smile2.png",
        ];
        const planned = planPoseFiles(paths, rule(), true);
        expect(planned.map(entry => entry.name)).toEqual(["Smile2", "Smile10"]);
    });

    it("keeps every file when not filtering, and only strips a prefix where one matches", () => {
        const planned = planPoseFiles(["/a/Nanami_Smile.png", "/a/Miki_Cry.png"], rule(), false);
        expect(planned.map(entry => [entry.name, entry.prefix])).toEqual([
            ["Cry", "Miki"],
            ["Nanami Smile", null],
        ]);
    });

    it("makes names unique against the existing poses and each other", () => {
        expect(uniquePoseNames(["Smile", "smile", "Cry"], ["Smile"])).toEqual(["Smile 2", "smile 3", "Cry"]);
    });

    it("repairs a stored rule rather than trusting it", () => {
        expect(normalizePoseNamingRule({ prefixes: [" ", "miki", "Miki"], joiner: "x" as never }, "Miki")).toEqual({
            prefixes: ["miki"],
            separators: "_-",
            joiner: " ",
        });
        expect(normalizePoseNamingRule({ prefixes: [] }, "Miki").prefixes).toEqual(["Miki"]);
        expect(normalizePoseNamingRule(null, "  ").prefixes).toEqual([]);
    });
});
