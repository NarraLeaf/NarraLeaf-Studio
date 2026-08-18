import { describe, expect, it } from "vitest";
import { BuiltinWidgetModules } from "./builtin";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";

/**
 * `UIWidgetModule.render` is not the paint path. Both hosts that actually draw a Surface build
 * `new ElementRendererRegistry(BuiltinElementRenderers)` - the editor canvas in
 * `UIRuntimeBridgeService.tsx` and the packaged game in `GameRuntimeApp.tsx` - so a widget that
 * exists only in `BuiltinWidgetModules` can be inserted, selected and edited while painting
 * nothing at all (it falls through to `unknownWidgetTypeUi`). The two arrays are hand-maintained
 * with nothing tying them together, and until this test there was no way to notice.
 *
 * Both directions matter: a module without a renderer paints nothing, and a renderer without a
 * module is dead weight that no palette, inspector or outline can reach.
 */

/**
 * Widget types deliberately present in only one registry. Empty today - keep it that way unless
 * there is a reason a type cannot paint (or cannot be authored), and write the reason here rather
 * than loosening the assertions below.
 */
const RENDERER_EXEMPT_MODULE_TYPES = new Set<string>();
const MODULE_EXEMPT_RENDERER_TYPES = new Set<string>();

describe("builtin widget module / element renderer parity", () => {
  it("resolves a renderer for every built-in widget module type", () => {
    // Guards against a vacuous pass if either import ever yields an empty array (the registry
    // already has to warn about `registerMany(undefined)` from import cycles).
    expect(BuiltinWidgetModules.length).toBeGreaterThan(0);
    expect(BuiltinElementRenderers.length).toBeGreaterThan(0);

    const registry = new ElementRendererRegistry(BuiltinElementRenderers);
    const unpaintable = BuiltinWidgetModules.map((module) => module.type)
      .filter((type) => !RENDERER_EXEMPT_MODULE_TYPES.has(type))
      .filter((type) => !registry.get(type));

    expect(
      unpaintable,
      `${unpaintable.length} widget module(s) have no entry in BuiltinElementRenderers, so they\n` +
        `paint nothing on the canvas and nothing in the packaged game. Add them to\n` +
        `src/renderer/lib/ui-editor/runtime/builtin/index.ts:\n  ${unpaintable.sort().join("\n  ")}\n`
    ).toEqual([]);
  });

  it("declares a widget module for every built-in element renderer type", () => {
    const moduleTypes = new Set(BuiltinWidgetModules.map((module) => module.type));
    const unreachable = BuiltinElementRenderers.map((definition) => definition.type)
      .filter((type) => !MODULE_EXEMPT_RENDERER_TYPES.has(type))
      .filter((type) => !moduleTypes.has(type));

    expect(
      unreachable,
      `${unreachable.length} element renderer(s) have no entry in BuiltinWidgetModules, so no\n` +
        `palette, inspector or outline can reach them. Add them to\n` +
        `src/renderer/lib/ui-editor/widget-modules/builtin/index.ts - or delete the renderer:\n` +
        `  ${unreachable.sort().join("\n  ")}\n`
    ).toEqual([]);
  });
});
