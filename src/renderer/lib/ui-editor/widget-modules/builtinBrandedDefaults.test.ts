import { describe, expect, it } from "vitest";
import { isBrandLink } from "@shared/brand/brandLink";
import { BuiltinWidgetModules } from "./builtin";
import { defaultButtonWidgetProps } from "./builtin/button/types";
import { defaultTextWidgetProps } from "./builtin/text/types";
import { defaultTextInputElementProps } from "./builtin/textInput/helpers";
import { defaultContainerWidgetProps } from "@shared/types/ui-editor/container";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";

/**
 * The two halves of "a new widget is the project's colour, an old one is not".
 *
 * A widget's colour is answered in two places, and they must not agree:
 *
 * - `createDefaultElement()` materialises props into the element being inserted. Links belong here,
 *   because the only widget affected is the one being made.
 * - `defaultXWidgetProps` is the read-time fallback for a prop a stored element does not carry, so
 *   it answers for every widget in every project that has ever existed. A link here would repaint
 *   finished work whose author never chose a colour - a silent change to a project nobody opened.
 *
 * The tempting tidy-up is to fold the first into the second, since they look like the same defaults.
 * These assertions are what stands in the way.
 */

/** Widget type, the props that must be links, and the fallback object that must stay literal. */
const BRANDED_WIDGETS: {
  type: string;
  props: readonly string[];
  fallbacks: Record<string, unknown>;
}[] = [
  {
    type: "nl.button",
    props: ["backgroundColor", "borderColor", "color"],
    fallbacks: defaultButtonWidgetProps as unknown as Record<string, unknown>
  },
  {
    type: "nl.container",
    props: ["backgroundColor", "borderColor"],
    fallbacks: defaultContainerWidgetProps as unknown as Record<string, unknown>
  },
  {
    type: "nl.text",
    props: ["color"],
    fallbacks: defaultTextWidgetProps as unknown as Record<string, unknown>
  },
  {
    type: "nl.textInput",
    props: ["backgroundColor", "borderColor", "color"],
    fallbacks: defaultTextInputElementProps as unknown as Record<string, unknown>
  }
];

function moduleFor(type: string) {
  const module = BuiltinWidgetModules.find((candidate) => candidate.type === type);
  expect(module, `no builtin widget module declared for ${type}`).toBeDefined();
  return module!;
}

describe("branded defaults for newly created widgets", () => {
  for (const { type, props, fallbacks } of BRANDED_WIDGETS) {
    it(`${type}: a new element carries brand links`, () => {
      const created = moduleFor(type).createDefaultElement().props as Record<string, unknown>;
      for (const prop of props) {
        expect(
          isBrandLink(created[prop] as string),
          `${type}.${prop} is "${String(created[prop])}"`
        ).toBe(true);
      }
    });

    it(`${type}: the read-time fallback stays a literal`, () => {
      for (const prop of props) {
        expect(
          isBrandLink(fallbacks[prop] as string),
          `${type}: the fallback for "${prop}" became a brand link, which repaints every\n` +
            `existing widget of this type whose author never set that colour. Put the link in\n` +
            `createDefaultElement() instead.`
        ).toBe(false);
      }
    });

    it(`${type}: the initial appearance rows follow the links too`, () => {
      // The appearance model's `default` variant is seeded from the same props, so the panel
      // and the canvas read the link rather than the old literal the fallback still holds.
      const created = moduleFor(type).createDefaultElement().props as Record<string, unknown>;
      const appearance = created.appearance as AppearanceModel | undefined;
      expect(appearance, `${type} has no initial appearance model`).toBeDefined();
      const variant = appearance!.variants.find(
        (candidate) => candidate.id === appearance!.defaultVariantId
      );
      expect(variant, `${type} has no default variant`).toBeDefined();
      for (const prop of props) {
        const group = variant!.propertyGroups.find((candidate) => candidate.key === prop);
        // Not every branded prop is an appearance key on every widget; only assert the ones
        // that are, so adding a slot to the palette cannot fail this for the wrong reason.
        if (!group) {
          continue;
        }
        expect(
          isBrandLink(group.rows[0]?.value as string),
          `${type} appearance row "${prop}"`
        ).toBe(true);
      }
    });
  }
});
