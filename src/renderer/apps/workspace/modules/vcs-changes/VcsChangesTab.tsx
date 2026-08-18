import { useCallback, useMemo, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import type { Translator } from "@shared/i18n";
import { HelpTrigger } from "@/lib/help";
import { useTranslation } from "@/lib/i18n";
import { EmptyState } from "@/lib/components/elements";
// Not in the barrel, and present all the same - see `lib/components/elements/README.md`.
import { PanelHeader } from "@/lib/components/elements/PanelHeader";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import type { ChangeCategory } from "@/lib/vcs/changeCategory";
import { buildChangeIndex, type ChangeIndexGroup } from "@/lib/vcs/changeIndex";
import { ChangeIndexPane } from "@/lib/vcs/ChangeIndexPane";
import { IndexDivider, INDEX_DEFAULT_WIDTH } from "@/lib/vcs/IndexDivider";
import { ChangeDetailHost } from "@/lib/vcs/presenters/ChangeDetailHost";
import type { ComparisonSides } from "@/lib/vcs/presenters/comparisonSide";
import { useDocumentDiff, type DocumentDiffRequest } from "@/lib/vcs/useDocumentDiff";
import { shortRevision } from "../../components/layout/versionRailModel";
import { VcsResolvePanel } from "./VcsResolvePanel";
import type { VcsChangesPayload } from "./vcsChangesIds";

/**
 * A comparison as two panes: which files changed, and what changed in the one being looked at.
 *
 * It exists because the rail cannot be the only home for this. A 320px column can show eight rows
 * of one file's changes and nothing more, and conflict resolution - the same list with a side to
 * take per row - has nowhere to live in a column that narrow. So this is
 * a tab rather than a modal: a comparison is a document, and the workspace already opens documents
 * in tabs, which is also what lets the author keep one open beside the editors they are about to
 * change.
 *
 * **An index and a detail, not one long list.** This tab used to draw every changed document
 * expanded, one section under the next, with every change under each of those - forty changed files
 * were forty sections and a thousand rows in a single scroller, and the first question anyone has
 * ("did the story change?") could only be answered by scrolling past the assets. The left pane
 * answers that question in headings and one line per file; the right draws exactly one file, through
 * exactly one presenter (`lib/vcs/presenters`), so a format can take its own detail over later
 * without this file learning about it.
 *
 * **The comparison half is read-only by construction, therefore never gated on the freeze.** Nothing
 * below can write project data even in principle, and a frozen workspace - which is what a revision
 * preview IS - is exactly the state an author is in when they want to know what changed. The rule is
 * `freezeGuard`'s third bullet: navigation, selection and inspection are never touched. The resolve
 * mode is the exception and consults the guard itself, because taking a side rewrites files; see
 * `VcsResolvePanel`, which is a separate component so that the two cannot share a hook.
 *
 * **Never re-reads on its own.** The working-tree comparison scans, and a scan records newly
 * discovered directories into staged state (docs §4.17), so the only re-read is the button in the
 * header. A revision pair is immutable and cached in the main process, so it has no button at all.
 */

/**
 * Files this tab will list before it stops adding them.
 *
 * The index is not virtualised, and this is what makes that safe rather than lucky: a comparison may
 * carry up to `DIFF_PATH_LIMIT` (2000) documents, which is a first commit or a bulk import rather
 * than an edit. Past this the honest answer is a count of what was left out - and a restore is not
 * something anyone reads file by file. Rows are one per file now, so the budget counts files; the
 * per-file ceiling on change rows moved to the detail, where the rows themselves are
 * (`DOCUMENT_ROW_CEILING` in `presenters/GenericChangeDetail`).
 */
const TAB_ROW_BUDGET = 1000;

export function VcsChangesTab({ payload }: { payload?: VcsChangesPayload }) {
  // A tab restored from a persisted layout can arrive without one; the working tree is the answer
  // that is always meaningful, where a revision pair invented here would name versions at random.
  const mode: VcsChangesPayload = payload ?? { mode: "working-tree" };
  // Dispatched here rather than branched inside one body, because the two halves must not share
  // hooks: a comparison SCANS (docs §4.17), and a resolve view that mounted the comparison hook
  // would run that scan every time an author opened the merge - for a list it never draws.
  return mode.mode === "resolve" ? <VcsResolvePanel /> : <DocumentComparison mode={mode} />;
}

function DocumentComparison({ mode }: { mode: Exclude<VcsChangesPayload, { mode: "resolve" }> }) {
  const { t } = useTranslation();
  const request = useMemo<DocumentDiffRequest>(
    () =>
      mode.mode === "between"
        ? { mode: "between", from: mode.from, to: mode.to }
        : { mode: "working-tree" },
    [
      mode.mode,
      mode.mode === "between" ? mode.from : null,
      mode.mode === "between" ? mode.to : null
    ]
  );
  const diff = useDocumentDiff(request, { enabled: true });
  const result = diff.result;

  const index = useMemo(
    () => buildChangeIndex(result?.documents ?? [], { rowBudget: TAB_ROW_BUDGET }),
    [result]
  );

  /**
   * Which groups the author has opened or closed, over the model's default.
   *
   * An override rather than a copy of the whole open/closed state, so a group that arrives in a
   * later comparison starts at whatever its size says it should - the author's decision about the
   * assets group is not a decision about a group they have not seen yet.
   */
  const [openOverrides, setOpenOverrides] = useState<Partial<Record<ChangeCategory, boolean>>>({});
  const isOpen = useCallback(
    (group: ChangeIndexGroup) => openOverrides[group.category] ?? !group.collapsed,
    [openOverrides]
  );

  /**
   * The selected file, resolved against the current index rather than stored as truth.
   *
   * A re-read can drop the file that was selected, and a selection kept in state would then point
   * at a document the comparison no longer carries. The fallback is the first file of the first
   * OPEN heading, so the pane is never blank on arrival and the fallback is never a file with
   * nothing on screen pointing at it. A file the author picked and then closed the heading over
   * stays selected, because closing a heading is not a decision about what to look at.
   */
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const firstVisible = index.groups.find(isOpen)?.rows[0] ?? null;
  const selected = index.rows.find((row) => row.path === selectedPath) ?? firstVisible;

  /**
   * The two versions this tab is between, for a presenter that shows the file itself.
   *
   * Named here because this is the only place that knows: the change model says what differs and
   * deliberately not where it came from. The working tree's older side is the revision it was
   * compared against, which a repository with nothing recorded yet does not have - and then
   * there is no older side at all rather than one to guess at.
   */
  const comparison = useMemo<ComparisonSides>(
    () =>
      mode.mode === "between"
        ? {
            before: { at: "revision", revision: mode.from },
            after: { at: "revision", revision: mode.to }
          }
        : {
            before: result?.head ? { at: "revision", revision: result.head } : null,
            after: { at: "working-tree" }
          },
    [
      mode.mode,
      mode.mode === "between" ? mode.from : null,
      mode.mode === "between" ? mode.to : null,
      result?.head
    ]
  );

  const [indexWidth, setIndexWidth] = useState(INDEX_DEFAULT_WIDTH);
  const heading = comparisonHeading(mode, result?.head, t);
  const hasRows = index.rows.length > 0;

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-surface"
      data-help-topic="versionChanges"
    >
      <PanelHeader size="sm" className="group/help">
        <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">{heading}</span>
        {/* Only the working tree can have moved. A revision pair is immutable and answered
                    from the main process's cache, so a button here would be a control that cannot
                    change what it is beside. */}
        {mode.mode === "working-tree" && (
          <ToolbarButton
            size="xs"
            onClick={diff.reload}
            disabled={diff.loading}
            data-tip={t("documentDiff.tab.refresh")}
            aria-label={t("documentDiff.tab.refresh")}
          >
            {diff.loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
          </ToolbarButton>
        )}
        <HelpTrigger topic="versionChanges" />
      </PanelHeader>

      {/* Said once for the whole comparison, above both panes: these are facts about the read,
                not about any one file, and a pane is the wrong place for them. */}
      {result?.readFailure && (
        // Above everything, because the empty list underneath it means the opposite of what
        // an empty list usually means (docs §4.29).
        <p className="shrink-0 px-3 pt-2 text-xs text-danger">
          {t("documentDiff.tab.readFailure", { error: result.readFailure })}
        </p>
      )}
      {result && !result.complete && (
        <p className="shrink-0 px-3 pt-2 text-2xs text-warning">
          {t("documentDiff.tab.incomplete", {
            shown: String(result.documents.length),
            total: String(result.pathCount)
          })}
        </p>
      )}

      {diff.loading && result === null && (
        <p className="flex shrink-0 items-center gap-2 px-3 py-2 text-xs text-fg-subtle">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("documentDiff.rows.loading")}
        </p>
      )}
      {diff.error && <p className="shrink-0 px-3 py-2 text-xs text-danger">{diff.error}</p>}
      {/* Null with no error is the one answer that is about the INSTALLATION rather than
                about this project: version control ships no backend for some hosts, and that is
                a fact rather than a failure. */}
      {!diff.loading && !diff.error && result === null && (
        <p className="shrink-0 px-3 py-2 text-xs text-fg-subtle">
          {t("documentDiff.tab.unavailable")}
        </p>
      )}
      {result && !hasRows && !result.readFailure && (
        <EmptyState
          size="sm"
          className="flex-1"
          description={
            mode.mode === "working-tree"
              ? t("documentDiff.tab.emptyWorkingTree")
              : t("documentDiff.tab.empty")
          }
        />
      )}

      {hasRows && (
        <div className="flex min-h-0 flex-1">
          <ChangeIndexPane
            index={index}
            isOpen={isOpen}
            onToggle={(group) =>
              setOpenOverrides((current) => ({
                ...current,
                [group.category]: !isOpen(group)
              }))
            }
            selectedPath={selected?.path ?? null}
            onSelect={setSelectedPath}
            style={{ width: `${indexWidth}px` }}
            className="shrink-0 border-r border-edge"
          />

          <IndexDivider width={indexWidth} onWidth={setIndexWidth} />

          <div className="min-h-0 min-w-0 flex-1">
            {selected ? (
              <ChangeDetailHost key={selected.path} entry={selected.entry} sides={comparison} />
            ) : (
              <EmptyState size="sm" description={t("documentDiff.shell.selectPrompt")} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** What the header says this tab is comparing. Both sides are always named, or the tab is a mystery. */
function comparisonHeading(
  payload: Exclude<VcsChangesPayload, { mode: "resolve" }>,
  head: string | undefined,
  t: Translator["t"]
): string {
  switch (payload.mode) {
    case "working-tree":
      return head
        ? // `#36` when the opener knew it, which is every path an author can actually take to
          // this tab; the hash only for a tab restored from a persisted layout, where nobody
          // is left to ask. Naming it the way the rail, the status cell and the switcher menu
          // all name it is the whole point - one version with two names reads as two versions.
          t("documentDiff.tab.comparingWorkingTree", {
            version: payload.headLabel ?? shortRevision(head)
          })
        : // A repository with no revisions: there is no version to have changed since, and
          // saying so beats naming one that does not exist.
          t("documentDiff.tab.comparingWorkingTreeUnknown");
    case "between":
      return t("documentDiff.tab.comparingRevisions", {
        from: payload.fromLabel ?? shortRevision(payload.from),
        to: payload.toLabel ?? shortRevision(payload.to)
      });
  }
}
