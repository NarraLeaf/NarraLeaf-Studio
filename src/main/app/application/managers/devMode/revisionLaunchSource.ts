import type { RevisionId } from "@shared/types/vcs";
import { getWorkspaceFreezeState } from "../../utils/workspaceFreeze";
import type { RevisionSnapshotResult } from "../vcs/revisionSnapshot";

/**
 * Which directory a Dev Mode launch compiles from.
 *
 * The working tree normally. A snapshot of one revision while the workspace is showing that revision,
 * because the project owner's decision for a frozen workspace is that **Dev Mode runs the focused
 * version** while Preview and the production build are refused.
 *
 * A **manual** freeze keeps the working tree, and that is not an omission: nothing has replaced what
 * is on disk during a manual freeze, so the working tree IS what the author is looking at. The two
 * refusals in `utils/workspaceFreeze.ts` treat both kinds alike because they are about consistency;
 * this one has to tell them apart because only one of them changes what "the project" means.
 */
export interface DevModeLaunchSource {
  /** The directory the compile path reads. */
  directory: string;
  /** The revision {@link directory} is a snapshot of, when it is one. */
  revision?: RevisionId;
}

/**
 * What the author is told when the revision cannot be read.
 *
 * Written for a person: it reaches them through the workspace console, which is the only explanation
 * they get. It says explicitly that nothing ran, because the alternative implementation - falling back
 * to the working tree - is the failure this milestone exists to prevent, and an author who has seen
 * other tools do that will assume it happened here.
 */
export function devModeRevisionRefusalMessage(
  revision: RevisionId | undefined,
  detail: string
): string {
  const named = revision ? `version ${revision.slice(0, 12)}` : "the version you are looking at";
  return (
    `Dev Mode could not run ${named}: ${detail} Nothing was run. While you are looking at an ` +
    `older version, Dev Mode will not silently run your current files instead. Leave the version ` +
    `you are looking at to run those.`
  );
}

/**
 * Decide where this launch compiles from, materialising the revision if that is what is on screen.
 *
 * Resolved **once per launch**, and deliberately not re-checked afterwards. The author pressed Run
 * while looking at a particular version; if they leave it while the launch is still in flight, the
 * launch they asked for is the one that finishes. A reload of that session recompiles the same
 * snapshot for the same reason - to run something else, launch again.
 *
 * Throws rather than degrading. Every failure here (no repository, a revision that is gone, a host
 * with no Lore build at all) ends the launch, because the only other answer available is to run the
 * working tree and call it the revision.
 */
export async function resolveDevModeLaunchSource(options: {
  projectPath: string;
  materialize: (revision: RevisionId) => Promise<RevisionSnapshotResult>;
}): Promise<DevModeLaunchSource> {
  const frozen = getWorkspaceFreezeState(options.projectPath);
  if (!frozen || frozen.kind !== "revision") {
    return { directory: options.projectPath };
  }
  if (!frozen.revision) {
    // The workspace says it is showing a revision and did not say which. Refusing is the only safe
    // answer: the report crosses IPC, so this is reachable from a renderer older than the field, and
    // guessing "probably the tip" would run the current game under a past version's name.
    throw new Error(
      devModeRevisionRefusalMessage(
        undefined,
        "the workspace did not say which version it is showing."
      )
    );
  }
  try {
    const snapshot = await options.materialize(frozen.revision);
    return { directory: snapshot.directory, revision: frozen.revision };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(devModeRevisionRefusalMessage(frozen.revision, `${detail}.`));
  }
}
