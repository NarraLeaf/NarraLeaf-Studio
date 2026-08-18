import { describe, expect, it, vi } from "vitest";
import {
  UI_DOCUMENT_SCHEMA_VERSION,
  type UIDocument,
  type UIElement
} from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { resolvePasteTargetAfterSelection, uiEditorUngroupSelection } from "./uiEditorCommands";
import { applyUngroupContainer } from "@/lib/workspace/services/ui-editor/uiDocumentTreeMove";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";

function element(
  id: string,
  type: string,
  parentId: string | null,
  childrenIds: string[] = []
): UIElement {
  return {
    id,
    type,
    parentId,
    childrenIds,
    layout: { x: 0, y: 0, width: 100, height: 100 }
  };
}

function makeDocument(): UIDocument {
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
        designSize: { width: 800, height: 600 },
        rootElementId: "root"
      }
    ],
    elements: {
      root: element("root", "nl.root", null, ["source", "next"]),
      source: element("source", "nl.container", "root", ["source-child"]),
      "source-child": element("source-child", "nl.text", "source"),
      next: element("next", "nl.container", "root")
    }
  };
}

function selection(ids: string[], primaryId = ids[ids.length - 1]): UIElementSelection {
  return {
    editor: "ui",
    surfaceId: "surface",
    elementIds: ids,
    primaryId
  };
}

describe("UI editor paste target resolution", () => {
  it("pastes after a selected parent-capable element, not into it", () => {
    const doc = makeDocument();

    expect(resolvePasteTargetAfterSelection(doc, "surface", selection(["source"]))).toEqual({
      parentId: "root",
      beforeChildId: "next"
    });
  });

  it("uses the selected top-level ancestor when primary is inside the copied subtree", () => {
    const doc = makeDocument();

    expect(
      resolvePasteTargetAfterSelection(
        doc,
        "surface",
        selection(["source", "source-child"], "source-child")
      )
    ).toEqual({
      parentId: "root",
      beforeChildId: "next"
    });
  });

  it("falls back to the effective root when there is no selection", () => {
    const doc = makeDocument();

    expect(resolvePasteTargetAfterSelection(doc, "surface", null)).toEqual({
      parentId: "root",
      beforeChildId: null
    });
  });
});

/** Stands in for the services, running the real tree edit over a plain document. */
function ungroupHarness(doc: UIDocument) {
  const setUIElementSelection = vi.fn();
  const setSelection = vi.fn();
  const documentService = {
    getDocument: () => doc,
    ungroupContainers: (surfaceId: string, containerIds: string[]) =>
      containerIds.flatMap((id) => applyUngroupContainer(doc, surfaceId, id) ?? [])
  } as unknown as UIDocumentService;
  const stateService = {
    setUIElementSelection,
    setSelection,
    getSelection: () => ({ type: "none" })
  } as unknown as UIEditorStateService;
  return { documentService, stateService, setUIElementSelection, setSelection };
}

describe("UI editor ungroup", () => {
  it("hands the selection to what came out of the group, keeping untouched elements selected", () => {
    const doc = makeDocument();
    const { documentService, stateService, setUIElementSelection } = ungroupHarness(doc);

    expect(
      uiEditorUngroupSelection(
        documentService,
        stateService,
        "surface",
        selection(["source", "next"])
      )
    ).toBe(true);

    // `next` is an empty group, so it goes too and only `source`'s child is left to select.
    expect(setUIElementSelection).toHaveBeenCalledWith({
      editor: "ui",
      surfaceId: "surface",
      elementIds: ["source-child"],
      primaryId: "source-child"
    });
    expect(doc.elements.root.childrenIds).toEqual(["source-child"]);
  });

  it("falls back to the surface when the group was empty", () => {
    const doc = makeDocument();
    const { documentService, stateService, setUIElementSelection, setSelection } =
      ungroupHarness(doc);

    expect(
      uiEditorUngroupSelection(documentService, stateService, "surface", selection(["next"]))
    ).toBe(true);

    expect(setUIElementSelection).not.toHaveBeenCalled();
    expect(setSelection).toHaveBeenCalledWith({ type: "scene", data: "surface" });
  });

  it("does nothing when nothing selected is a group", () => {
    const doc = makeDocument();
    const { documentService, stateService, setUIElementSelection } = ungroupHarness(doc);

    expect(
      uiEditorUngroupSelection(
        documentService,
        stateService,
        "surface",
        selection(["source-child"])
      )
    ).toBe(false);
    expect(setUIElementSelection).not.toHaveBeenCalled();
    expect(doc.elements.source.childrenIds).toEqual(["source-child"]);
  });
});
