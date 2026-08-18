import { describe, expect, it } from "vitest";
import type { DockerBarItem, FloatingToolbarItem } from "@/lib/ui-editor/widget-modules/types";
import {
  isSurfaceGestureEnabled,
  isSurfaceGestureReadOnlySafe,
  toReadOnlyDockerBarItems,
  toReadOnlyFloatingToolbarItems,
  toReadOnlyMoveableProps,
  UI_EDITOR_WRITABLE,
  type SurfaceGesture,
  type UIEditorReadOnly
} from "./readOnlyInteraction";

const READ_ONLY: UIEditorReadOnly = { active: true, reason: "Nothing is being saved right now" };

/** Every gesture, so a new member of the union shows up here as a decision rather than a default. */
const ALL_GESTURES: SurfaceGesture[] = [
  "select",
  "containerDrill",
  "pan",
  "zoom",
  "outlineCollapse",
  "transform",
  "insertDraw",
  "inlineTextEdit",
  "imageCrop",
  "outlineReorder",
  "outlineRename",
  "outlineVisibility"
];

describe("isSurfaceGestureReadOnlySafe", () => {
  it("keeps looking at the document working", () => {
    expect(isSurfaceGestureReadOnlySafe("select")).toBe(true);
    expect(isSurfaceGestureReadOnlySafe("containerDrill")).toBe(true);
    expect(isSurfaceGestureReadOnlySafe("pan")).toBe(true);
    expect(isSurfaceGestureReadOnlySafe("zoom")).toBe(true);
    expect(isSurfaceGestureReadOnlySafe("outlineCollapse")).toBe(true);
  });

  it("refuses every gesture that edits the document", () => {
    expect(isSurfaceGestureReadOnlySafe("transform")).toBe(false);
    expect(isSurfaceGestureReadOnlySafe("insertDraw")).toBe(false);
    expect(isSurfaceGestureReadOnlySafe("inlineTextEdit")).toBe(false);
    expect(isSurfaceGestureReadOnlySafe("imageCrop")).toBe(false);
    expect(isSurfaceGestureReadOnlySafe("outlineReorder")).toBe(false);
    expect(isSurfaceGestureReadOnlySafe("outlineRename")).toBe(false);
    expect(isSurfaceGestureReadOnlySafe("outlineVisibility")).toBe(false);
  });
});

describe("isSurfaceGestureEnabled", () => {
  it("changes nothing on a writable surface", () => {
    for (const gesture of ALL_GESTURES) {
      expect(isSurfaceGestureEnabled(gesture, UI_EDITOR_WRITABLE)).toBe(true);
    }
  });

  it("leaves only the read-safe gestures on a read-only surface", () => {
    const enabled = ALL_GESTURES.filter((gesture) => isSurfaceGestureEnabled(gesture, READ_ONLY));
    expect(enabled).toEqual(["select", "containerDrill", "pan", "zoom", "outlineCollapse"]);
  });
});

describe("toReadOnlyMoveableProps", () => {
  it("keeps the control box aligned with the viewport", () => {
    expect(toReadOnlyMoveableProps({ zoom: 1.5, origin: true })).toMatchObject({
      zoom: 1.5,
      origin: true
    });
  });

  it("turns off every ability", () => {
    const props = toReadOnlyMoveableProps({
      draggable: true,
      resizable: true,
      rotatable: true,
      clickable: true
    });
    expect(props.draggable).toBe(false);
    expect(props.resizable).toBe(false);
    expect(props.rotatable).toBe(false);
    expect(props.clickable).toBe(false);
  });

  it("drops every handler, so no gesture can be half-attached", () => {
    const props = toReadOnlyMoveableProps({
      zoom: 1,
      draggable: true,
      onDragStart: () => undefined,
      onDrag: () => undefined,
      onDragEnd: () => undefined,
      onResizeStart: () => undefined,
      onRotateGroupEnd: () => undefined
    });
    expect(Object.keys(props).filter((key) => key.startsWith("on"))).toEqual([]);
  });

  it("drops an ability nobody listed here, so a new one cannot leak in", () => {
    // `scalable`/`warpable`/`snappable` are Moveable abilities no controller sets today. The
    // allow-list is what makes tomorrow's controller safe by default.
    const props = toReadOnlyMoveableProps({ scalable: true, warpable: true, snappable: true });
    expect(props.scalable).toBeUndefined();
    expect(props.warpable).toBeUndefined();
    expect(props.snappable).toBeUndefined();
  });
});

const noop = () => undefined;

describe("toReadOnlyFloatingToolbarItems", () => {
  const items: FloatingToolbarItem[] = [
    { kind: "button", id: "open-linked-component", tooltip: "Open Menu", onClick: noop },
    { kind: "button", id: "unlink-component", tooltip: "Unlink component", onClick: noop },
    { kind: "button", id: "plugin-thing", tooltip: "Do something", onClick: noop }
  ];

  it("returns the input untouched when writable", () => {
    expect(toReadOnlyFloatingToolbarItems(items, UI_EDITOR_WRITABLE)).toBe(items);
  });

  it("keeps the navigating row and disables the rest with the reason on hover", () => {
    const result = toReadOnlyFloatingToolbarItems(items, READ_ONLY);
    expect(result[0]).toEqual(items[0]);
    expect(result[1]).toMatchObject({ disabled: true, tooltip: READ_ONLY.reason });
    expect(result[2]).toMatchObject({ disabled: true, tooltip: READ_ONLY.reason });
  });
});

describe("toReadOnlyDockerBarItems", () => {
  const items: DockerBarItem[] = [
    { kind: "button", id: "align-left", tooltip: "Align left", onClick: noop },
    { kind: "separator", id: "sep" },
    { kind: "select", id: "fit", value: "cover", options: [], onChange: noop },
    { kind: "number", id: "radius", value: 4, onChange: noop }
  ];

  it("returns the input untouched when writable", () => {
    expect(toReadOnlyDockerBarItems(items, UI_EDITOR_WRITABLE)).toBe(items);
  });

  it("disables every control and leaves separators alone", () => {
    const [button, separator, select, number] = toReadOnlyDockerBarItems(items, READ_ONLY);
    expect(button).toMatchObject({ disabled: true, tooltip: READ_ONLY.reason });
    expect(separator).toEqual({ kind: "separator", id: "sep" });
    expect(select).toMatchObject({ disabled: true, tooltip: READ_ONLY.reason });
    expect(number).toMatchObject({ disabled: true, readOnly: true, tooltip: READ_ONLY.reason });
  });
});
