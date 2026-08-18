/**
 * React wrapper around {@link AutoSaveScheduler}: owns the interval timer and
 * the story play-head subscription, and hands back the two operations the
 * blueprint host API exposes (`Auto Save` writes now, the ring is listed by
 * `List Auto Saves`).
 *
 * The scheduler instance is created once per mount. Its dependencies are read
 * through refs so a re-render never rebuilds it - rebuilding would reset both
 * the rotation cursor and the "story advanced" flag, and the ring would start
 * clobbering slot 0 on every render.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AutoSaveConfiguration, AutoSaveEntry } from "@shared/types/saves";
import { AutoSaveScheduler, type AutoSaveLogLevel } from "./autoSaveScheduler";

export type UseAutoSaveOptions = {
  config: AutoSaveConfiguration;
  /** True while a playthrough is running and can be serialized. */
  isPlaying: () => boolean;
  /** Write one autosave into the given reserved id. */
  write: (id: string) => Promise<void>;
  /** Every reserved autosave currently stored, in any order. */
  listStored: () => Promise<AutoSaveEntry[]>;
  /** Story play head; every call marks the playthrough as worth re-saving. */
  subscribeStoryAdvanced: (listener: () => void) => () => void;
  log: (level: AutoSaveLogLevel, message: string) => void;
};

export type AutoSaveRuntime = {
  /** `Auto Save` node: write into the ring now, regardless of the timer. */
  writeNow: () => Promise<void>;
};

export function useAutoSave(options: UseAutoSaveOptions): AutoSaveRuntime {
  const latest = useRef(options);
  latest.current = options;

  const scheduler = useMemo(
    () =>
      new AutoSaveScheduler({
        getConfig: () => latest.current.config,
        isPlaying: () => latest.current.isPlaying(),
        write: (id) => latest.current.write(id),
        listStored: () => latest.current.listStored(),
        log: (level, message) => latest.current.log(level, message)
      }),
    []
  );

  useEffect(() => () => scheduler.dispose(), [scheduler]);

  // Every action the story plays makes the current state worth re-saving. The
  // subscription runs whether or not autosaving is enabled: the `Auto Save`
  // node works either way, and the flag is a boolean assignment.
  useEffect(
    () => latest.current.subscribeStoryAdvanced(() => scheduler.markStoryAdvanced()),
    [scheduler, options.subscribeStoryAdvanced]
  );

  // Rebuilt only when the cadence itself changes; toggling `enabled` is
  // handled inside the tick so the timer does not churn.
  const intervalMs = Math.max(1, options.config.intervalSeconds) * 1000;
  useEffect(() => {
    const timer = setInterval(() => void scheduler.tick(), intervalMs);
    return () => clearInterval(timer);
  }, [scheduler, intervalMs]);

  const writeNow = useCallback(() => scheduler.writeNow(), [scheduler]);

  return useMemo(() => ({ writeNow }), [writeNow]);
}
