import type { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { Asset } from "@/lib/workspace/services/assets/types";

/**
 * Tab id prefix for the built-in text editor.
 *
 * Its own module because three places need it and only one of them may import the tab component:
 * the open path, the session serializer (which reads the id back to rebuild the tab) and the
 * component itself. Importing the component from the session module is what would drag Monaco -
 * and its megabyte of grammar - into the workspace's startup path whether or not a text tab is ever
 * opened.
 */
export const TEXT_EDITOR_TAB_PREFIX = "narraleaf-studio:assets:text-editor-";

export function getTextEditorTabId(assetId: string): string {
  return `${TEXT_EDITOR_TAB_PREFIX}${assetId}`;
}

export interface TextEditorTabPayload {
  asset: Asset<AssetType.Other>;
}
