import type { HelpTopicId } from "./helpTopics";

/**
 * The popover's back stack, as a pure model.
 *
 * One visit to the popover is a trail of topics: it starts at whatever asked for help, grows when a
 * "See also" link is followed, and shrinks when the reader steps back. The popover has no list
 * beside it the way the browser does, so without this a followed link is a one-way door.
 *
 * Kept apart from the component because the three rules below are the whole feature and each of
 * them is a silent bug if it goes wrong: a trail that never resets makes an unrelated `F1` look
 * like a continuation, a `back` that pops the last entry empties a popover that is still open, and
 * a re-followed link that pushes a duplicate makes the arrow appear to do nothing.
 */

export interface HelpTrail {
  /** Oldest first; the last entry is what is on screen. Never empty. */
  readonly topics: readonly HelpTopicId[];
}

/** A fresh visit. Asking for help from outside is a new question, not a continuation. */
export function startTrail(topicId: HelpTopicId): HelpTrail {
  return { topics: [topicId] };
}

/** What the popover renders. */
export function currentTopic(trail: HelpTrail): HelpTopicId {
  return trail.topics[trail.topics.length - 1];
}

/** Where `back` would land, or undefined at the start of a visit (the arrow is hidden there). */
export function previousTopic(trail: HelpTrail): HelpTopicId | undefined {
  return trail.topics.length > 1 ? trail.topics[trail.topics.length - 2] : undefined;
}

/**
 * Follow a link. Re-opening the topic already on screen is not a step: the "See also" row of a
 * topic never lists itself, but a trail like A -> B -> A does, and pushing the duplicate would
 * leave the reader pressing back to arrive where they already are.
 */
export function pushTopic(trail: HelpTrail, topicId: HelpTopicId): HelpTrail {
  if (currentTopic(trail) === topicId) {
    return trail;
  }
  return { topics: [...trail.topics, topicId] };
}

/** Step back one topic. A no-op at the start of a visit, so the popover can never empty itself. */
export function popTopic(trail: HelpTrail): HelpTrail {
  return trail.topics.length > 1 ? { topics: trail.topics.slice(0, -1) } : trail;
}
