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

/** What one slot stores. Absent from props when the element has no sound for that gesture. */
export type UIInteractionSound = {
    assetId: string;
};

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

/** The asset id stored for one gesture, trimmed, or null when there is none. */
export function readUIInteractionSoundAssetId(
    element: Pick<UIElement, "props"> | null | undefined,
    kind: UIInteractionSoundKind,
): string | null {
    const props = readRecord(element?.props);
    const slot = readRecord(props?.[UI_INTERACTION_SOUND_PROP[kind]]);
    const stored = slot?.assetId;
    const trimmed = typeof stored === "string" ? stored.trim() : "";
    return trimmed ? trimmed : null;
}

/** Whether the element plays a sound for either gesture. */
export function hasUIInteractionSounds(element: Pick<UIElement, "props"> | null | undefined): boolean {
    return UI_INTERACTION_SOUND_KINDS.some(kind => readUIInteractionSoundAssetId(element, kind) !== null);
}

/**
 * The props patch that sets one gesture's sound, or clears it.
 *
 * Clearing writes `undefined` rather than `null` so the key leaves the document on save: an element
 * that never had a sound and one whose sound was removed are then the same element.
 */
export function uiInteractionSoundPatch(
    kind: UIInteractionSoundKind,
    assetId: string | null,
): Record<string, UIInteractionSound | undefined> {
    const trimmed = assetId?.trim() ?? "";
    return { [UI_INTERACTION_SOUND_PROP[kind]]: trimmed ? { assetId: trimmed } : undefined };
}
