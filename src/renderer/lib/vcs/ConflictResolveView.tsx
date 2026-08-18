import { useState } from "react";
import { GitMerge, Loader2 } from "lucide-react";
import type { DocumentMergeDecision } from "@shared/documents/diff";
import type { VcsMergeSideChoice } from "@shared/types/vcs";
import { useTranslation } from "@/lib/i18n";
import { EmptyState } from "@/lib/components/elements";
import { ConflictDetail } from "./ConflictDetail";
import { ConflictIndexPane } from "./ConflictIndexPane";
import { IndexDivider } from "./IndexDivider";
import type { FrozenControlProps } from "@/apps/workspace/components/ui/freezeGuard";
import {
  countUndecidedFiles,
  type ConflictRowView,
  type MergeChangeChoices,
  type MergeDocumentEntry
} from "./mergeDecisionView";

/**
 * Finishing a merge, as an index of conflicted files and one file's decisions beside it.
 *
 * The same two panes a comparison is drawn in, and for the same reason: this is that list with a
 * side to take per row. What was here before nested a two-column grid of values inside an expanded
 * row inside a scrolling list, so the values - the only thing an author is actually choosing
 * between - were the narrowest thing on screen.
 *
 * **Nothing here writes anything.** Every control records a choice in the panel above it; the merge
 * is applied by one press on {@link ConflictFooter}, as one operation in the main process. A window
 * closed before that press leaves the merge exactly as the sync left it.
 */

/**
 * The part of the workspace's freeze guard this needs, spelled structurally.
 *
 * A `FreezeGuard` satisfies it, and a test does not have to build one - which is what keeps this
 * whole surface renderable without a workspace behind it.
 */
export interface WriteGuard {
  writes(ownDisabled?: boolean, ownTooltip?: string): FrozenControlProps;
}

export interface ConflictResolveViewProps {
  /** The conflicts this draws, already capped by the panel. One row each, whatever is inside. */
  readonly rows: readonly ConflictRowView[];
  /** Conflicts in the merge, including any past the cap. What the count line reports. */
  readonly conflictCount: number;
  readonly omitted: number;
  readonly selectedPath: string | null;
  onSelect(path: string): void;
  readonly documents: Readonly<Record<string, MergeDocumentEntry>>;
  readonly changeChoices: Readonly<Record<string, MergeChangeChoices>>;
  /** True while a finish or an abandon is out. */
  readonly running: boolean;
  readonly guard: WriteGuard;
  onChooseWhole(path: string, side: VcsMergeSideChoice): void;
  onChooseMerged(path: string): void;
  onChooseChange(path: string, decision: DocumentMergeDecision, side: VcsMergeSideChoice): void;
  onChooseAll(side: VcsMergeSideChoice): void;
}

/** How wide the conflict index starts. Wider than a comparison's: every row carries its decision. */
const RESOLVE_INDEX_WIDTH = 340;

export function ConflictResolveView({
  rows,
  conflictCount,
  omitted,
  selectedPath,
  onSelect,
  documents,
  changeChoices,
  running,
  guard,
  onChooseWhole,
  onChooseMerged,
  onChooseChange,
  onChooseAll
}: ConflictResolveViewProps) {
  const { t, tn } = useTranslation();
  const [indexWidth, setIndexWidth] = useState(RESOLVE_INDEX_WIDTH);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-edge px-3 py-2">
        <p className="text-xs text-fg">{tn("documentDiff.resolve.count", conflictCount)}</p>
        {/* Two links rather than buttons, and they SELECT rather than apply - which is what
                    makes offering them at all defensible next to a deliberately unselected
                    default. */}
        <button
          type="button"
          {...guard.writes(running)}
          onClick={() => onChooseAll("mine")}
          className="text-2xs text-fg-subtle transition-colors cursor-default hover:text-fg disabled:opacity-50"
        >
          {t("documentDiff.resolve.takeAllMine")}
        </button>
        <button
          type="button"
          {...guard.writes(running)}
          onClick={() => onChooseAll("theirs")}
          className="text-2xs text-fg-subtle transition-colors cursor-default hover:text-fg disabled:opacity-50"
        >
          {t("documentDiff.resolve.takeAllTheirs")}
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <ConflictIndexPane
          rows={rows}
          omitted={omitted}
          selectedPath={selectedPath}
          onSelect={onSelect}
          disabled={running}
          onChooseWhole={onChooseWhole}
          onChooseMerged={onChooseMerged}
          style={{ width: `${indexWidth}px` }}
          className="shrink-0 border-r border-edge"
        />

        <IndexDivider
          width={indexWidth}
          onWidth={setIndexWidth}
          defaultWidth={RESOLVE_INDEX_WIDTH}
        />

        <div className="min-h-0 min-w-0 flex-1">
          {selectedPath !== null ? (
            <ConflictDetail
              // Keyed on the path, so switching files mounts a new detail rather
              // than re-dressing the old one with another file's values.
              key={selectedPath}
              path={selectedPath}
              entry={documents[selectedPath]}
              choices={changeChoices[selectedPath] ?? {}}
              disabled={running}
              onChooseChange={(decision, side) => onChooseChange(selectedPath, decision, side)}
            />
          ) : (
            <EmptyState size="sm" description={t("documentDiff.resolve.selectPrompt")} />
          )}
        </div>
      </div>
    </div>
  );
}

export interface ConflictFooterProps {
  /** Every conflict in the merge, not the capped list: an unanswered file off the end still counts. */
  readonly rows: readonly ConflictRowView[];
  readonly running: "finish" | "abandon" | null;
  readonly guard: WriteGuard;
  onFinish(): void;
  onAbandon(): void;
}

/**
 * The one press that writes, and the sentence that has to sit above it.
 *
 * Rendered whether or not there are conflicts: a merge whose automerge settled everything has
 * nothing to decide and still needs the commit that closes it.
 *
 * **Finishing is refused while anything is undecided**, and the count comes from the same rows the
 * index draws its markers from, so the button and the list can never disagree about whether the
 * merge can be closed. The guard is consulted here and not on the choices, because this is the only
 * control on the surface that reaches the author's files.
 */
export function ConflictFooter({ rows, running, guard, onFinish, onAbandon }: ConflictFooterProps) {
  const { t, tn } = useTranslation();
  const undecided = countUndecidedFiles(rows);

  return (
    <div className="shrink-0 border-t border-edge px-3 py-2">
      {/* Said before the author invests in two hundred choices, not after: this record is the
                window's, and closing the tab or the window loses it. The merge itself is untouched,
                which is the half that makes it recoverable. */}
      <p className="mb-2 text-2xs text-fg-subtle">{t("documentDiff.resolve.notSaved")}</p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          {...guard.writes(running !== null || undecided > 0)}
          onClick={onFinish}
          data-resolve-finish
          className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-2xs text-on-primary transition-opacity cursor-default hover:opacity-90 disabled:opacity-50"
        >
          {running === "finish" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <GitMerge className="h-3 w-3" />
          )}
          {undecided > 0
            ? tn("documentDiff.resolve.finishUndecided", undecided)
            : t("documentDiff.resolve.finish")}
        </button>
        <button
          type="button"
          {...guard.writes(running !== null)}
          onClick={onAbandon}
          className="flex h-7 items-center justify-center rounded-md border border-edge px-2 text-2xs text-fg-muted transition-colors cursor-default hover:bg-fill hover:text-danger disabled:opacity-50"
        >
          {running === "abandon" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            t("documentDiff.resolve.abandon")
          )}
        </button>
      </div>
    </div>
  );
}
