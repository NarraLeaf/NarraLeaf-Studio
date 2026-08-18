import type {
  AppearanceModel,
  AppearancePropertyGroup,
  AppearanceVariant,
  ContainerAppearancePropertyKey
} from "@shared/types/ui-editor/appearance";
import type { UIElement, UILayout } from "@shared/types/ui-editor/document";
import {
  defaultContainerWidgetProps,
  type ContainerWidgetProps
} from "@shared/types/ui-editor/container";
import {
  defaultSwitchWidgetProps,
  normalizeSwitchProps,
  UI_SWITCH_ON_VARIANT_ID,
  type UISwitchChildSlot,
  type UISwitchWidgetProps
} from "@shared/types/ui-editor/switch";
import { translate } from "@/lib/i18n";
import { createInitialContainerAppearance } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { getDefaultAppearanceTransition } from "@/lib/ui-editor/widget-modules/shared/appearance/appearanceMotion";

/**
 * Author-facing part colours baked into the project document at insert time. These are hex on
 * purpose: they are the colours of an element in the *player's* game, not Studio chrome, so the
 * design-system tokens do not apply to them.
 */
const SWITCH_TRACK_OFF_COLOR = "#64748b";
const SWITCH_TRACK_ON_COLOR = "#3b82f6";
const SWITCH_THUMB_COLOR = "#f8fafc";
const SWITCH_THUMB_BORDER_COLOR = "#0f172a";

/** Gap between the track edge and the thumb, in px. Also the thumb's off-state anchor. */
const SWITCH_PART_INSET = 3;

export type SwitchPartGeometry = {
  inset: number;
  trackW: number;
  trackH: number;
  thumbSize: number;
  /** Distance the thumb travels between off and on, i.e. the `on` variant's `transformOffsetX`. */
  travel: number;
};

export function getSwitchProps(element: UIElement): UISwitchWidgetProps {
  return normalizeSwitchProps({
    ...defaultSwitchWidgetProps,
    ...(element.props ?? {})
  });
}

export function patchSwitchProps(
  element: UIElement,
  partial: Partial<UISwitchWidgetProps>
): Record<string, unknown> {
  const current = getSwitchProps(element);
  return {
    ...(element.props ?? {}),
    ...current,
    ...partial
  };
}

/** Geometry the default parts are laid out with, derived from the switch's own box. */
export function resolveSwitchPartGeometry(layout: UILayout): SwitchPartGeometry {
  const inset = SWITCH_PART_INSET;
  const trackW = Math.max(24, Math.abs(layout.width));
  const trackH = Math.max(12, Math.abs(layout.height));
  const thumbSize = Math.max(8, trackH - inset * 2);
  const travel = Math.max(0, trackW - thumbSize - inset * 2);
  return { inset, trackW, trackH, thumbSize, travel };
}

function switchPartFlatProps(kind: UISwitchChildSlot): ContainerWidgetProps {
  const isTrack = kind === "track";
  return {
    ...defaultContainerWidgetProps,
    layoutKind: "free",
    clipContent: true,
    backgroundColor: isTrack ? SWITCH_TRACK_OFF_COLOR : SWITCH_THUMB_COLOR,
    fillType: "color",
    fillVisible: true,
    fillOpacity: 1,
    borderRadius: 999,
    borderRadiusTL: 999,
    borderRadiusTR: 999,
    borderRadiusBL: 999,
    borderRadiusBR: 999,
    borderRadiusLinked: true,
    borderColor: isTrack ? SWITCH_TRACK_OFF_COLOR : SWITCH_THUMB_BORDER_COLOR,
    borderWidth: isTrack ? 0 : 1,
    borderStyle: "solid",
    strokeVisible: !isTrack,
    strokeOpacity: isTrack ? 0 : 0.2,
    strokeAlign: "inside",
    strokeSide: "all",
    borderJoin: "round"
  };
}

/**
 * The one animatable key each part's `on` variant differs by: the track changes colour, the thumb
 * slides. Both are in `CONTAINER_ANIMATABLE_KEYS`, which is what buys the transition for free.
 */
function switchOnVariantKey(kind: UISwitchChildSlot): ContainerAppearancePropertyKey {
  return kind === "track" ? "backgroundColor" : "transformOffsetX";
}

function switchOnVariantProps(
  kind: UISwitchChildSlot,
  base: ContainerWidgetProps,
  travel: number
): ContainerWidgetProps {
  return kind === "track"
    ? { ...base, backgroundColor: SWITCH_TRACK_ON_COLOR }
    : { ...base, transformOffsetX: travel };
}

function withGroupTransition(group: AppearancePropertyGroup): AppearancePropertyGroup {
  return {
    key: group.key,
    rows: group.rows,
    transition: getDefaultAppearanceTransition("tween")
  } as AppearancePropertyGroup;
}

/**
 * Off look plus the fixed `on` variant the renderer flips to.
 *
 * The `on` variant is built by seeding a second full appearance model from the on-state flat props
 * rather than by patching a handful of rows: `resolveContainerRectangleLike` reads a variant as the
 * whole baseline, so a variant missing keys would resolve to holes, and
 * `ensureContainerAppearanceHasAllKeys` only ever fills missing *keys*, never a missing *variant*.
 */
export function createSwitchPartProps(
  kind: UISwitchChildSlot,
  travel: number
): Record<string, unknown> {
  const props = switchPartFlatProps(kind);
  const appearance = createInitialContainerAppearance(props);
  const animatedKey = switchOnVariantKey(kind);
  const onGroups =
    createInitialContainerAppearance(switchOnVariantProps(kind, props, travel)).variants[0]
      ?.propertyGroups ?? [];
  const onVariant: AppearanceVariant = {
    id: UI_SWITCH_ON_VARIANT_ID,
    name: translate("widgets.defaults.switch.onVariant"),
    propertyGroups: onGroups.map((group) =>
      group.key === animatedKey ? withGroupTransition(group) : group
    )
  };
  const model: AppearanceModel = {
    ...appearance,
    variants: [...appearance.variants, onVariant]
  };
  return {
    ...props,
    appearance: model
  };
}

/**
 * Rewrites the thumb's `on` travel in place. Returns `null` when the element carries no usable
 * `on` variant, so the caller can leave the document untouched instead of inventing one.
 */
export function setSwitchOnVariantTravel(
  appearance: unknown,
  travel: number
): AppearanceModel | null {
  const model = appearance as AppearanceModel | null | undefined;
  if (!model || !Array.isArray(model.variants)) {
    return null;
  }
  const onVariant = model.variants.find((variant) => variant.id === UI_SWITCH_ON_VARIANT_ID);
  if (!onVariant) {
    return null;
  }
  let changed = false;
  const variants = model.variants.map((variant) => {
    if (variant.id !== UI_SWITCH_ON_VARIANT_ID) {
      return variant;
    }
    return {
      ...variant,
      propertyGroups: variant.propertyGroups.map((group) => {
        if (group.key !== "transformOffsetX") {
          return group;
        }
        changed = true;
        const rows =
          group.rows.length > 0
            ? group.rows.map((row, index) => (index === 0 ? { ...row, value: travel } : row))
            : [{ conditions: null, value: travel }];
        return { key: group.key, rows, transition: group.transition } as AppearancePropertyGroup;
      })
    };
  });
  return changed ? { ...model, variants } : null;
}
