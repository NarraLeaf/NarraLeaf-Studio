import { useEffect, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { MediaSupportService } from "@/lib/workspace/services/media/MediaSupportService";
import type { MediaAssetSupportRecord } from "@/lib/workspace/services/media/mediaAssetSupport";

/**
 * Which assets in the browser will not play, kept current while the panel is open.
 *
 * Keyed by asset **id** and replaced whole whenever the answers change, which is the only shape
 * that works here: `AssetsService` edits asset records in place, so an `Asset` reference lives for
 * the life of the window and anything memoized on its identity never recomputes. A map that is
 * swapped for a new one is what makes a row re-render at all.
 *
 * The scan is driven off the library's own change events rather than off a React dependency, for
 * the same reason: an in-place edit to a record moves its `hash` without moving any array identity
 * React could have noticed.
 */

/** Long enough that a fifty-file import is one scan, short enough to feel immediate. */
const RESCAN_DEBOUNCE_MS = 300;

export function useMediaAssetSupport(): ReadonlyMap<string, MediaAssetSupportRecord> {
  const { context } = useWorkspace();
  const [records, setRecords] = useState<ReadonlyMap<string, MediaAssetSupportRecord>>(
    () => new Map()
  );

  useEffect(() => {
    if (!context) {
      return;
    }
    let media: MediaSupportService;
    let assets: AssetsService;
    try {
      media = context.services.get<MediaSupportService>(Services.MediaSupport);
      assets = context.services.get<AssetsService>(Services.Assets);
    } catch {
      // A workspace that came up without these (recovery mode) simply shows no marks.
      return;
    }

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const publish = () => {
      if (alive) {
        setRecords(media.getLastScan().records);
      }
    };
    const rescan = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        void media.scan();
      }, RESCAN_DEBOUNCE_MS);
    };

    publish();
    const offChanged = media.onChanged(publish);
    const offUpdated = assets.getEvents().on("updated", rescan);
    const offDeleted = assets.getEvents().on("deleted", rescan);
    void media.scan();

    return () => {
      alive = false;
      if (timer) {
        clearTimeout(timer);
      }
      offChanged();
      offUpdated();
      offDeleted();
    };
  }, [context]);

  return records;
}
