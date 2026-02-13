import type { UIStageSlotId, UIStageSurfaceMount, UISurfaceKind } from "@shared/types/ui-editor/document";

export type SurfaceKindOption = {
    kind: UISurfaceKind;
    label: string;
    description: string;
    host: "app" | "player";
};

export const SURFACE_KIND_OPTIONS: SurfaceKindOption[] = [
    {
        kind: "appSurface",
        label: "App",
        description: "App surfaces represent application-level UI such as start screens or settings.",
        host: "app",
    },
    {
        kind: "stageSurface",
        label: "Stage",
        description: "Stage surfaces run inside the player and can mount as slots, persistent overlays, or layers.",
        host: "player",
    },
];

export const STAGE_MOUNT_OPTIONS: { kind: UIStageSurfaceMount["kind"]; label: string; description: string }[] = [
    {
        kind: "persistent",
        label: "On Stage",
        description: "Always-mounted stage UI such as quick menus.",
    },
    {
        kind: "slot",
        label: "Slot",
        description: "Mount inside a stage slot (dialog, notification, etc.).",
    },
    {
        kind: "layer",
        label: "Layer",
        description: "Page-like layers such as settings or save screens.",
    },
];

export const STAGE_SLOT_OPTIONS: { value: UIStageSlotId; label: string; description: string }[] = [
    {
        value: "dialog",
        label: "Dialog",
        description: "Game Dialog",
    },
    {
        value: "menu",
        label: "Menu",
        description: "Game Menu Choice",
    },
    {
        value: "notification",
        label: "Notification",
        description: "App Notification",
    },
    {
        value: "none",
        label: "None",
        description: "No slot-specific behavior.",
    },
];

export const STAGE_SLOT_LABELS: Record<UIStageSlotId, string> = {
    dialog: "Dialog",
    menu: "Menu",
    notification: "Notification",
    none: "None",
};

export const DEFAULT_STAGE_SLOT_ID: UIStageSlotId = "dialog";

export const formatStageMountLabel = (mount: UIStageSurfaceMount): string => {
    if (mount.kind === "slot") {
        return `Slot · ${STAGE_SLOT_LABELS[mount.slotId] ?? mount.slotId}`;
    }
    return mount.kind === "persistent" ? "Persistent" : "Layer";
};
