import type { StudioStateStoreNamespace } from "@shared/vcs/serviceStores";
import type { VcsMergeSideChoice, VcsMergeState } from "@shared/types/vcs";
import type { MergeChangeChoices } from "@/lib/vcs/mergeDecisionView";
import type { ServiceAssetsService } from "@/lib/workspace/services/core/ServiceAssetsService";

/**
 * The choices an author has made in an open merge, kept where closing the window cannot take them.
 *
 * **Not repository state, and the panel still says so.** Nothing is applied until Finish is pressed:
 * the two side verbs overwrite the working tree the moment they are called, so applying each click
 * would rewrite the author's files a file at a time and leave a half-settled merge nothing could
 * read back. That design is unchanged. What changed is only where the unapplied form lives - a
 * window closed forty files into a two-hundred-file merge used to start again from nothing, and the
 * panel's own copy said as much out loud.
 *
 * `.nlstudio/services/` rather than `editor/services/` for two independent reasons, both hard: the
 * merge freezes writes to versioned project data, so the versioned directory is not writable at the
 * one moment this is needed; and losing this costs the author the choosing again - time, never work
 * - which is the test `docs/caches.md` sets for what may live outside version control.
 */

const NAMESPACE: StudioStateStoreNamespace = "merge_decisions";

/** Bumped when the shape below changes. A draft from another version is discarded, never migrated. */
const VERSION = 1;

export interface MergeDecisionDraft {
  version: number;
  /**
   * Which merge these choices belong to.
   *
   * A draft that outlived its merge is worse than no draft: it would pre-select sides in a merge
   * the author has not looked at, which is the single most consequential thing this panel can get
   * wrong. So the draft is only ever restored onto a merge that {@link mergeFingerprint} still
   * matches, and dropped otherwise.
   */
  fingerprint: string;
  decisions: Record<string, VcsMergeSideChoice>;
  perChange: Record<string, true>;
  changeChoices: Record<string, MergeChangeChoices>;
}

/**
 * What identifies one merge.
 *
 * The incoming revision plus the exact set of conflicted paths. Neither alone is enough: `incoming`
 * is absent on merges the backend did not name one for, and two merges of the same branch pair
 * genuinely can conflict on different files. The list is already ordered by path
 * (`VcsMergeState.conflicts`), so the same merge always fingerprints the same way.
 *
 * Joined on a newline written as an escape, and that is not fussiness: a separator typed as a
 * literal character is one an editor can replace with something else on the way to disk, which
 * happened here - the first version of this line reached the file with NUL bytes in place of its
 * spaces. It worked, and it was unreadable.
 */
export function mergeFingerprint(state: VcsMergeState): string {
  return [state.incoming ?? "", ...state.conflicts].join("\n");
}

/**
 * The draft for this merge, or null when there is none for it.
 *
 * Every failure answers null. A store that cannot be read is a form nobody filled in, which is
 * exactly what the panel does without one - so there is nothing to report to the author and nothing
 * they could do about it.
 */
export async function readMergeDecisionDraft(
  serviceAssets: ServiceAssetsService,
  fingerprint: string
): Promise<MergeDecisionDraft | null> {
  const store = await serviceAssets.readStore<MergeDecisionDraft>(NAMESPACE);
  if (!store.ok || !store.data) {
    return null;
  }
  const draft = store.data;
  if (draft.version !== VERSION || draft.fingerprint !== fingerprint) {
    return null;
  }
  // Shape-checked rather than trusted: this file is on the author's disk and a hand-edited or
  // truncated one must not reach `completeMerge`, which takes sides on their behalf.
  if (!isRecord(draft.decisions) || !isRecord(draft.perChange) || !isRecord(draft.changeChoices)) {
    return null;
  }
  return draft;
}

/** Store the choices as they stand. One store per project, because a project has one open merge. */
export async function writeMergeDecisionDraft(
  serviceAssets: ServiceAssetsService,
  draft: Omit<MergeDecisionDraft, "version">
): Promise<void> {
  await serviceAssets.writeStore<MergeDecisionDraft>(NAMESPACE, { version: VERSION, ...draft });
}

/**
 * Forget the draft, for a merge that is over.
 *
 * Written empty rather than deleted: `ServiceAssetsService` has no store delete, and the file is a
 * few bytes in a directory that is never versioned or packaged.
 *
 * Correctness does not rest on the empty fingerprint being unmatchable - a merge with no incoming
 * revision and nothing in conflict fingerprints the same way. It rests on there being no choices in
 * it, so restoring one is a no-op either way.
 */
export async function clearMergeDecisionDraft(serviceAssets: ServiceAssetsService): Promise<void> {
  await writeMergeDecisionDraft(serviceAssets, {
    fingerprint: "",
    decisions: {},
    perChange: {},
    changeChoices: {}
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
