import { describe, expect, it } from "vitest";
import type { UISurface } from "@shared/types/ui-editor/document";
import { getSurfaceKindNoun, scenePropertySchema, type SceneEditorContext } from "./sceneSchema";

function surface(kind: UISurface["kind"], backgroundColor?: string): UISurface {
    const base = {
        id: "s",
        name: "S",
        designSize: { width: 1920, height: 1080 },
        rootElementId: "root",
        settings: backgroundColor === undefined ? undefined : { backgroundColor },
    };
    return kind === "stageSurface"
        ? { ...base, host: "player", kind, mount: { kind: "slot", slotId: "onStage" } }
        : { ...base, host: "app", kind };
}

function backgroundSwatch(target: UISurface) {
    const schema = scenePropertySchema((key: string) => key) as unknown as {
        fields: Array<{ id: string; getValue?: (data: SceneEditorContext) => unknown }>;
    };
    const field = schema.fields.find(item => item.id === "scene.backgroundColor");
    return field?.getValue?.({ surface: target } as SceneEditorContext);
}

describe("surface background swatch", () => {
    it("shows the white a page with no stored colour is drawn in", () => {
        expect(backgroundSwatch(surface("appSurface"))).toMatchObject({ hex: "#FFFFFF", alpha: 1 });
    });

    it("shows a Game UI with no stored colour as transparent, as it is drawn", () => {
        expect(backgroundSwatch(surface("stageSurface"))).toMatchObject({ alpha: 0 });
    });

    it("shows a stored colour as stored", () => {
        expect(backgroundSwatch(surface("appSurface", "#112233"))).toMatchObject({ hex: "#112233", alpha: 1 });
    });
});

describe("surface navigation section", () => {
    it("carries the navigation settings topic, as an element's Navigation section does", () => {
        const schema = scenePropertySchema((key: string) => key) as unknown as {
            fields: Array<{ id: string; helpTopic?: string }>;
        };
        expect(schema.fields.find(item => item.id === "scene.navigation")?.helpTopic).toBe("focusNavigationSettings");
    });
});

describe("page music section", () => {
    type Field = { id: string; type: string; title?: string; fields?: Field[]; hidden?: (data: SceneEditorContext) => boolean };
    const fields = () => (scenePropertySchema((key: string) => key) as unknown as { fields: Field[] }).fields;

    it("is a section of its own, titled Music, holding the music field", () => {
        const section = fields().find(item => item.id === "scene.music");
        expect(section?.type).toBe("section");
        expect(section?.title).toBe("properties.music.title");
        expect(section?.fields?.map(item => item.id)).toEqual(["scene.music.editor"]);
    });

    it("sits with the page's other sections, right before Animation", () => {
        const ids = fields().map(item => item.id);
        expect(ids.indexOf("scene.pageAnimation") - ids.indexOf("scene.music")).toBe(1);
    });

    it("is offered on a page and not on a Game UI, which plays the scene's music", () => {
        const section = fields().find(item => item.id === "scene.music");
        expect(section?.hidden?.({ surface: surface("appSurface") } as SceneEditorContext)).toBe(false);
        expect(section?.hidden?.({ surface: surface("stageSurface") } as SceneEditorContext)).toBe(true);
    });
});

describe("surface kind noun", () => {
    it("names a page Page and a Game UI Game UI, not the story's Scene", () => {
        const t = (key: string) => key;
        expect(getSurfaceKindNoun(surface("appSurface"), t)).toBe("properties.scene.typePage");
        expect(getSurfaceKindNoun(surface("stageSurface"), t)).toBe("properties.scene.typeGameUi");
    });
});
