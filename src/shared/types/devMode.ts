import type { BlueprintDocument, SharedBlueprintAsset } from "./blueprint/document";
import type { UIDocument } from "./ui-editor/document";
import type { UIGraphDocument } from "./ui-editor/graph";
import type { UISurfaceId } from "./ui-editor/document";
import type { StoryDocument } from "./story";

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
        /** UI graph document; instance blueprints live in {@link UIGraphDocument.blueprintDocument} and are mirrored in `localBlueprints`. */
        uigraphs: UIGraphDocument;
        /** Instance {@link BlueprintDocument} (same object as `uigraphs.blueprintDocument`); explicit for Dev Mode consumers. */
        localBlueprints: BlueprintDocument;
        /** Shared blueprint assets loaded from project asset metadata + content files. */
        sharedBlueprints: SharedBlueprintAsset[];
    };
    story?: StoryDocument;
    scripts?: Record<string, unknown>;
    compiled?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    /**
     * Blueprint M5: IIFE bundle JS per TypeScript blueprint id (local + shared), executed in Dev Mode before runtime.
     */
    blueprintCompiledScripts?: Record<string, string>;
    /** When present and false, blueprint script compilation failed (strict block). */
    blueprintScriptsCompileOk?: boolean;
    blueprintScriptsCompileErrors?: string[];
};
