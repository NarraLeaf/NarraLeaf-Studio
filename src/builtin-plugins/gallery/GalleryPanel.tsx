/**
 * The Gallery side panel: a compact companion to the editor tab.
 *
 * Its job is not authoring - the tab does that. It is the reference you keep
 * open *beside the blueprint editor*, where the question is "what is this
 * artwork called, and is it the one my node points at". So it shows names and
 * covers, filters by name, and gets out of the way.
 */

import { useEffect, useMemo, useState } from "react";
import { Images, Maximize2, Plus } from "lucide-react";
import { ui, type PluginApp } from "narraleaf-studio/plugin";
import { resolveCoverVariant, type GalleryEntryKind } from "./catalog";

const PANEL_KIND_LABEL: Record<GalleryEntryKind, string> = {
  cg: "CG",
  scene: "Recollection",
  music: "Music",
  voice: "Voice"
};
import { GalleryThumb } from "./components";
import type { GalleryStore } from "./store";

export function GalleryPanel({
  app,
  store,
  onOpenEditor
}: {
  app: PluginApp;
  store: GalleryStore;
  onOpenEditor: () => void;
}) {
  const [data, setData] = useState(() => store.getData());
  const [query, setQuery] = useState("");

  useEffect(() => store.subscribe(() => setData({ ...store.getData() })), [store]);

  const groupNames = useMemo(
    () => new Map(data.groups.map((group) => [group.id, group.name] as const)),
    [data.groups]
  );

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return data.items;
    }
    return data.items.filter(
      (artwork) =>
        artwork.name.toLowerCase().includes(needle) ||
        artwork.variants.some((variant) => variant.name.toLowerCase().includes(needle))
    );
  }, [data.items, query]);

  return (
    <ui.Panel.Root>
      <ui.Panel.Header
        title="Gallery"
        description={`${data.items.length} ${data.items.length === 1 ? "entry" : "entries"}`}
        actions={
          <ui.IconButton
            size="sm"
            variant="ghost"
            aria-label="Open gallery editor"
            title="Open gallery editor"
            onClick={onOpenEditor}
          >
            <Maximize2 size={13} />
          </ui.IconButton>
        }
      />
      <ui.Panel.Toolbar>
        <ui.SearchInput
          size="sm"
          fullWidth
          placeholder="Search gallery..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </ui.Panel.Toolbar>
      <ui.Panel.Section className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <ui.Panel.EmptyState
            icon={<Images size={22} />}
            title={data.items.length === 0 ? "Nothing yet" : "No matches"}
            description={
              data.items.length === 0
                ? "Open the editor to add CGs, recollections, music or voice."
                : "Try another search."
            }
            actions={
              data.items.length === 0 ? (
                <ui.Button size="sm" variant="secondary" onClick={onOpenEditor}>
                  <Plus size={13} />
                  Open editor
                </ui.Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-1">
            {items.map((artwork) => {
              const cover = resolveCoverVariant(artwork);
              const groupName = artwork.groupId ? groupNames.get(artwork.groupId) : undefined;
              return (
                <button
                  key={artwork.id}
                  type="button"
                  className="flex w-full min-w-0 items-center gap-2 rounded border border-edge p-1 text-left hover:border-edge-strong hover:bg-fill-subtle"
                  onClick={onOpenEditor}
                >
                  <GalleryThumb
                    app={app}
                    assetId={cover?.imageAssetId}
                    className="h-9 w-14 shrink-0 rounded"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-2xs">{artwork.name}</span>
                    {/* Kind first: this list spans all four
                                            columns, and a track and a CG are
                                            otherwise indistinguishable here. */}
                    <span className="block truncate text-2xs text-fg-subtle">
                      {PANEL_KIND_LABEL[artwork.kind]}
                      {groupName ? ` · ${groupName}` : ""}
                      {artwork.variants.length > 1 ? ` · ${artwork.variants.length} items` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </ui.Panel.Section>
    </ui.Panel.Root>
  );
}
