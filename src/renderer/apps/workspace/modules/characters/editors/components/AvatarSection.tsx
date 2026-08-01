import { Crop, ImagePlus, RefreshCw, RotateCcw, UserRound, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { EmptyState } from "@/lib/components/elements/EmptyState";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { SectionCard } from "@/lib/components/elements/SectionCard";
import { Switch } from "@/lib/components/elements/Switch";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { useCompositedSprite, type SpriteSelection } from "@/lib/workspace/hooks/useCompositedSprite";
import type { Character } from "@/lib/workspace/services/character/Character";
import type { CharacterAppearance } from "@/lib/workspace/services/character/CharacterAppearance";
import type { PortraitCrop } from "@/lib/workspace/services/character/types";
import { HeadThumbnail } from "./HeadThumbnail";
import { ICON_BTN, ICON_BTN_ON } from "./iconButton";

/** The box a dialog gives an avatar, at the size it is baked at. */
const AVATAR_PREVIEW_PX = 256;

/** Which of the four answers the resolver gives for this differential. */
export type AvatarSource = "override" | "baked" | "characterDefault" | "none";

/**
 * The dialog avatar this differential actually resolves to, at the size it is shown at.
 *
 * Until this existed, nothing in the authoring UI rendered a dialog avatar at all: the baker wrote
 * PNGs nobody looked at, and the only way to find out whether the automatic head crop had framed an
 * ear was to launch a preview and reach a line of dialogue. Which meant the crop was, in practice,
 * unauthorable — see {@link PortraitCropBox} for the other half of that.
 *
 * ## Which of the four sources is in force is shown, not named
 *
 * This carried a badge saying "Override" / "Baked" / "Character default" / "None". It was removed
 * because the buttons beside it already say all four and cannot go stale: the `ImagePlus` is lit and
 * an `X` exists exactly when there is an override, the crop pair renders exactly when the picture is
 * derived from the sprite (the only case a framing means anything), and with neither of those a
 * picture is the character's default while the empty state is nothing at all. A badge that repeats
 * what is already legible is a second thing to keep true.
 *
 * The order the resolver takes — override, then bake, then the character's default, then nothing —
 * is not this component's rule. It is `resolveCharacterAvatarAssetId`'s, and it is what the runtime
 * does; following it here is only reporting.
 *
 * The bake arm renders the *live* stack under the live crop rather than the PNG on disk, because
 * those two are the same picture whenever the bake is current and, when it is not, the live one is
 * the one the author just asked for. The receipt below says what a run last did.
 */
export function AvatarSection(props: {
    character: Character;
    appearance: CharacterAppearance;
    /** The differential being previewed, or null when there is none to key an avatar on. */
    avatarKey: string | null;
    /** What draws it — a pose for a preset character, a tag set for a layered one. */
    selection: SpriteSelection;
    /** The framing in force for this differential, or undefined while the head is being located. */
    crop: PortraitCrop | undefined;
    /** True when that framing is this differential's own rather than the character's default. */
    cropScoped: boolean;
    /**
     * Switch between framing this one differential and framing every one of them. Both image-backed
     * kinds get it: a layered character keys its crop on the tag combination, so "this look only" is
     * as writable there as "this pose only" is for a preset one.
     */
    onToggleScope: (() => void) | null;
    onResetCrop: () => void;
    cropping: boolean;
    onToggleCropping: () => void;
    onPickOverride: (anchor: HTMLElement) => void;
    onClearOverride: () => void;
    /** Whether the writes here are available at all (a frozen project switches them off). */
    frozen: boolean;
    freezeReason: string;
    onRebake: () => void;
    rebaking: boolean;
    /** One line of what the last bake did, or null when none has run in this session. */
    receipt: string | null;
}) {
    const { t } = useTranslation();
    const entry = props.avatarKey ? props.appearance.getAvatar(props.avatarKey) : null;
    const override = entry?.overrideAssetId?.trim() || null;
    const characterDefault = props.character.profile.getDefaultAvatarAssetId();
    const draws = props.appearance.resolveDrawList(props.selection).some(Boolean);
    const source: AvatarSource = override
        ? "override"
        : draws
            ? "baked"
            : characterDefault
                ? "characterDefault"
                : "none";

    // All three unconditionally: which one is shown is a branch, and a hook is not.
    const overrideImage = useAssetObjectUrl(override);
    const fallbackImage = useAssetObjectUrl(characterDefault);
    const composite = useCompositedSprite(props.character, props.selection, AVATAR_PREVIEW_PX);

    const writes = (ownDisabled: boolean, ownTitle: string) => ({
        disabled: ownDisabled || props.frozen,
        title: ownDisabled ? ownTitle : props.frozen ? props.freezeReason : ownTitle,
    });

    return (
        <SectionCard
            title={t("characters.editor.avatar")}
            bodyClassName="p-2 space-y-2"
            actions={
                <button
                    className={ICON_BTN}
                    onClick={props.onRebake}
                    {...writes(props.rebaking, t("characters.editor.rebake"))}
                >
                    <RefreshCw className={cn("w-3.5 h-3.5", props.rebaking && "animate-spin")} />
                </button>
            }
        >
            <div className="mx-auto grid aspect-square w-full max-w-[256px] place-items-center overflow-hidden rounded-md border border-edge bg-fill">
                {source === "override" && overrideImage.url && (
                    <img src={overrideImage.url} alt="" draggable={false} className="h-full w-full object-contain" />
                )}
                {source === "baked" && (
                    <HeadThumbnail url={composite.url} alt="" frame={props.crop} className="h-full w-full" />
                )}
                {source === "characterDefault" && fallbackImage.url && (
                    <img src={fallbackImage.url} alt="" draggable={false} className="h-full w-full object-contain" />
                )}
                {source === "none" && (
                    <EmptyState size="sm" icon={<UserRound className="h-6 w-6" />} />
                )}
            </div>

            <div className="flex items-center justify-end gap-0.5">
                {/* A framing only means anything while the avatar is derived from the sprite: an
                    override is already a finished picture and the character default is not this
                    differential's at all. */}
                {source === "baked" && (
                    <>
                        <button
                            className={props.cropping ? ICON_BTN_ON : ICON_BTN}
                            onClick={props.onToggleCropping}
                            {...writes(false, t("characters.preview.setPortrait"))}
                        >
                            <Crop className="w-3.5 h-3.5" />
                        </button>
                        <button
                            className={ICON_BTN}
                            onClick={props.onResetCrop}
                            {...writes(props.crop === undefined, t("characters.preview.resetPortrait"))}
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                    </>
                )}
                <button
                    className={override ? ICON_BTN_ON : ICON_BTN}
                    onClick={event => props.onPickOverride(event.currentTarget)}
                    {...writes(!props.avatarKey, t("characters.editor.selectAvatarImage"))}
                >
                    <ImagePlus className="w-3.5 h-3.5" />
                </button>
                {/* The only way back. A single-select `AssetSelector` confirms on click and has no
                    footer, so the picker itself can never hand back "nothing". */}
                {override && (
                    <button
                        className={ICON_BTN}
                        onClick={props.onClearOverride}
                        {...writes(false, t("characters.editor.avatarClearOverride"))}
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {/* Only while the box is up. The scope is a property of the drag that is happening, not a
                standing setting, and it used to be a full-width bordered field that read as a text
                input and was labelled with a sentence containing "click to". */}
            {source === "baked" && props.cropping && props.onToggleScope && (
                // A `div` rather than a wrapping `label`: the shared `Switch` renders a `<button>`,
                // which is labelable, and a label around one can re-dispatch the click it just
                // received - a toggle that fires twice looks like a toggle that does nothing.
                <div className="flex items-center gap-2">
                    <Switch
                        size="sm"
                        checked={props.cropScoped}
                        onCheckedChange={props.onToggleScope}
                        disabled={props.frozen}
                        aria-label={t("characters.preview.portraitScoped")}
                        title={props.frozen ? props.freezeReason : undefined}
                    />
                    <FieldLabel as="span" className="mb-0">{t("characters.preview.portraitScoped")}</FieldLabel>
                </div>
            )}

            {props.receipt && (
                <div className="truncate text-2xs text-fg-subtle">{props.receipt}</div>
            )}
        </SectionCard>
    );
}
