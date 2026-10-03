import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import type { StoryCharacterTagSelection, StoryInlineEvent } from "@shared/types/story";
import type { Character } from "@/lib/workspace/services/character/Character";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useTranslation } from "@/lib/i18n";
import { CharacterAppearancePicker } from "./CharacterAppearancePicker";
import { AssetField } from "./AssetField";
import { useFloatingLayer, useHostDocument } from "@/lib/components/layout";
import { keepStoryKeysInPopover } from "./PausePopover";

/**
 * Inline reveal-time event config popover, mirroring the Pause / Interpolation popovers. The
 * expression target reuses {@link CharacterAppearancePicker} (form + differential) — the same picker
 * the `/show` `/face` action uses — and an optional sound effect reuses the asset picker. The token
 * always belongs to the row's speaking character, so `character` is fixed by the caller.
 */
export function ExpressionPopover(props: {
    anchor: { top: number; left: number; bottom: number };
    value: StoryInlineEvent;
    character: Character | null;
    onChange: (event: StoryInlineEvent) => void;
    onRemove: () => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const doc = useHostDocument();
    const panelRef = useRef<HTMLDivElement | null>(null);
    // Takes the focus and keeps Tab inside, like every popover on a chip in the row being edited (see
    // `PausePopover`). The sound picker opens a dialog of its own above this, which closes first.
    useFloatingLayer({ open: true, onClose: props.onClose, panelRef, scope: "trap" });
    const characterId = props.character?.profile.getId();

    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            // The sound picker renders its own portal overlay (`.nl-window-content-layer`); a click
            // inside it (or any Select menu) must not dismiss this popover.
            if (
                panelRef.current?.contains(target) ||
                target?.closest?.("[data-select-menu]") ||
                target?.closest?.(".nl-window-content-layer")
            ) {
                return;
            }
            props.onClose();
        };
        doc.addEventListener("mousedown", onDown, true);
        return () => doc.removeEventListener("mousedown", onDown, true);
    }, [doc, props]);

    const expression = props.value.expression;

    const setAppearance = (next: { pose: string | undefined; tags: StoryCharacterTagSelection | undefined }) => {
        if (!characterId) {
            return;
        }
        props.onChange({ ...props.value, expression: { characterId, pose: next.pose, tags: next.tags } });
    };
    const setSound = (assetId: string | undefined) => {
        const { sound, ...rest } = props.value;
        void sound;
        props.onChange(assetId ? { ...rest, sound: { assetId } } : rest);
    };

    const view = doc.defaultView ?? window;
    const top = Math.min(props.anchor.bottom + 6, view.innerHeight - 360);
    const left = Math.min(props.anchor.left, view.innerWidth - 432);

    return createPortal(
        <div
            ref={panelRef}
            // The appearance preview inside is as tall as the author asked for, while the panel is
            // placed from its anchor rather than sized to fit - so it is told what is left of the
            // window below it and scrolls instead of running off the bottom.
            className="fixed z-[70] w-[26rem] overflow-y-auto rounded-lg border border-edge bg-surface-raised p-2 shadow-2xl"
            style={{ top, left: Math.max(8, left), maxHeight: Math.max(240, view.innerHeight - top - 8) }}
            onMouseDown={event => event.stopPropagation()}
            onKeyDown={keepStoryKeysInPopover}
        >
            <div className="mb-1.5 text-2xs font-medium tracking-wide text-fg-muted">{t("story.inlineEvent.title")}</div>
            {props.character ? (
                <CharacterAppearancePicker
                    character={props.character}
                    pose={expression?.pose}
                    tags={expression?.tags}
                    onChange={setAppearance}
                />
            ) : (
                <div className="rounded-md border border-dashed border-edge bg-fill-subtle p-3 text-xs text-fg-subtle">
                    {t("story.inlineEvent.noCharacter")}
                </div>
            )}
            <div className="mt-2">
                <AssetField
                    label={t("story.inlineEvent.sound")}
                    assetType={AssetType.Audio}
                    assetId={props.value.sound?.assetId}
                    onChange={setSound}
                />
            </div>
            <button
                type="button"
                className="mt-2 flex items-center gap-1 text-xs text-fg-muted transition-colors hover:text-danger"
                onClick={props.onRemove}
            >
                <Trash2 className="h-3 w-3" />
                {t("common.remove")}
            </button>
        </div>,
        doc.body,
    );
}
