# Workspace asset drag-and-drop (renderer)

This folder implements **cross-surface HTML5 drag-and-drop** for project **assets** inside the workspace shell (e.g. from the assets panel onto the editor or sidebar). It is **not** the same as in-panel moves (reorder / move into group inside `AssetsPanel`); those live under `modules/assets/state/useDragAndDrop.ts`.

## Architecture (short)

| Piece | Role |
|--------|------|
| **`WorkspaceAssetDragProvider`** | Holds a **live drag session** while the user drags from the assets panel (`session.assets`, `primaryId`, optional `sourcePanelId`). |
| **`useAssetDropTarget`** | Drop-target hook: detects our MIME type, builds `AssetDropContext`, calls your `onDrop`, optional `canDrop`. |
| **`useAssetDropFeedback`** | Shared Tailwind classes for hover highlight (`workspaceAssetDropTargetClass`). |
| **`types.ts`** | `WorkspaceAssetDragSession`, `AssetDropContext`, hook options. |

**Wire format** (payload on `DataTransfer`) is defined in:

`src/renderer/apps/workspace/modules/assets/dnd/assetDragContract.ts`

- MIME: `application/x-narraleaf-assets+json` (`ASSET_DRAG_MIME`)
- JSON shape: `AssetDragWirePayloadV1` (`v`, `p` primary id, `i[]` id+type, optional `s` source panel)

## Prerequisites

1. **`WorkspaceAssetDragProvider` must wrap** the workspace UI that contains both drag sources and drop targets (see `WorkSpaceApp.tsx`).

2. **Drag source** (assets panel) must:
   - `setData(ASSET_DRAG_MIME, encodeAssetDragPayload(...))` on `dragstart`
   - Call `beginSession(assets, primaryId, sourcePanelId)` and `endSession()` via `useWorkspaceAssetDragOptional()` (see `AssetsPanel` + `useDragAndDrop`)

3. **Drop targets** need **`useWorkspace()`** with an initialized workspace `context` so `AssetsService` can resolve ids to `Asset` objects.

## Why `WorkspaceAssetDragProvider` exists

In Chromium/Electron, **`dataTransfer.getData(customMime)` is often empty during `dragover` / `dragenter`**; it is reliably available on **`drop`**. During drag, `useAssetDropTarget` falls back to **`wireFromLiveSession()`** so `canDrop` and hover state still work. On `drop`, it prefers `getData(ASSET_DRAG_MIME)` and re-resolves assets from `AssetsService`.

## `useAssetDropTarget` API

```ts
import { useAssetDropTarget } from "@/apps/workspace/dnd/useAssetDropTarget";

const { dropTargetProps, isHovering, isAccepted, overlayClassName } = useAssetDropTarget({
  canDrop: (ctx) => boolean | undefined, // optional
  onDrop: (ctx) => void,                  // required
});
```

- **`dropTargetProps`**: spread onto a DOM element (`onDragEnter`, `onDragOver`, `onDragLeave`, `onDrop`).
- **`isHovering` / `isAccepted`**: useful if you want custom UI instead of `overlayClassName`.
- **`overlayClassName`**: when `isHovering && isAccepted`, applies ring/fill via `workspaceAssetDropTargetClass`.

### `AssetDropContext`

```ts
interface AssetDropContext {
  wire: AssetDragWirePayloadV1; // payload (primary id, all dragged ids)
  resolved: Asset[];          // current metadata from AssetsService (subset if deleted)
}
```

Use **`wire.p`** for the “primary” asset (the row the user grabbed). Use **`resolved`** for the full multi-selection (order follows wire `i`).

## Examples

### 1. Minimal drop zone (open previews — same pattern as editor)

```tsx
import { useAssetDropTarget } from "@/apps/workspace/dnd/useAssetDropTarget";
import { useWorkspace } from "@/apps/workspace/context";
import { openAssetPreviewTabsInEditor } from "@/apps/workspace/modules/assets/dnd/openDraggedAssetsInEditor";

function MyDropZone({ groupId }: { groupId: string }) {
  const { context } = useWorkspace();

  const { dropTargetProps, overlayClassName } = useAssetDropTarget({
    onDrop: ({ wire, resolved }) => {
      if (!context || resolved.length === 0) return;
      const primary = resolved.find((a) => a.id === wire.p) ?? resolved[0];
      // e.g. update selection + open tabs
      openAssetPreviewTabsInEditor(context, resolved, { groupId });
    },
  });

  return (
    <div {...dropTargetProps} className={`h-full relative ${overlayClassName}`}>
      Drop assets here
    </div>
  );
}
```

Reference implementation: `components/layout/MainEditorEmptyDropZone.tsx`, `components/layout/useEditorGroupAssetDrop.ts`.

### 2. Restrict drops with `canDrop` (e.g. images only)

```tsx
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";

const { dropTargetProps, overlayClassName } = useAssetDropTarget({
  canDrop: ({ resolved }) => resolved.every((a) => a.type === AssetType.Image),
  onDrop: ({ resolved }) => {
    // only images reach here
  },
});
```

### 3. Sidebar icon as drop target (activate panel + selection)

Pattern: on drop, call UI to show the target panel, then run asset logic. See `components/layout/SidebarPanelDropIcon.tsx`.

### 4. Optional provider (tests / Storybook)

Use **`useWorkspaceAssetDragOptional()`** in drag sources; it returns `null` outside the provider without throwing. Drop hook already uses this for the live session fallback.

## Related modules (outside this folder)

| Area | Path |
|------|------|
| Encode/decode payload, multi-select collection | `modules/assets/dnd/assetDragContract.ts` |
| Custom drag image for multi-asset drag | `modules/assets/dnd/multiAssetDragImage.ts` |
| Open previews / focus after drop | `modules/assets/dnd/openDraggedAssetsInEditor.tsx` |
| Panel-internal move (groups / root) | `modules/assets/state/useDragAndDrop.ts` |
| Global `-webkit-user-drag` override for rows | `styles.css` (`.nl-asset-drag-source`) |

## Behaviour summary for agents

- **Non-asset drags** (e.g. OS files with `Files` type only): `useAssetDropTarget` **ignores** them (`isWorkspaceAssetDragEvent` is false).
- **`dropEffect`**: the hook sets **`copy`** for accepted workspace drags (even when the user conceptually “moves” inside the panel; cross-surface drops here are treated as navigation/open, not file move).
- **Moving files on disk** is done via `AssetsService` in the assets panel DnD pipeline, not via this hook’s `onDrop` unless you explicitly call a service method in your handler.

When adding a new drop surface: wrap a node with `dropTargetProps`, merge `overlayClassName` (or equivalent), implement `onDrop` with `AssetsService` or existing helpers like `openAssetPreviewTabsInEditor`, and add `canDrop` if the surface only accepts a subset of asset types.
