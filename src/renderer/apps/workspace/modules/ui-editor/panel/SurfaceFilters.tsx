import { useRef } from "react";
import { Check, Layers } from "lucide-react";
import { ContextMenu, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { IconButton } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import {
    SURFACE_KIND_OPTIONS,
    SURFACE_OWNER_OPTIONS,
    surfaceKindOptionView,
    type SurfacePanelView,
} from "./constants";

type SurfaceFiltersProps = {
    view: SurfacePanelView;
    onViewChange: (view: SurfacePanelView) => void;
};

/**
 * What kind of interface the list below is showing.
 *
 * Two entries, and they stay two: Page and Game UI are what an interface *is*. Everything a feature
 * owns — an avatar frame today, a mouse cursor next — sits behind the button on the right instead of
 * ranking beside them, because those are not a third type of interface, and a row of equals would
 * lose a little more width to every feature that ever grows a surface.
 *
 * The button carries the current one when one is picked, so the row still says what is being shown
 * without a fourth line of chrome.
 */
export function SurfaceFilters({
    view,
    onViewChange,
}: SurfaceFiltersProps) {
    const { t } = useTranslation();
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const anchorRef = useRef<HTMLButtonElement | null>(null);
    const activeOwner = SURFACE_OWNER_OPTIONS.find(option => option.view === view) ?? null;

    return (
        <div className="px-2 pt-2 pb-1">
            <div className="text-xs font-semibold text-fg-muted">{t("uiEditor.panel.interfaceType")}</div>
            <div className="mt-2 flex gap-2">
                {SURFACE_KIND_OPTIONS.map(option => {
                    const optionView = surfaceKindOptionView(option);
                    return (
                        <button
                            key={optionView}
                            type="button"
                            className={`flex-1 rounded-md px-2 py-1 text-xs font-medium border transition-colors ${
                                view === optionView
                                    ? "border-primary bg-primary/10 text-fg"
                                    : "border-edge text-fg-muted hover:bg-fill hover:text-fg"
                            }`}
                            onClick={() => onViewChange(optionView)}
                        >
                            {option.label}
                        </button>
                    );
                })}
                <IconButton
                    ref={anchorRef}
                    size="sm"
                    aria-label={activeOwner ? activeOwner.label : t("uiEditor.panel.featureSurfaces")}
                    data-tip={activeOwner ? activeOwner.label : t("uiEditor.panel.featureSurfaces")}
                    // Stretched to the row rather than sized from the control scale: its siblings are a
                    // segmented control with their own padding, and a button that is two pixels
                    // taller than the pair it sits beside is the misalignment the size scale exists
                    // to prevent.
                    className={`shrink-0 self-stretch min-h-0 w-7 border ${
                        activeOwner
                            ? "border-primary bg-primary/10 text-fg"
                            : "border-edge text-fg-muted hover:bg-fill hover:text-fg"
                    }`}
                    onClick={event => {
                        // Anchored to the button rather than to the pointer: this is a menu opened by
                        // a control, not a context menu struck at a position, so it lands in the same
                        // place however the button was reached — including from the keyboard, where
                        // the click carries the element's own coordinates rather than a cursor's.
                        const rect = event.currentTarget.getBoundingClientRect();
                        showMenu({
                            ...event,
                            preventDefault: () => event.preventDefault(),
                            clientX: rect.left,
                            clientY: rect.bottom + 4,
                        } as typeof event);
                    }}
                >
                    <Layers className="h-4 w-4" />
                </IconButton>
            </div>
            <ContextMenu
                items={SURFACE_OWNER_OPTIONS.map(option => ({
                    id: option.view,
                    label: option.label,
                    // The description is the row's hover text rather than a second line: the menu is a
                    // menu, and what each of these is for is a sentence the author needs once.
                    tooltip: option.description,
                    icon: view === option.view ? <Check className="h-3.5 w-3.5" /> : undefined,
                    onClick: () => onViewChange(option.view),
                }))}
                iconsEnabled
                position={menuState.position}
                visible={menuState.visible}
                onClose={hideMenu}
            />
        </div>
    );
}
