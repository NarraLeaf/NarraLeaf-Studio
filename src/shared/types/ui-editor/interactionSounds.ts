import { AUDIO_TRACK_ID_SOUND } from "../audioTrack";
import type { UIElement } from "./document";

/**
 * The sounds an element plays when the player points at it and when they click it.
 *
 * Two props, `hoverSound` and `clickSound`, each a `{ assetId }` record. A record rather than a bare
 * id because of where library ids are found: the build, the shipped game's preloader, the reference
 * index and the shipped-content audit all walk an element's props for the property name `assetId`
 * (`@shared/build/uiAssetSlots`). A sound kept under that name is therefore resolved into the package,
 * warmed before its page is shown, counted as a use of its file and checked for a missing file,
 * without any of those readers being told that sounds exist - and an asset set picked here is
 * collapsed or answered by the build exactly as one in a picture slot is.
 *
 * Props rather than a field on the element (the way `animation` is) because a sound belongs to what
 * the widget is, not to where it was placed: a component's button sounds the same in every placement,
 * and a linked instance takes its sounds from the definition with the rest of its props.
 *
 * Comments in English per project convention.
 */

export type UIInteractionSoundKind = "hover" | "click";

/**
 * What one slot stores. Absent from props when the element has no sound for that gesture.
 *
 * The two options are the two an author reaches for on a `Play Sound` node: how loud this clip plays,
 * and which project audio track carries it. Both are absent at their defaults - full volume, the SFX
 * track - so a sound nobody tuned is stored as the file alone, and a default is never written down as
 * though somebody had chosen it.
 */
export type UIInteractionSound = {
    assetId: string;
    /** 0..1 as authored; absent means 1. Never pre-multiplied by a track's gain. */
    volume?: number;
    /** A project audio track id; absent means the SFX track. */
    audioTrackId?: string;
};

/** The two options on a slot. `null` puts an option back to its default. */
export type UIInteractionSoundOptions = {
    volume?: number | null;
    audioTrackId?: string | null;
};

/** The volume a slot plays at when it says nothing. */
export const UI_INTERACTION_SOUND_DEFAULT_VOLUME = 1;

/** The track a slot plays on when it names none: the seeded SFX track, which the player's sound volume reaches. */
export const UI_INTERACTION_SOUND_DEFAULT_TRACK_ID = AUDIO_TRACK_ID_SOUND;

/** The prop each gesture's sound is stored under. */
export const UI_INTERACTION_SOUND_PROP: Readonly<Record<UIInteractionSoundKind, string>> = Object.freeze({
    hover: "hoverSound",
    click: "clickSound",
});

export const UI_INTERACTION_SOUND_KINDS: readonly UIInteractionSoundKind[] = Object.freeze(["hover", "click"]);

/** The surface's own root: drawn under everything, it is never what a player points at. */
const ROOT_ELEMENT_TYPE = "nl.root";

/**
 * Whether an element of this type offers interaction sounds.
 *
 * Every type but the surface root. A sound plays where a click or a hover reaches, and both reach any
 * element - a text used as a link, a picture used as a button, a container used as a card - so
 * narrowing this to buttons would leave the same gesture with a sound on one widget and none on the
 * next, for no reason an author could see.
 */
export function uiElementTypeTakesInteractionSounds(elementType: string): boolean {
    return elementType !== ROOT_ELEMENT_TYPE;
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** A stored volume as the 0..1 it plays at, or undefined when it is missing, unreadable or the default. */
function normalizeVolume(value: unknown): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return undefined;
    }
    // Clamped rather than refused: a gain node takes 0..1 and nothing in the mixer amplifies, so 1 is
    // the loudest a clip can be - the same rule a story row's volume follows.
    const clamped = Math.min(1, Math.max(0, value));
    return clamped === UI_INTERACTION_SOUND_DEFAULT_VOLUME ? undefined : clamped;
}

function normalizeTrackId(value: unknown): string | undefined {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed && trimmed !== UI_INTERACTION_SOUND_DEFAULT_TRACK_ID ? trimmed : undefined;
}

/**
 * The sound stored for one gesture, with its options normalised, or null when there is none.
 *
 * A slot without a usable asset id is no sound at all, whatever options it carries: there is nothing
 * for them to apply to.
 */
export function readUIInteractionSound(
    element: Pick<UIElement, "props"> | null | undefined,
    kind: UIInteractionSoundKind,
): UIInteractionSound | null {
    const props = readRecord(element?.props);
    const slot = readRecord(props?.[UI_INTERACTION_SOUND_PROP[kind]]);
    const stored = slot?.assetId;
    const assetId = typeof stored === "string" ? stored.trim() : "";
    if (!assetId) {
        return null;
    }
    const volume = normalizeVolume(slot?.volume);
    const audioTrackId = normalizeTrackId(slot?.audioTrackId);
    return {
        assetId,
        ...(volume !== undefined ? { volume } : {}),
        ...(audioTrackId !== undefined ? { audioTrackId } : {}),
    };
}

/** The asset id stored for one gesture, trimmed, or null when there is none. */
export function readUIInteractionSoundAssetId(
    element: Pick<UIElement, "props"> | null | undefined,
    kind: UIInteractionSoundKind,
): string | null {
    return readUIInteractionSound(element, kind)?.assetId ?? null;
}

/** Whether the element plays a sound for either gesture. */
export function hasUIInteractionSounds(element: Pick<UIElement, "props"> | null | undefined): boolean {
    return UI_INTERACTION_SOUND_KINDS.some(kind => readUIInteractionSoundAssetId(element, kind) !== null);
}

/**
 * The props patch that sets one gesture's sound, or clears it.
 *
 * Picking another file keeps the volume and track the slot already had (`current`): an author swapping
 * a click for a softer one has not asked for it to jump back to full volume. Clearing writes
 * `undefined` rather than `null` so the key leaves the document on save, options and all: an element
 * that never had a sound and one whose sound was removed are then the same element.
 */
export function uiInteractionSoundPatch(
    kind: UIInteractionSoundKind,
    assetId: string | null,
    current?: UIInteractionSound | null,
): Record<string, UIInteractionSound | undefined> {
    const trimmed = assetId?.trim() ?? "";
    return { [UI_INTERACTION_SOUND_PROP[kind]]: trimmed ? { ...(current ?? {}), assetId: trimmed } : undefined };
}

/**
 * The props patch that changes one slot's options, or null when the slot has no sound to change.
 *
 * An option set back to its default leaves the record rather than being stored at the default value.
 */
export function uiInteractionSoundOptionsPatch(
    current: UIInteractionSound | null,
    kind: UIInteractionSoundKind,
    options: UIInteractionSoundOptions,
): Record<string, UIInteractionSound> | null {
    if (!current) {
        return null;
    }
    const volume = "volume" in options ? normalizeVolume(options.volume) : current.volume;
    const audioTrackId = "audioTrackId" in options ? normalizeTrackId(options.audioTrackId) : current.audioTrackId;
    return {
        [UI_INTERACTION_SOUND_PROP[kind]]: {
            assetId: current.assetId,
            ...(volume !== undefined ? { volume } : {}),
            ...(audioTrackId !== undefined ? { audioTrackId } : {}),
        },
    };
}
