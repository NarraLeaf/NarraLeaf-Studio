import { describe, expect, it } from "vitest";
import {
    containsGeneratedIdentifier,
    elideGeneratedIdentifiers,
    readableChangePath,
    readableStoragePath,
} from "./identifierDisplay";

const SCENE = "f306e2d5-70c0-421b-ba8a-c7b2d3ce9d33";
const BLOCK = "51d4f8dc-dd7d-41b6-86e1-863ecf109ad8";

describe("recognising an id Studio generated", () => {
    it("knows a uuid in either spelling, and a long run of hex", () => {
        expect(containsGeneratedIdentifier(SCENE)).toBe(true);
        expect(containsGeneratedIdentifier(SCENE.toUpperCase())).toBe(true);
        expect(containsGeneratedIdentifier(SCENE.replace(/-/g, ""))).toBe(true);
        // A content digest, and a legacy asset id.
        expect(containsGeneratedIdentifier("ec9f91a83d1d922795cc804d4f1141b88666fb34dc8de84566539a4007329093")).toBe(true);
    });

    it("leaves words, readable ids and short random ids alone", () => {
        for (const text of ["narraleaf-studio:main-surface", "p1oh", "global.appBoot", "#40A8C4", "cafe", "2026-09-21"]) {
            expect(containsGeneratedIdentifier(text)).toBe(false);
        }
    });
});

describe("a path inside a document", () => {
    it("keeps its shape and draws every id as an ellipsis", () => {
        expect(readableChangePath(["scenes", SCENE, "blocks", BLOCK, "payload"]))
            .toBe("scenes / … / blocks / … / payload");
        expect(readableChangePath(["surfaces", "narraleaf-studio:main-surface", "elements", BLOCK, "name"]))
            .toBe("surfaces / narraleaf-studio:main-surface / elements / … / name");
    });

    it("has nothing to say at the document's root", () => {
        expect(readableChangePath([])).toBeUndefined();
    });
});

describe("a file's path", () => {
    it("is drawn when nothing in it was generated", () => {
        expect(readableStoragePath("editor/variables.json")).toBe("editor/variables.json");
        expect(readableStoragePath("scripts\\tools\\build.js")).toBe("scripts/tools/build.js");
        expect(readableStoragePath("assets/assets.metadata.image.json")).toBe("assets/assets.metadata.image.json");
    });

    it("is left out when it carries an id, rather than drawn half-readable", () => {
        expect(readableStoragePath(`editor/story/stories/${SCENE}/storydoc.json`)).toBeNull();
        expect(readableStoragePath(`editor/story/animations/${SCENE}.json`)).toBeNull();
    });

    it("is left out for an asset's bytes, whose directories are the first digits of its id", () => {
        expect(readableStoragePath("assets/content/f5/e8/519afdee48e6b06451136de15c8e")).toBeNull();
        expect(readableStoragePath("assets/content/f5/e8/519afdee48e6b06451136de15c8e/model3.json")).toBeNull();
    });
});

describe("a value drawn verbatim", () => {
    it("keeps the author's text and loses only the ids inside it", () => {
        expect(elideGeneratedIdentifiers(`scene:${SCENE}`)).toBe("scene:…");
        expect(elideGeneratedIdentifiers("你迟到了。")).toBe("你迟到了。");
        expect(elideGeneratedIdentifiers(`[${SCENE},${BLOCK}]`)).toBe("[…,…]");
    });
});
