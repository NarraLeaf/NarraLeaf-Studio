import type { UIDocument } from "./ui-editor/document";
import type { UIGraphDocument } from "./ui-editor/graph";
import type { UISurfaceId } from "./ui-editor/document";

export type DevModeEntry =
    | {
          kind: "surface";
          surfaceId: UISurfaceId;
      }
    | {
          kind: "story";
          scriptId?: string;
          filePath?: string;
          line: number;
          checkpointId?: string;
      }
    | {
          kind: "extension";
          extensionId: string;
          payload?: Record<string, unknown>;
      };

export type DevModeStatus =
    | "idle"
    | "starting"
    | "compiling"
    | "running"
    | "reloading"
    | "error"
    | "stopping";

export type DevModeBundle = {
    bundleId: string;
    revision: number;
    timestamp: string;
    ui: {
        uidoc: UIDocument;
        uigraphs: UIGraphDocument;
    };
    scripts?: Record<string, unknown>;
    compiled?: Record<string, unknown>;
    meta?: Record<string, unknown>;
};
