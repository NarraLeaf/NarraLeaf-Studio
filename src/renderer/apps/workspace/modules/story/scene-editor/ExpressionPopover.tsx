import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import type { StoryCharacterVariantSelection, StoryInlineEvent } from "@shared/types/story";
import type { Character } from "@/lib/workspace/services/character/Character";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useTranslation } from "@/lib/i18n";
import { CharacterAppearancePicker } from "./CharacterAppearancePicker";
import { AssetField } from "./StorySceneActionInspector";

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
    const panelRef = useRef<HTMLDivElement | null>(null);
    const characterId = props.character?.profile.getId();

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
        globalThis.document.addEventListener("mousedown", onDown, true);
        return () => globalThis.document.removeEventListener("mousedown", onDown, true);
    }, [props]);

    const expression = props.value.expression;

    const setAppearance = (next: { formName: string | undefined; variants: StoryCharacterVariantSelection | undefined }) => {
        if (!characterId) {
            return;
        }
        props.onChange({ ...props.value, expression: { characterId, formName: next.formName, variants: next.variants } });
    };
    const setSound = (assetId: string | undefined) => {
        const { sound, ...rest } = props.value;
        void sound;
        props.onChange(assetId ? { ...rest, sound: { assetId } } : rest);
    };

    const top = Math.min(props.anchor.bottom + 6, window.innerHeight - 360);
    const left = Math.min(props.anchor.left, window.innerWidth - 432);

    return createPortal(
        <div
            ref={panelRef}
            className="fixed z-[70] w-[26rem] rounded-lg border border-edge bg-surface-raised p-2 shadow-2xl"
            style={{ top, left: Math.max(8, left) }}
            onMouseDown={event => event.stopPropagation()}
        >
            <div className="mb-1.5 text-2xs font-medium tracking-wide text-fg-muted">{t("story.inlineEvent.title")}</div>
            {props.character ? (
                <CharacterAppearancePicker
                    character={props.character}
                    formName={expression?.formName}
                    variants={expression?.variants}
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
        document.body,
    );
}
