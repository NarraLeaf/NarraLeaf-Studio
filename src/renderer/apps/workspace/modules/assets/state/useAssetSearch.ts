import { useCallback, useEffect, useState } from "react";
import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";

/**
 * Search text, debounced into the shape the filter pass consumes.
 *
 * Searching used to open a popup listing hits over the tree. The tree underneath kept showing the
 * library unfiltered, with every group collapsed by default — so dismissing the popup dismissed the
 * result, and an asset filed two groups down was findable only through an overlay. The query is now
 * a filter like any other: it narrows what the views draw, and the views open themselves around
 * what survives. This hook is what remains of the old one: the text, and the predicate that decides
 * what the text matches.
 */
export function useAssetSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");

  // Debounced so a filter pass over the whole library does not run per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setActiveQuery(searchQuery.trim().toLowerCase()), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSearchQueryChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  return {
    searchQuery,
    /** Trimmed and lower-cased; empty when nothing is being searched for. */
    activeQuery,
    setSearchQuery: handleSearchQueryChange
  };
}

/**
 * `groupId -> its own name plus every ancestor's, lower-cased`.
 *
 * A hit on a group name has to carry its contents: someone searching `UI` means the folder, and a
 * result set that showed the folder but none of the twelve things in it would be a worse answer
 * than the popup this replaced.
 */
export function buildGroupSearchPaths(groups: readonly AssetGroup[]): Map<string, string> {
  const byId = new Map<string, AssetGroup>();
  groups.forEach((group) => byId.set(group.id, group));

  const paths = new Map<string, string>();
  const resolve = (group: AssetGroup, seen: Set<string>): string => {
    const cached = paths.get(group.id);
    if (cached !== undefined) {
      return cached;
    }
    // A parent chain is written by the editor and should never cycle; guard anyway, because the
    // one thing a browser must not do to a hand-edited project file is hang on it.
    seen.add(group.id);
    const parent = group.parentGroupId ? byId.get(group.parentGroupId) : undefined;
    const prefix = parent && !seen.has(parent.id) ? `${resolve(parent, seen)} ` : "";
    const path = `${prefix}${group.name}`.toLowerCase();
    paths.set(group.id, path);
    return path;
  };

  groups.forEach((group) => resolve(group, new Set()));
  return paths;
}

/** Name, tag, description, or the name of any group it is filed under. `query` is already lower-cased. */
export function assetMatchesQuery(
  asset: Asset,
  query: string,
  groupPaths: ReadonlyMap<string, string>
): boolean {
  if (!query) {
    return true;
  }
  if (asset.name.toLowerCase().includes(query)) {
    return true;
  }
  if (asset.tags.some((tag) => tag.toLowerCase().includes(query))) {
    return true;
  }
  if (asset.description.toLowerCase().includes(query)) {
    return true;
  }
  return !!asset.groupId && (groupPaths.get(asset.groupId)?.includes(query) ?? false);
}

export type AssetsByType = Record<AssetType, Asset[]>;
export type GroupsByType = Record<AssetType, AssetGroup[]>;
