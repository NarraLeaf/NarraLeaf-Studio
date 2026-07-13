import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { SmartSnapDetailSettings } from "@/lib/ui-editor/snapping/types";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { SurfaceEditorToolbarSegButton, SurfaceEditorToolbarSegSlot } from "./SurfaceEditorToolbarButtonGroup";

const PANEL_VIEWPORT_PADDING = 8;
const PANEL_GAP = 4;

type Props = {
    stateService: UIEditorStateService;
    detail: SmartSnapDetailSettings;
};

/**
 * Fixed popover position (viewport / client coordinates) for a trigger + measured panel.
 * Prefers below the trigger; flips above when needed. Aligns to trigger left edge, or right-aligns
 * when overflowing the window (typical for a top-right toolbar).
 */
function computeSnapSettingsPanelClientPosition(trigger: DOMRect, panel: DOMRect): { x: number; y: number } {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = panel.width;
    const ph = panel.height;
    const p = PANEL_VIEWPORT_PADDING;
    const g = PANEL_GAP;

    let x = trigger.left;
    if (x + pw > vw - p) {
        x = trigger.right - pw;
    }
    x = Math.min(x, vw - pw - p);
    x = Math.max(p, x);

    let y = trigger.bottom + g;
    if (y + ph > vh - p) {
        const yFlip = trigger.top - g - ph;
        if (yFlip >= p) {
            y = yFlip;
        } else {
            y = Math.max(p, vh - ph - p);
        }
    }
    y = Math.max(p, Math.min(y, vh - ph - p));

    return { x, y };
}

/**
 * Dropdown trigger + panel for per-category smart snap toggles (project settings).
 */
export function SurfaceSnapSettingsTrigger({ stateService, detail }: Props) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [adjusted, setAdjusted] = useState({ x: 0, y: 0 });
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);

    const close = useCallback(() => setOpen(false), []);

    const toggle = useCallback(() => {
        setOpen(v => !v);
    }, []);

    useLayoutEffect(() => {
        if (!open) {
            return undefined;
        }

        const updatePosition = () => {
            const triggerEl = triggerRef.current;
            const panelEl = panelRef.current;
            if (!triggerEl || !panelEl) {
                return;
            }
            const next = computeSnapSettingsPanelClientPosition(triggerEl.getBoundingClientRect(), panelEl.getBoundingClientRect());
            setAdjusted(prev => (prev.x === next.x && prev.y === next.y ? prev : next));
        };

        updatePosition();

        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [open, detail]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const handlePointerDown = (e: MouseEvent) => {
            const target = e.target as Node | null;
            if (!target) {
                return;
            }
            if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) {
                return;
            }
            close();
        };
        const timer = window.setTimeout(() => {
            document.addEventListener("mousedown", handlePointerDown, true);
        }, 0);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener("mousedown", handlePointerDown, true);
        };
    }, [open, close]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                close();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open, close]);

    const patch = useCallback(
        (partial: Partial<SmartSnapDetailSettings>) => {
            stateService.patchSmartSnapDetailSettings(partial);
        },
        [stateService],
    );

    const panel =
        open &&
        typeof document !== "undefined" &&
        createPortal(
            <div
                ref={panelRef}
                data-snap-settings-panel="true"
                className="fixed z-50 min-w-[220px] rounded-md border border-edge bg-surface-raised py-2 shadow-lg"
                style={{ left: adjusted.x, top: adjusted.y }}
                onMouseDown={e => e.stopPropagation()}
            >
                <div className="border-b border-edge px-3 pb-2 text-2xs font-medium tracking-wide text-fg-subtle">
                    {t("uiEditor.snap.targets")}
                </div>
                <div className="pt-1">
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-fg hover:bg-fill-subtle">
                        <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border border-edge-strong bg-surface-sunken text-primary focus:ring-primary/40"
                            checked={detail.snapCanvasLayout}
                            onChange={() => patch({ snapCanvasLayout: !stateService.getSmartSnapDetailSettings().snapCanvasLayout })}
                        />
                        <span>{t("uiEditor.snap.canvasLayout")}</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-fg hover:bg-fill-subtle">
                        <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border border-edge-strong bg-surface-sunken text-primary focus:ring-primary/40"
                            checked={detail.snapElementBorder}
                            onChange={() => patch({ snapElementBorder: !stateService.getSmartSnapDetailSettings().snapElementBorder })}
                        />
                        <span>{t("uiEditor.snap.elementBorders")}</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-fg hover:bg-fill-subtle">
                        <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border border-edge-strong bg-surface-sunken text-primary focus:ring-primary/40"
                            checked={detail.snapElementLayout}
                            onChange={() => patch({ snapElementLayout: !stateService.getSmartSnapDetailSettings().snapElementLayout })}
                        />
                        <span>{t("uiEditor.snap.elementLayout")}</span>
                    </label>
                </div>
            </div>,
            document.body,
        );

    return (
        <>
            <SurfaceEditorToolbarSegSlot>
                <SurfaceEditorToolbarSegButton
                    ref={triggerRef}
                    type="button"
                    active={open}
                    onClick={toggle}
                    title={t("uiEditor.snap.settings")}
                    aria-expanded={open}
                    aria-haspopup="dialog"
                >
                    <ChevronDown className="h-4 w-4" />
                </SurfaceEditorToolbarSegButton>
            </SurfaceEditorToolbarSegSlot>
            {panel}
        </>
    );
}
