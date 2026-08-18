import { describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import {
  isUiContainerDrillLockHit,
  resolveUiContainerDrillTarget
} from "./containerDrillSelection";

function createDocument(): UIDocument {
  return {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [
      {
        id: "surface",
        name: "Surface",
        host: "app",
        kind: "appSurface",
        designSize: { width: 320, height: 180 },
        rootElementId: "root"
      }
    ],
    elements: {
      root: {
        id: "root",
        type: "nl.root",
        parentId: null,
        childrenIds: ["slider", "switch", "outer"],
        layout: { x: 0, y: 0, width: 320, height: 180 }
      },
      slider: {
        id: "slider",
        type: "nl.slider",
        parentId: "root",
        childrenIds: ["track", "handle"],
        layout: { x: 0, y: 0, width: 260, height: 40 }
      },
      track: {
        id: "track",
        type: "nl.container",
        parentId: "slider",
        childrenIds: [],
        extra: { sliderSlot: "track" },
        layout: { x: 16, y: 17, width: 228, height: 6 }
      },
      handle: {
        id: "handle",
        type: "nl.container",
        parentId: "slider",
        childrenIds: [],
        extra: { sliderSlot: "handle" },
        layout: { x: 121, y: 9, width: 18, height: 22 }
      },
      switch: {
        id: "switch",
        type: "nl.switch",
        parentId: "root",
        childrenIds: ["switchTrack", "switchThumb"],
        layout: { x: 0, y: 140, width: 52, height: 28 }
      },
      switchTrack: {
        id: "switchTrack",
        type: "nl.container",
        parentId: "switch",
        childrenIds: [],
        extra: { switchSlot: "track" },
        layout: { x: 0, y: 0, width: 52, height: 28 }
      },
      switchThumb: {
        id: "switchThumb",
        type: "nl.container",
        parentId: "switch",
        childrenIds: [],
        extra: { switchSlot: "thumb" },
        layout: { x: 3, y: 3, width: 22, height: 22 }
      },
      outer: {
        id: "outer",
        type: "nl.container",
        parentId: "root",
        childrenIds: ["inner"],
        layout: { x: 0, y: 48, width: 160, height: 96 }
      },
      inner: {
        id: "inner",
        type: "nl.container",
        parentId: "outer",
        childrenIds: ["image"],
        layout: { x: 8, y: 8, width: 120, height: 80 }
      },
      image: {
        id: "image",
        type: "nl.image",
        parentId: "inner",
        childrenIds: [],
        layout: { x: 0, y: 0, width: 120, height: 80 }
      }
    }
  };
}

describe("container drill selection", () => {
  it("treats selected sliders as drillable structural parents", () => {
    const document = createDocument();
    const selection = {
      editor: "ui" as const,
      surfaceId: "surface",
      elementIds: ["slider"],
      primaryId: "slider"
    };

    expect(isUiContainerDrillLockHit(document, "surface", selection, "handle")).toBe(true);
    expect(isUiContainerDrillLockHit(document, "surface", selection, "track")).toBe(true);
    expect(isUiContainerDrillLockHit(document, "surface", selection, "slider")).toBe(false);
  });

  it("treats selected switches as drillable structural parents", () => {
    const document = createDocument();
    const selection = {
      editor: "ui" as const,
      surfaceId: "surface",
      elementIds: ["switch"],
      primaryId: "switch"
    };

    expect(isUiContainerDrillLockHit(document, "surface", selection, "switchThumb")).toBe(true);
    expect(isUiContainerDrillLockHit(document, "surface", selection, "switchTrack")).toBe(true);
    expect(isUiContainerDrillLockHit(document, "surface", selection, "switch")).toBe(false);
    // A hit outside the selected switch is not a drill either, so the assertions above cannot
    // pass just because the descendant walk says yes to everything.
    expect(isUiContainerDrillLockHit(document, "surface", selection, "handle")).toBe(false);
    expect(resolveUiContainerDrillTarget(document, "surface", selection, "switchThumb")).toBe(
      "switchThumb"
    );
  });

  it("resolves a deep hit to the direct child of the selected container", () => {
    const document = createDocument();
    const selection = {
      editor: "ui" as const,
      surfaceId: "surface",
      elementIds: ["outer"],
      primaryId: "outer"
    };

    expect(resolveUiContainerDrillTarget(document, "surface", selection, "image")).toBe("inner");
    expect(resolveUiContainerDrillTarget(document, "surface", selection, "inner")).toBe("inner");
    expect(resolveUiContainerDrillTarget(document, "surface", selection, "outer")).toBeNull();
  });
});
