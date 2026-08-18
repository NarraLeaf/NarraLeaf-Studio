import { describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import { UI_PUPPET_ELEMENT_TYPE } from "@shared/types/ui-editor/puppet";
import {
  getPuppetProps,
  patchPuppetProps,
  puppetWidgetRequest,
  puppetWidgetSize,
  puppetWidgetState
} from "./helpers";

function element(
  props: Record<string, unknown> = {},
  layout?: Partial<UIElement["layout"]>
): UIElement {
  return {
    id: "puppet-1",
    type: UI_PUPPET_ELEMENT_TYPE,
    name: "Heroine",
    parentId: null,
    childrenIds: [],
    layout: { x: 0, y: 0, width: 360, height: 540, opacity: 1, visible: true, ...layout },
    props
  };
}

describe("puppet widget helpers", () => {
  it("reads defaults through the normalizer", () => {
    expect(getPuppetProps(element())).toEqual({
      assetId: null,
      backend: "",
      options: {},
      motion: null,
      expression: null,
      skin: null,
      params: {},
      slots: {}
    });
  });

  it("keeps chrome props a patch does not mention", () => {
    // The chrome (fill, radius, stroke) lives in the same flat props bag, so a patch that dropped
    // unknown keys would silently reset the box every time the author picked a motion.
    const patched = patchPuppetProps(
      element({ assetId: "m", backend: "b", borderRadius: 12, fillVisible: false }),
      { motion: "idle" }
    );
    expect(patched).toMatchObject({
      borderRadius: 12,
      fillVisible: false,
      assetId: "m",
      backend: "b",
      motion: "idle"
    });
  });

  it("builds the engine's complete PuppetState", () => {
    // The return type is the assertion this test drives: five fields, no more and no fewer, so a
    // widget's apply() is a whole state rather than a patch. `null` means cleared, not unchanged.
    const state = puppetWidgetState(
      getPuppetProps(
        element({
          motion: "wave",
          skin: "summer",
          params: { blink: 0.5 },
          slots: { weapon: null }
        })
      )
    );
    expect(state).toEqual({
      motion: "wave",
      expression: null,
      skin: "summer",
      params: { blink: 0.5 },
      slots: { weapon: null }
    });
    expect(Object.keys(state).sort()).toEqual(["expression", "motion", "params", "skin", "slots"]);
  });

  it("asks for nothing until both a model and a runtime are chosen", () => {
    // Null is not a degraded request: the mount machine reads it as "this widget is not asking",
    // which costs no module load and no WebGL context - the state most puppet widgets are in for
    // most of their authoring life.
    expect(puppetWidgetRequest(getPuppetProps(element()))).toBeNull();
    expect(puppetWidgetRequest(getPuppetProps(element({ assetId: "m" })))).toBeNull();
    expect(puppetWidgetRequest(getPuppetProps(element({ backend: "b" })))).toBeNull();
    expect(
      puppetWidgetRequest(
        getPuppetProps(
          element({
            assetId: "m",
            backend: "b",
            options: { premultiplied: true }
          })
        )
      )
    ).toEqual({
      assetId: "m",
      backend: "b",
      // No entry override in this widget's schema; see the note in `helpers.ts`.
      entry: null,
      options: { premultiplied: true }
    });
  });

  it("does not put the pose in the request", () => {
    // A puppet cannot change its `src`, so the request keys the *mount*. Including the pose would
    // tear down and reload a multi-megabyte skeleton every time the author picked a motion.
    const request = puppetWidgetRequest(
      getPuppetProps(
        element({
          assetId: "m",
          backend: "b",
          motion: "idle",
          skin: "summer"
        })
      )
    );
    expect(request).not.toHaveProperty("motion");
    expect(request).not.toHaveProperty("skin");
  });

  it("gives the backend a box of at least one pixel", () => {
    expect(puppetWidgetSize(element())).toEqual({ width: 360, height: 540 });
    // Mid-drag a handle can be pulled back through the origin, and a backend sizing its canvas
    // from a zero or negative box comes up drawing nothing at all.
    expect(puppetWidgetSize(element({}, { width: -120, height: 0 }))).toEqual({
      width: 120,
      height: 1
    });
    expect(puppetWidgetSize(element({}, { width: 100.4, height: 99.6 }))).toEqual({
      width: 100,
      height: 100
    });
  });
});
