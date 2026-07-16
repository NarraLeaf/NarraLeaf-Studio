/**
 * Floating condition editor anchored to a branch header's condition chip. Wraps the shared
 * `ConditionEditor` (variable / graph tiers) in a portal, mirroring `InterpolationPopover`. Editing is
 * inline — the author never has to open the side inspector to author an if / else-if condition.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import type { StoryConditionRef, StoryDocument, StorySceneId } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { ConditionEditor } from "./ConditionEditor";

const MENU_Z = 90;

export function ConditionPopover(props: {
    anchor: { top: number; left: number; bottom: number };
    document: StoryDocument;
    sceneId: StorySceneId;
    value: StoryConditionRef | undefined;
    onChange: (condition: StoryConditionRef | undefined) => void;
    onClear: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const panelRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                props.onClose();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [props]);

    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (panelRef.current?.contains(target) || target?.closest?.("[data-select-menu]")) {
                return;
            }
            props.onClose();
        };
        globalThis.document.addEventListener("mousedown", onDown, true);
        return () => globalThis.document.removeEventListener("mousedown", onDown, true);
    }, [props]);

    const top = Math.min(props.anchor.bottom + 6, window.innerHeight - 320);
    const left = Math.min(props.anchor.left, window.innerWidth - 288);

    return createPortal(
        <div
            ref={panelRef}
            className="fixed z-[80] w-72 rounded-lg border border-edge bg-surface-raised p-2 shadow-2xl"
            style={{ top: Math.max(8, top), left: Math.max(8, left) }}
            onMouseDown={event => event.stopPropagation()}
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
        globalThis.document.body,
    );
}
