import { describe, expect, it } from "vitest";
import {
    RELEASE_APP_TAG,
    resolveAppTagIdentity,
    type AppTagBaseIdentity,
    type ProjectAppTag,
} from "./appTag";
import {
    GAME_PROGRESS_SCHEMA_VERSION,
    buildGameProgressDocument,
    gameProgressKey,
    normalizeGameProgressDocument,
} from "./gameProgress";

const BASE: AppTagBaseIdentity = {
    displayName: "Sable Hours",
    identifier: "com.example.sablehours",
    version: "1.0.0",
};

const DEMO: ProjectAppTag = {
    id: "demo",
    name: "Demo",
    // The override that creates the whole problem: a different app id means a different user-data
    // directory, so the two editions cannot read each other's saves.
    overrides: { displayName: "Sable Hours Demo", identifier: "com.example.sablehours.demo" },
};

describe("gameProgressKey", () => {
    it("is the same string for every variant of one project", () => {
        // The premise: these two builds really do ship as different applications.
        expect(resolveAppTagIdentity(RELEASE_APP_TAG, BASE).identifier.value)
            .not.toBe(resolveAppTagIdentity(DEMO, BASE).identifier.value);

        // The key is resolved for the release tag whatever tag is being built, so both answer one
        // string - which is what lets a demo and a full game reach the same document.
        expect(gameProgressKey(BASE)).toBe("com.example.sablehours");
        expect(gameProgressKey(BASE)).toBe(gameProgressKey(BASE));
    });

    it("distinguishes two different projects", () => {
        expect(gameProgressKey(BASE)).not.toBe(gameProgressKey({ ...BASE, identifier: "com.example.other" }));
    });

    it("derives a key for a project with no identifier, and keeps it one path segment", () => {
        const key = gameProgressKey({ displayName: "My ../Game", identifier: "", version: "" });
        expect(key).not.toBe("");
        expect(key).not.toMatch(/[/\\]/);
        expect(key.startsWith(".")).toBe(false);
    });
});

describe("normalizeGameProgressDocument", () => {
    const written = buildGameProgressDocument("com.example.sablehours", {
        storyId: "story-1",
        savedVariables: { gold: 12 },
        persistentVariables: { seenIntro: true },
        anchor: { sceneId: "scene-3", sceneRuntimeName: "chapter-two" },
        visitedSceneIds: ["scene-1", "scene-3"],
    }, "2026-08-12T00:00:00.000Z");

    it("reads back what it wrote", () => {
        expect(normalizeGameProgressDocument(JSON.parse(JSON.stringify(written)))).toEqual(written);
    });

    it("refuses a document from a newer build rather than half-reading it", () => {
        expect(normalizeGameProgressDocument({ ...written, schemaVersion: GAME_PROGRESS_SCHEMA_VERSION + 1 }))
            .toBeNull();
        expect(normalizeGameProgressDocument("not a document")).toBeNull();
        expect(normalizeGameProgressDocument([])).toBeNull();
    });

    it("degrades a damaged record instead of losing the whole playthrough", () => {
        const document = normalizeGameProgressDocument({
            schemaVersion: GAME_PROGRESS_SCHEMA_VERSION,
            progressKey: "com.example.sablehours",
            savedVariables: { gold: 12 },
            persistentVariables: "nonsense",
            anchor: { sceneRuntimeName: "chapter-two" },
            visitedSceneIds: ["scene-1", 7, ""],
        });
        expect(document?.savedVariables).toEqual({ gold: 12 });
        expect(document?.persistentVariables).toEqual({});
        // An anchor with no scene id names nothing `Start Game` could take, so it is no anchor.
        expect(document?.anchor).toBeNull();
        expect(document?.visitedSceneIds).toEqual(["scene-1"]);
    });
});
