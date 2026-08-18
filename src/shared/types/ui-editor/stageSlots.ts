import type { UIStageSlotId, UIStageSurfaceMount, UISurfaceOwnerKind } from "./document";

export const UI_STAGE_SLOT_IDS = ["onStage", "dialog", "notification", "choice", "nvl"] as const satisfies readonly UIStageSlotId[];

export const DEFAULT_UI_STAGE_SLOT_ID: UIStageSlotId = "onStage";

// What a slot is called, and what it is for, lives in the `uiEditor.stageSlot*` catalogue families -
// read them through `@/lib/ui-editor/stageSlotLabel`. This module holds identity only, so a slot
// name cannot be shown to an author without passing through the active locale.

export function isUIStageSlotId(value: unknown): value is UIStageSlotId {
    return typeof value === "string" && (UI_STAGE_SLOT_IDS as readonly string[]).includes(value);
}

export function normalizeUIStageSlotId(value: unknown): UIStageSlotId {
    if (value === "menu") {
        return "choice";
    }
    return isUIStageSlotId(value) ? value : DEFAULT_UI_STAGE_SLOT_ID;
}

/** Every feature that owns element-mounted surfaces. One list, so one panel can group them all. */
export const UI_SURFACE_OWNER_KINDS = ["stageAvatar"] as const satisfies readonly UISurfaceOwnerKind[];

export function isUISurfaceOwnerKind(value: unknown): value is UISurfaceOwnerKind {
    return typeof value === "string" && (UI_SURFACE_OWNER_KINDS as readonly string[]).includes(value);
}

/**
 * The slot a mount names, or null when it names none.
 *
 * Every caller that used to read `mount.slotId` goes through this: an element-mounted surface has no
 * slot, and answering `onStage` for it would put an avatar frame into the on-stage overlay.
 */
export function stageMountSlotId(mount: UIStageSurfaceMount | undefined): UIStageSlotId | null {
    if (!mount || isElementMount(mount)) {
        return null;
    }
    // Anything that is not explicitly an element mount is read as a slot, including a stored mount
    // written before the union existed and before `kind` was always present. The alternative — a
    // strict `kind === "slot"` — turns such a document into a Game UI whose slot nothing can find,
    // which is a blank dialogue box rather than an error anyone can act on.
    return normalizeUIStageSlotId((mount as { slotId?: unknown }).slotId);
}

export function isElementMount(mount: UIStageSurfaceMount | undefined): mount is Extract<UIStageSurfaceMount, { kind: "element" }> {
    return !!mount && mount.kind === "element";
}

/**
 * Read a stored mount back, tolerating everything written before the union existed.
 *
 * A document from before element mounts carries `{kind: "slot", slotId}` or, older still, a bare
 * object whose `kind` was implied. Anything unrecognised resolves to the default slot rather than
 * being dropped — a surface with no mount would be a surface nothing can draw.
 */
export function normalizeUIStageSurfaceMount(value: unknown): UIStageSurfaceMount {
    const raw = (value ?? {}) as { kind?: unknown; slotId?: unknown; owner?: unknown };
    if (raw.kind === "element" && isUISurfaceOwnerKind(raw.owner)) {
        return { kind: "element", owner: raw.owner };
    }
    return { kind: "slot", slotId: normalizeUIStageSlotId(raw.slotId) };
}
