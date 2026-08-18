import { useEffect, useState } from "react";
import type { UpdateState } from "@shared/constants/update";
import { getInterface } from "./bridge";

/**
 * The updater's state, live.
 *
 * One snapshot when the surface mounts, then whatever main pushes. Nothing here polls and nothing
 * here computes: what a progress bar built on this shows is the downloader's own byte counts, so
 * a bar that is moving means bytes arrived. Three surfaces read it - the Settings panel, the
 * launcher's line beside the version number, and the workspace notification - and they cannot
 * disagree because there is only one source.
 *
 * Null until the first answer arrives, which callers render as "nothing to say" rather than as a
 * loading state: the common case is that there is no update and there never was anything to show.
 */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    let mounted = true;
    void getInterface()
      .app.update.getState()
      .then((result) => {
        if (mounted && result.success) {
          setState(result.data.state);
        }
      })
      .catch(() => undefined);
    const token = getInterface().app.update.onStateChanged((next) => {
      setState(next);
    });
    return () => {
      mounted = false;
      token?.cancel();
    };
  }, []);

  return state;
}
