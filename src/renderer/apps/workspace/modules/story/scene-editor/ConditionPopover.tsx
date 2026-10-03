/**
 * Floating condition editor anchored to a branch header's condition chip. Wraps the shared
 * `ConditionEditor` (variable / graph tiers) in a portal, mirroring `InterpolationPopover`. Editing is
 * inline — the author never has to open the side inspector to author an if / else-if condition.
 */

import { useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import type { StoryConditionRef, StoryDocument, StorySceneId } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { ConditionEditor } from "./ConditionEditor";
import { useFloatingLayer, useHostDocument } from "@/lib/components/layout";
import { keepStoryKeysInPopover } from "./PausePopover";

const MENU_Z = 90;

export function ConditionPopover(props: {
    anchor: { top: number; left: number; bottom: number };
    /**
     * The chip this opened from. It counts as inside for light dismiss - pressing it again closes
     * the popover through the chip's own handler, not here and then open again there - and it is
     * where focus goes back to when the popover closes.
     */
    ownerRef?: RefObject<HTMLElement | null>;
    document: StoryDocument;
    sceneId: StorySceneId;
    value: StoryConditionRef | undefined;
    onChange: (condition: StoryConditionRef | undefined) => void;
    onClear: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const doc = useHostDocument();
    const panelRef = useRef<HTMLDivElement | null>(null);
    // A popover on a header chip, not on the row being typed in: it takes the focus, Escape closes
    // it alone (a menu inside the condition editor closes ahead of it), and closing hands the focus
    // back to the chip.
    useFloatingLayer({
        open: true,
        onClose: props.onClose,
        panelRef,
        ownerRefs: props.ownerRef ? [props.ownerRef] : undefined,
    });

    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (
                panelRef.current?.contains(target)
                || props.ownerRef?.current?.contains(target)
                || target?.closest?.("[data-select-menu]")
            ) {
                return;
            }
            props.onClose();
        };
        doc.addEventListener("mousedown", onDown, true);
        return () => doc.removeEventListener("mousedown", onDown, true);
    }, [doc, props]);

    const view = doc.defaultView ?? window;
    const top = Math.min(props.anchor.bottom + 6, view.innerHeight - 320);
    const left = Math.min(props.anchor.left, view.innerWidth - 288);

    return createPortal(
        <div
            ref={panelRef}
            className="fixed z-[80] w-72 rounded-lg border border-edge bg-surface-raised p-2 shadow-2xl"
            style={{ top: Math.max(8, top), left: Math.max(8, left) }}
            onMouseDown={event => event.stopPropagation()}
            onKeyDown={keepStoryKeysInPopover}
        >
            <div className="mb-1.5 text-2xs font-medium tracking-wide text-fg-muted">{t("story.condition.title")}</div>
            <ConditionEditor
                document={props.document}
                sceneId={props.sceneId}
                value={props.value}
                onChange={props.onChange}
                menuZIndex={MENU_Z}
                menuDataAttributes={{ "data-select-menu": "true" }}
                onBeforeOpenBlueprint={props.onClose}
            />
            <button
                type="button"
                className="mt-2 flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-danger"
                onClick={props.onClear}
            >
                <Trash2 className="h-3 w-3" />
                {t("story.condition.clear")}
            </button>
        </div>,
        doc.body,
    );
}
