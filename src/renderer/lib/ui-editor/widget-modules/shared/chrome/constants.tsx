import type { ReactNode } from "react";
import type { TranslationKey } from "@shared/i18n";

type StrokeStyleOptionValue = "solid" | "dashed" | "dotted" | "none";

const STROKE_STYLE_DASHARRAY: Record<StrokeStyleOptionValue, string | undefined> = {
  solid: undefined,
  dashed: "4 3",
  dotted: "1 3",
  none: undefined,
};

function StrokeStyleIcon({ style }: { style: StrokeStyleOptionValue }) {
  const dashArray = STROKE_STYLE_DASHARRAY[style];
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-4 h-4 text-fg-muted"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
    >
      {style === "none" ? (
        <>
          <line x1="3" y1="3" x2="13" y2="13" />
          <line x1="3" y1="13" x2="13" y2="3" />
        </>
      ) : (
        <line x1="3" y1="8" x2="13" y2="8" strokeDasharray={dashArray} />
      )}
    </svg>
  );
}

type CornerPosition = "tl" | "tr" | "bl" | "br";

const CORNER_PATHS: Record<CornerPosition, string> = {
  tl: "M4 12 L4 4 L12 4",
  tr: "M12 12 L12 4 L4 4",
  bl: "M4 4 L4 12 L12 12",
  br: "M12 4 L12 12 L4 12",
};

function CornerIcon({ position }: { position: CornerPosition }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-4 h-4 text-fg-muted"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
    >
      <path d={CORNER_PATHS[position]} />
    </svg>
  );
}

const CONTROL_BUTTON_BASE =
  "grid h-9 w-9 place-items-center rounded-lg border border-edge bg-transparent text-fg-muted transition hover:bg-fill-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50";
const CONTROL_BUTTON_ACTIVE = "bg-fill border-edge-strong text-fg";

export function controlButtonClass(active?: boolean) {
  return [CONTROL_BUTTON_BASE, active ? CONTROL_BUTTON_ACTIVE : null].filter(Boolean).join(" ");
}

export const BORDER_STYLE_OPTIONS: { value: string; labelKey: TranslationKey; icon: ReactNode }[] = [
  { value: "solid", labelKey: "widgetAppearance.border.styleSolid", icon: <StrokeStyleIcon style="solid" /> },
  { value: "dashed", labelKey: "widgetAppearance.border.styleDashed", icon: <StrokeStyleIcon style="dashed" /> },
  { value: "dotted", labelKey: "widgetAppearance.border.styleDotted", icon: <StrokeStyleIcon style="dotted" /> },
  { value: "none", labelKey: "widgetAppearance.border.styleNone", icon: <StrokeStyleIcon style="none" /> },
];

export const FILL_TYPE_OPTIONS: { value: string; labelKey: TranslationKey }[] = [
  { value: "color", labelKey: "widgetAppearance.fillType.color" },
  { value: "image", labelKey: "widgetAppearance.fillType.image" },
];

export const STROKE_ALIGN_OPTIONS: { value: string; labelKey: TranslationKey }[] = [
  { value: "none", labelKey: "widgetAppearance.border.alignNone" },
  { value: "center", labelKey: "widgetAppearance.border.alignCenter" },
  { value: "inside", labelKey: "widgetAppearance.border.alignInside" },
  { value: "outside", labelKey: "widgetAppearance.border.alignOutside" },
];

export const STROKE_JOIN_OPTIONS: { value: string; labelKey: TranslationKey }[] = [
  { value: "miter", labelKey: "widgetAppearance.border.joinMiter" },
  { value: "round", labelKey: "widgetAppearance.border.joinRound" },
  { value: "bevel", labelKey: "widgetAppearance.border.joinBevel" },
];

const STROKE_SIDE_PATHS: Record<"all" | "top" | "right" | "bottom" | "left", string> = {
  all: "M4 4 H12 V12 H4 Z",
  top: "M4 4 H12",
  right: "M12 4 V12",
  bottom: "M12 12 H4",
  left: "M4 12 V4",
};

function StrokeSideIcon({ side }: { side: keyof typeof STROKE_SIDE_PATHS }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="w-4 h-4 shrink-0 text-current"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect
        x={3}
        y={3}
        width={10}
        height={10}
        rx={1}
        stroke="currentColor"
        strokeWidth={1}
        strokeOpacity={0.35}
        fill="none"
      />
      <path d={STROKE_SIDE_PATHS[side]} />
    </svg>
  );
}

export const STROKE_SIDE_OPTIONS: { id: string; icon: ReactNode; labelKey: TranslationKey }[] = [
  { id: "all", icon: <StrokeSideIcon side="all" />, labelKey: "widgetAppearance.border.sideAll" },
  { id: "top", icon: <StrokeSideIcon side="top" />, labelKey: "widgetAppearance.border.sideTop" },
  { id: "right", icon: <StrokeSideIcon side="right" />, labelKey: "widgetAppearance.border.sideRight" },
  { id: "bottom", icon: <StrokeSideIcon side="bottom" />, labelKey: "widgetAppearance.border.sideBottom" },
  { id: "left", icon: <StrokeSideIcon side="left" />, labelKey: "widgetAppearance.border.sideLeft" },
];

export { CornerIcon };
