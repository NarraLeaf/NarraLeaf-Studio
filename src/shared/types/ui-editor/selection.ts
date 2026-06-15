import type { UIElementId, UISurfaceId } from "./document";

export type UIElementSelection = {
    editor: "ui";
    surfaceId: UISurfaceId;
    elementIds: UIElementId[];
    primaryId?: UIElementId;
};
