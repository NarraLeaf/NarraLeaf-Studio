import { describe, expect, it } from "vitest";
import type { UISurface } from "@shared/types/ui-editor/document";
import { scenePropertySchema, type SceneEditorContext } from "./sceneSchema";

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
