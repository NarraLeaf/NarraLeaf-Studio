/**
 * User-facing labels for blueprint owner kinds.
 * Simplifies the internal globalMain/surfaceMain/widgetMain/sharedAsset taxonomy
 * into terms that intermediate creators can understand.
 */

import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";

export type OwnerLabelSet = {
    /** Short noun: "App Logic", "Page Logic", "Component Logic" */
    label: string;
    /** Prefix for the blueprint editor tab title */
    titlePrefix: string;
    /** Informal description for tooltips / empty states */
    description: string;
};

const LABELS: Record<BlueprintOwnerRef["kind"], OwnerLabelSet> = {
    globalMain: {
        label: "App Logic",
        titlePrefix: "App Logic",
        description: "App-wide logic.",
    },
    surfaceMain: {
        label: "Page Logic",
        titlePrefix: "Page Logic",
        description: "Logic for this page.",
    },
    widgetMain: {
        label: "Component Logic",
        titlePrefix: "Component Logic",
        description: "Logic for this control.",
    },
    widgetValue: {
        label: "Component Value",
        titlePrefix: "Component Value",
        description: "Logic for this control value.",
    },
    sharedAsset: {
        label: "Shared Blueprint",
        titlePrefix: "Shared",
        description: "Shared asset.",
    },
};

export function getOwnerLabel(kind: BlueprintOwnerRef["kind"]): OwnerLabelSet {
    return LABELS[kind];
}

export function getOwnerLabelString(kind: BlueprintOwnerRef["kind"]): string {
    return LABELS[kind].label;
}

/** User-facing scope labels for state binding. */
export const STATE_SCOPE_LABELS = {
    surface: "Page data",
    global: "App data",
    persistence: "Saved data",
} as const;
