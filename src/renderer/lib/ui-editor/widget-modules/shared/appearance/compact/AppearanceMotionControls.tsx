import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { Select } from "@/lib/components/elements/Select";
import { NumericDraftEnhancedInput } from "@/lib/components/inputs/NumericDraftEnhancedInput";
import { InlineMenuTriggerButton } from "@/lib/ui-editor/widget-modules/shared/chrome/InlineMenuTriggerButton";
import { Check, Settings2, Trash2 } from "lucide-react";
import type {
    AppearanceFieldTransition,
    AppearancePropertyKey,
    AppearanceTransitionTweenEasing,
    AppearanceVariant,
} from "@shared/types/ui-editor/appearance";
import {
    APPEARANCE_TRANSITION_TYPE_OPTIONS,
    APPEARANCE_TWEEN_EASING_OPTIONS,
    formatAppearanceTransitionSummary,
    getAppearanceFieldLabel,
    getAppearanceGroupTransition,
    getDefaultAppearanceTransition,
} from "../appearanceMotion";

type ModuleMotionMenuButtonProps = {
    enabled: boolean;
    hasConfiguredFields: boolean;
    onEnabledChange: (next: boolean) => void;
};

type AppearanceFieldMotionButtonProps = {
    variant: AppearanceVariant;
    /** Writes transition for this field on every variant in the model. */
    setFieldTransition: (groupKey: AppearancePropertyKey, transition: AppearanceFieldTransition | null) => void;
    groupKey: AppearancePropertyKey;
    draftResetKey: string;
};

const FIELD_POPOVER_WIDTH = 280;
const FIELD_POPOVER_SPACING = 8;
const FIELD_POPOVER_MARGIN = 8;
/** Above motion field popover (`z-[80]`) so narrow-column `EnhancedInput` portals stack correctly. */
const MOTION_FIELD_NUMERIC_POPOVER_Z_INDEX = 90;

/** Borderless icon-only trigger; active = field has a transition configured. */
function motionIconTriggerClass(active: boolean): string {
    return [
        "grid h-7 w-7 shrink-0 place-items-center rounded border-0 bg-transparent p-0 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "text-primary hover:text-primary" : "text-fg-subtle hover:text-fg",
    ].join(" ");
}

function patchTransition(
    current: AppearanceFieldTransition | null,
    patch: Partial<AppearanceFieldTransition> & { type?: AppearanceFieldTransition["type"] }
): AppearanceFieldTransition {
    const nextType = patch.type ?? current?.type ?? "tween";
    const base = nextType === "spring" ? getDefaultAppearanceTransition("spring") : getDefaultAppearanceTransition("tween");
    const seeded = current?.type === nextType && current ? current : base;
    return {
        ...seeded,
        ...patch,
        type: nextType,
    } as AppearanceFieldTransition;
}

export function ModuleMotionMenuButton({
    enabled,
    hasConfiguredFields,
    onEnabledChange,
}: ModuleMotionMenuButtonProps) {
    const { t } = useTranslation();
    const menu = useMemo((): ContextMenuDef => {
        return [
            {
                id: "motion-controls",
                label: t("widgetAppearance.motion.animatedFields"),
                submenuIconsEnabled: true,
                submenu: [
                    {
                        id: "motion-controls-on",
                        label: t("widgetAppearance.motion.on"),
                        icon: enabled ? <Check className="w-4 h-4 text-primary" /> : undefined,
                        onClick: () => onEnabledChange(true),
                    },
                    {
                        id: "motion-controls-off",
                        label: t("widgetAppearance.motion.off"),
                        icon: !enabled ? <Check className="w-4 h-4 text-primary" /> : undefined,
                        onClick: () => onEnabledChange(false),
                    },
                ],
            },
        ];
    }, [enabled, onEnabledChange, t]);

    return (
        <InlineMenuTriggerButton
            buttonStyle="iconGhost"
            menu={menu}
            ariaLabel={t("widgetAppearance.motion.openMenuAria")}
            icon={<Settings2 className="w-4 h-4" strokeWidth={1.75} />}
            className={hasConfiguredFields ? "text-primary hover:text-primary" : ""}
        />
    );
}

export function AppearanceFieldMotionButton({
    variant,
    setFieldTransition,
    groupKey,
    draftResetKey,
}: AppearanceFieldMotionButtonProps) {
    const { t } = useTranslation();
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const label = getAppearanceFieldLabel(groupKey);
    const transition = getAppearanceGroupTransition(variant, groupKey) ?? null;

    const commitTransition = useCallback(
        (next: AppearanceFieldTransition | null) => {
            setFieldTransition(groupKey, next);
        },
        [groupKey, setFieldTransition]
    );

    const ensureTransition = useCallback(() => {
        if (transition) {
            return transition;
        }
        const next = getDefaultAppearanceTransition("tween");
        commitTransition(next);
        return next;
    }, [commitTransition, transition]);

    const handlePosition = useCallback(() => {
        if (!buttonRef.current) {
            return;
        }
        const rect = buttonRef.current.getBoundingClientRect();
        const panelHeight = panelRef.current?.offsetHeight ?? 240;
        let left = rect.right - FIELD_POPOVER_WIDTH;
        let top = rect.bottom + FIELD_POPOVER_SPACING;

        if (left < FIELD_POPOVER_MARGIN) {
            left = FIELD_POPOVER_MARGIN;
        }
        if (left + FIELD_POPOVER_WIDTH > window.innerWidth - FIELD_POPOVER_MARGIN) {
            left = window.innerWidth - FIELD_POPOVER_WIDTH - FIELD_POPOVER_MARGIN;
        }
        if (top + panelHeight > window.innerHeight - FIELD_POPOVER_MARGIN) {
            top = rect.top - panelHeight - FIELD_POPOVER_SPACING;
        }
        if (top < FIELD_POPOVER_MARGIN) {
            top = FIELD_POPOVER_MARGIN;
        }
        setPosition({ left, top });
    }, []);

    useLayoutEffect(() => {
        if (!open) {
            return;
        }
        handlePosition();
        window.addEventListener("resize", handlePosition);
        window.addEventListener("scroll", handlePosition, true);
        return () => {
            window.removeEventListener("resize", handlePosition);
            window.removeEventListener("scroll", handlePosition, true);
        };
    }, [handlePosition, open]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) {
                return;
            }
            if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) {
                return;
            }
            setOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setOpen(false);
            }
        };
        const timer = setTimeout(() => {
            document.addEventListener("mousedown", handlePointerDown, true);
        }, 0);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            clearTimeout(timer);
            document.removeEventListener("mousedown", handlePointerDown, true);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [open]);

    const popover = open && typeof document !== "undefined"
        ? createPortal(
              <div
                  ref={panelRef}
                  className="fixed z-[80] w-[280px] rounded-xl border border-edge bg-surface-raised p-3 shadow-2xl"
                  style={{ left: position.left, top: position.top, maxWidth: "calc(100vw - 16px)" }}
                  onMouseDown={event => event.stopPropagation()}
              >
                  <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                          <div className="text-xs font-medium text-fg">{label}</div>
                          <div className="mt-1 text-2xs text-fg-subtle">
                              {formatAppearanceTransitionSummary(transition)}
                          </div>
                      </div>
                      {transition ? (
                          <button
                              type="button"
                              onClick={() => commitTransition(null)}
                              className="grid h-7 w-7 place-items-center rounded-md border border-edge bg-fill-subtle text-fg-muted transition hover:bg-danger/10 hover:text-danger"
                              title={t("widgetAppearance.motion.clearFieldTitle")}
                          >
                              <Trash2 className="w-3.5 h-3.5" />
                          </button>
                      ) : null}
                  </div>

                  {!transition ? (
                      <div className="mt-3 space-y-3">
                          <p className="text-xs leading-relaxed text-fg-muted">
                              {t("widgetAppearance.motion.offHint")}
                          </p>
                          <button
                              type="button"
                              onClick={() => ensureTransition()}
                              className="inline-flex h-8 items-center rounded-md border border-primary/40 bg-primary/15 px-3 text-xs font-medium text-primary transition hover:bg-primary/20"
                          >
                              {t("widgetAppearance.motion.enable")}
                          </button>
                      </div>
                  ) : (
                      <div className="mt-3 space-y-3">
                          <div>
                              <label className="mb-1 block text-2xs tracking-wide text-fg-subtle">
                                  {t("widgetAppearance.motion.type")}
                              </label>
                              <Select
                                  value={transition.type}
                                  options={APPEARANCE_TRANSITION_TYPE_OPTIONS.map(option => ({
                                      value: option.value,
                                      labelKey: option.labelKey,
                                  }))}
                                  fullWidth
                                  onChange={next =>
                                      commitTransition(
                                          patchTransition(transition, {
                                              type: String(next) as AppearanceFieldTransition["type"],
                                          })
                                      )
                                  }
                              />
                          </div>

                          {transition.type === "tween" ? (
                              <>
                                  <div className="grid grid-cols-2 gap-2">
                                      <div className="min-w-0">
                                          <label className="mb-1 block text-2xs tracking-wide text-fg-subtle">
                                              {t("widgetAppearance.motion.duration")}
                                          </label>
                                          <NumericDraftEnhancedInput
                                              popoverZIndex={MOTION_FIELD_NUMERIC_POPOVER_Z_INDEX}
                                              committedDisplay={String(transition.durationMs)}
                                              draftResetKey={`${draftResetKey}-${groupKey}-duration`}
                                              onFiniteNumber={value =>
                                                  commitTransition(
                                                      patchTransition(transition, {
                                                          durationMs: Math.max(0, Math.min(5000, Math.round(value))),
                                                      })
                                                  )
                                              }
                                              inputMode="numeric"
                                              type="number"
                                              min={0}
                                              max={5000}
                                              unit="ms"
                                              className="w-full min-w-0"
                                          />
                                      </div>
                                      <div className="min-w-0">
                                          <label className="mb-1 block text-2xs tracking-wide text-fg-subtle">
                                              {t("widgetAppearance.motion.delay")}
                                          </label>
                                          <NumericDraftEnhancedInput
                                              popoverZIndex={MOTION_FIELD_NUMERIC_POPOVER_Z_INDEX}
                                              committedDisplay={String(transition.delayMs ?? 0)}
                                              draftResetKey={`${draftResetKey}-${groupKey}-delay`}
                                              onFiniteNumber={value =>
                                                  commitTransition(
                                                      patchTransition(transition, {
                                                          delayMs: Math.max(0, Math.min(5000, Math.round(value))),
                                                      })
                                                  )
                                              }
                                              inputMode="numeric"
                                              type="number"
                                              min={0}
                                              max={5000}
                                              unit="ms"
                                              className="w-full min-w-0"
                                          />
                                      </div>
                                  </div>
                                  <div>
                                      <label className="mb-1 block text-2xs tracking-wide text-fg-subtle">
                                          {t("widgetAppearance.motion.easing")}
                                      </label>
                                      <Select
                                          value={transition.easing}
                                          options={APPEARANCE_TWEEN_EASING_OPTIONS.map(option => ({
                                              value: option.value,
                                              labelKey: option.labelKey,
                                          }))}
                                          fullWidth
                                          onChange={next =>
                                              commitTransition(
                                                  patchTransition(transition, {
                                                      easing: String(next) as AppearanceTransitionTweenEasing,
                                                  })
                                              )
                                          }
                                      />
                                  </div>
                              </>
                          ) : (
                              <>
                                  <div className="grid grid-cols-2 gap-2">
                                      <div className="min-w-0">
                                          <label className="mb-1 block text-2xs tracking-wide text-fg-subtle">
                                              {t("widgetAppearance.motion.stiffness")}
                                          </label>
                                          <NumericDraftEnhancedInput
                                              popoverZIndex={MOTION_FIELD_NUMERIC_POPOVER_Z_INDEX}
                                              committedDisplay={String(transition.stiffness)}
                                              draftResetKey={`${draftResetKey}-${groupKey}-stiffness`}
                                              onFiniteNumber={value =>
                                                  commitTransition(
                                                      patchTransition(transition, {
                                                          stiffness: Math.max(1, Math.min(1200, Math.round(value))),
                                                      })
                                                  )
                                              }
                                              inputMode="numeric"
                                              type="number"
                                              min={1}
                                              max={1200}
                                              className="w-full min-w-0"
                                          />
                                      </div>
                                      <div className="min-w-0">
                                          <label className="mb-1 block text-2xs tracking-wide text-fg-subtle">
                                              {t("widgetAppearance.motion.damping")}
                                          </label>
                                          <NumericDraftEnhancedInput
                                              popoverZIndex={MOTION_FIELD_NUMERIC_POPOVER_Z_INDEX}
                                              committedDisplay={String(transition.damping)}
                                              draftResetKey={`${draftResetKey}-${groupKey}-damping`}
                                              onFiniteNumber={value =>
                                                  commitTransition(
                                                      patchTransition(transition, {
                                                          damping: Math.max(1, Math.min(200, Math.round(value))),
                                                      })
                                                  )
                                              }
                                              inputMode="numeric"
                                              type="number"
                                              min={1}
                                              max={200}
                                              className="w-full min-w-0"
                                          />
                                      </div>
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                      <div className="min-w-0">
                                          <label className="mb-1 block text-2xs tracking-wide text-fg-subtle">
                                              {t("widgetAppearance.motion.mass")}
                                          </label>
                                          <NumericDraftEnhancedInput
                                              popoverZIndex={MOTION_FIELD_NUMERIC_POPOVER_Z_INDEX}
                                              committedDisplay={String(transition.mass)}
                                              draftResetKey={`${draftResetKey}-${groupKey}-mass`}
                                              onFiniteNumber={value =>
                                                  commitTransition(
                                                      patchTransition(transition, {
                                                          mass: Math.max(0.1, Math.min(10, Math.round(value * 100) / 100)),
                                                      })
                                                  )
                                              }
                                              inputMode="decimal"
                                              type="number"
                                              min={0.1}
                                              max={10}
                                              step={0.1}
                                              className="w-full min-w-0"
                                          />
                                      </div>
                                      <div className="min-w-0">
                                          <label className="mb-1 block text-2xs tracking-wide text-fg-subtle">
                                              {t("widgetAppearance.motion.delay")}
                                          </label>
                                          <NumericDraftEnhancedInput
                                              popoverZIndex={MOTION_FIELD_NUMERIC_POPOVER_Z_INDEX}
                                              committedDisplay={String(transition.delayMs ?? 0)}
                                              draftResetKey={`${draftResetKey}-${groupKey}-spring-delay`}
                                              onFiniteNumber={value =>
                                                  commitTransition(
                                                      patchTransition(transition, {
                                                          delayMs: Math.max(0, Math.min(5000, Math.round(value))),
                                                      })
                                                  )
                                              }
                                              inputMode="numeric"
                                              type="number"
                                              min={0}
                                              max={5000}
                                              unit="ms"
                                              className="w-full min-w-0"
                                          />
                                      </div>
                                  </div>
                              </>
                          )}
                      </div>
                  )}
              </div>,
              document.body
          )
        : null;

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                onClick={() => setOpen(prev => !prev)}
                aria-label={t("widgetAppearance.motion.configureFieldAria", { field: label })}
                title={t("widgetAppearance.motion.fieldMotionTitle", { field: label })}
                className={motionIconTriggerClass(Boolean(transition))}
            >
                <Settings2 className="w-4 h-4" strokeWidth={1.75} />
            </button>
            {popover}
        </>
    );
}
