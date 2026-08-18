import type { StoryAnimationAsset, StoryAnimationTimeline } from "@shared/types/story";
import { formatStorySecondsLabel } from "@shared/utils/storyTime";
import type { UseTranslation } from "@/lib/i18n";
import { getStoryMotionDurationMs } from "./storyMotionTimeline";

/**
 * How a motion reads in one line: how long it runs, and what it moves.
 *
 * Its own module because the preset gallery needs it for a bare timeline while every asset surface
 * needs it for an asset — two callers that must not describe the same motion two different ways.
 */
export function storyMotionTimelineSummary(
  timeline: StoryAnimationTimeline | undefined,
  t: UseTranslation["t"]
): string {
  const duration = formatStorySecondsLabel(getStoryMotionDurationMs(timeline));
  const tracks = timeline?.tracks ?? [];
  const labels = tracks
    .slice(0, 3)
    .map((track) => t(`motion.propertyLabel.${track.property}`))
    .join(", ");
  return `${duration}${labels ? ` / ${labels}${tracks.length > 3 ? "..." : ""}` : ""}`;
}

export function motionSummary(asset: StoryAnimationAsset, t: UseTranslation["t"]): string {
  return storyMotionTimelineSummary(asset.timeline, t);
}
