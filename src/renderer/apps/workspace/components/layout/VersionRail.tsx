import { useEffect } from "react";
import {
    ChevronsLeft,
    Clock,
    GitBranch,
    GitCommitHorizontal,
    GitMerge,
    History,
    Loader2,
    Plus,
    RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import type { VersionSurface } from "../../hooks/useVersionSurface";
import {
    VERSION_RAIL_COLLAPSED_WIDTH,
    VERSION_RAIL_EXPANDED_WIDTH,
    isVersionSurfaceVisible,
    revisionLabel,
    shortRevision,
    type FlatHistoryEntry,
    type VersionRailPresence,
} from "./versionRailModel";
import { registerVersionRailBridge } from "./versionRailController";

interface VersionRailProps {
    surface: VersionSurface;
    /** Absent / strip / panel, from `resolveVersionRailPresence`. The layout owns the decision. */
    presence: VersionRailPresence;
    onExpandedChange: (expanded: boolean) => void;
}

/**
 * The version rail: the leftmost column of the window, and the surface that decides which version the
 * whole workspace is a view of.
 *
 * Left of the sidebar SELECTOR rail, not of the sidebar, and that is the point: in a past version the
 * author still needs the sidebar, the asset panel and the scene tree (plan 2026-07-28-002 §1). So this
 * is a column of its own rather than a panel in the left dock - a panel would have taken the place of
 * the very things the author came here to read.
 *
 * **The 48px strip exists only while the workspace is frozen**, because what it expresses is control
 * over a temporary state: it is the indicator that project data is not being saved, and it carries the
 * way out. At HEAD there is no strip and the rail costs the layout nothing - it is an openable panel
 * reached from the status cell or the top-bar widget, and closing it leaves nothing behind. Frozen, it
 * is not dismissible into nothing: an escape hatch the author can hide is not an escape hatch. The
 * rule itself is in `resolveVersionRailPresence`, not here.
 *
 * **Which is why this component stays mounted even at `absent`.** The bridge those two callers use is
 * registered from here, so a rail that unmounted at HEAD would be a rail nobody could open - and the
 * commit form lives inside the panel, so that would leave commit with no home at all.
 *
 * Its width is fed to the dock solver through `DockEnv.versionRailWidth` (see `dockLayoutModel`), not
 * added as a column beside it. A column the solver does not know about squeezes the editor under its
 * 480px floor, and the last time that account did not balance the result was a resize loop.
 */
export function VersionRail({ surface, presence, onExpandedChange }: VersionRailProps) {
    const { t } = useTranslation();
    const { state, busy, error, history } = surface;
    const onRevision = state.kind === "revision";
    const visible = isVersionSurfaceVisible(state);
    const open = presence === "panel";

    // The status-bar cell and the top-bar widget both promise "click to open the rail" and neither is
    // in this tree. Registered whenever version control EXISTS rather than whenever the column does:
    // at HEAD there is no column and those two are the only ways in. On a host with no version control
    // nothing is registered, so a stale caller cannot conjure a column that must not exist.
    useEffect(() => {
        if (!visible) {
            return;
        }
        return registerVersionRailBridge({
            open: () => onExpandedChange(true),
            collapse: () => onExpandedChange(false),
        });
    }, [visible, onExpandedChange]);

    // Reading history is an explicit act - opening the panel is the author asking for it - and it is
    // the only thing that happens on open besides the change scan below. Cheap on the second open:
    // revisions are immutable, so `VersionControlService` caches the page.
    useEffect(() => {
        if (!open || state.kind === "not-a-repository" || state.kind === "probing") {
            return;
        }
        surface.loadHistory();
        // A scan is skipped while a past revision is on screen. It is not a pure read - it records
        // newly discovered directories into the repository's staged state (docs §4.17) - and "browsing
        // history has zero side effects" is the decision this whole feature is shaped around (plan §1).
        // The working tree's change list is also not the question the author asked by opening history.
        if (state.kind !== "revision") {
            surface.refreshChanges();
        }
        // Keyed by the state kind and the revision on screen: re-reading on every render would be the
        // polling the service's class comment forbids.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, state.kind, state.kind === "revision" ? state.revision : null]);

    if (presence === "absent") {
        return null;
    }

    if (presence === "strip") {
        // The strip only exists while project data is frozen, so it is ALWAYS tinted and ALWAYS
        // carries the way out. Nothing else on screen has to be coloured for the author to know their
        // project is not being saved.
        const escapeLabel = surface.frozen === "manual"
            ? t("workspace.shell.freeze.release")
            : t("workspace.shell.versionControl.returnToCurrent");
        return (
            <div
                data-workspace-version-rail="strip"
                className="flex shrink-0 flex-col items-center gap-1 border-r border-primary bg-primary/15 px-1 py-2"
                style={{ width: VERSION_RAIL_COLLAPSED_WIDTH }}
            >
                <button
                    type="button"
                    onClick={() => onExpandedChange(true)}
                    title={onRevision
                        ? t("workspace.shell.versionControl.viewingVersion", { version: shownName(state) })
                        : t("workspace.shell.freeze.enteredTitle")}
                    aria-label={t("workspace.shell.versionControl.open")}
                    className="flex h-10 w-10 items-center justify-center rounded-md text-primary transition-colors cursor-default hover:bg-fill"
                >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
                </button>

                <button
                    type="button"
                    onClick={surface.returnToCurrent}
                    title={escapeLabel}
                    aria-label={escapeLabel}
                    className="flex h-10 w-10 items-center justify-center rounded-md text-primary transition-colors cursor-default hover:bg-fill"
                >
                    <RotateCcw className="h-4 w-4" />
                </button>

                {onRevision && (
                    /* Vertical because 48px has no room for `#12` horizontally, and the label is the
                       other half of the indicator - a tint alone does not say WHICH version.
                       `writingMode` inline rather than as a utility class: narraleaf-react injects a
                       Tailwind v4 sheet over this app, and betting on a generated utility here has
                       burned us before. */
                    <span
                        className="text-2xs tabular-nums text-primary"
                        style={{ writingMode: "vertical-rl" }}
                    >
                        {shownName(state)}
                    </span>
                )}
            </div>
        );
    }

    // Closing the panel leaves the strip while frozen and leaves nothing at HEAD, so it does not claim
    // to collapse into a column that will not be there.
    const dismissLabel = surface.frozen !== null
        ? t("workspace.shell.versionControl.collapse")
        : t("workspace.shell.versionControl.close");

    return (
        <div
            data-workspace-version-rail="panel"
            className={cn(
                "flex shrink-0 flex-col border-r bg-surface-sunken",
                onRevision ? "border-primary" : "border-edge",
            )}
            style={{ width: VERSION_RAIL_EXPANDED_WIDTH }}
        >
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-edge px-3">
                <div className="flex min-w-0 items-center gap-2">
                    <GitBranch className={cn("h-4 w-4 shrink-0", onRevision ? "text-primary" : "text-fg-muted")} />
                    <h2 className="truncate text-sm font-medium text-fg">
                        {t("workspace.shell.versionControl.title")}
                    </h2>
                </div>
                <button
                    type="button"
                    onClick={() => onExpandedChange(false)}
                    title={dismissLabel}
                    aria-label={dismissLabel}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-fg-muted transition-colors cursor-default hover:bg-fill hover:text-fg"
                >
                    <ChevronsLeft className="h-4 w-4" />
                </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
                <FocusedVersion surface={surface} />

                {/* The change list's seam. The count and the refresh live here now; the per-file list is
                    the next pass and lands inside this section, under the summary row. */}
                {state.kind !== "not-a-repository" && state.kind !== "probing" && (
                    <ChangesSection surface={surface} />
                )}

                {/* The commit form's seam. Deliberately empty rather than a disabled button: an inert
                    Commit control would be an action the workspace cannot perform, which is the one
                    thing `freezeGuard`'s rule says never to offer. The form goes here. */}
                <div data-vcs-seam="commit-form" />

                {state.kind === "not-a-repository" && <EnableVersionControl surface={surface} />}

                {history !== null && history.length > 0 && (
                    <HistoryList surface={surface} rows={history} />
                )}
                {history !== null && history.length === 0 && !busy && (
                    <p className="px-3 py-2 text-2xs text-fg-subtle">
                        {t("workspace.shell.versionControl.noHistory")}
                    </p>
                )}
                {busy && (
                    <p className="flex items-center gap-2 px-3 py-2 text-2xs text-fg-subtle">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t(busyKey(busy))}
                    </p>
                )}
                {error && <p className="px-3 py-2 text-2xs text-danger">{error}</p>}
            </div>
        </div>
    );
}

/**
 * Who and what the author is looking at, plus the way back.
 *
 * Leads with what the revision SAYS - its message - and drops the number and short hash to the line
 * below, where they are still the thing that tells two revisions apart by eye and still match what the
 * widget and the status cell show. All three metadata fields are optional, and absent renders as
 * absent: a revision with no message falls back to naming itself, and a missing author leaves no line
 * rather than an empty one. The repository's own first commit carries none of the three, so this is the
 * ordinary case and not a defensive branch.
 *
 * Metadata is only in hand once the history page has been read, which opening the panel does. Before
 * that (and for a revision older than the page) the identity is shown alone - the alternative would be
 * a per-revision backend call from a render.
 */
function FocusedVersion({ surface }: { surface: VersionSurface }) {
    const { t, locale } = useTranslation();
    const { state, focused } = surface;
    const onRevision = state.kind === "revision";
    const time = focused?.timestamp !== undefined ? formatRevisionTime(focused.timestamp, locale) : null;
    const author = focused?.author?.trim() || null;

    return (
        <div
            data-vcs-seam="revision-metadata"
            className={cn("border-b px-3 py-3", onRevision ? "border-primary/40 bg-primary/10" : "border-edge")}
        >
            <p className={cn("truncate text-sm font-medium", onRevision ? "text-primary" : "text-fg")}>
                {focused?.message?.trim()
                    // No message: the revision names itself, which is what this line said before the
                    // metadata was readable at all. "Current version" would be a lie in the two states
                    // where there is no version: a repository nobody has committed to, and a project
                    // with no repository at all.
                    || (onRevision
                        ? shownName(state)
                        : state.kind === "empty"
                            ? t("workspace.shell.versionControl.noHistory")
                            : state.kind === "not-a-repository"
                                ? t("workspace.shell.versionControl.notVersioned")
                                : t("workspace.shell.versionControl.currentVersion"))}
            </p>

            {(time || author) && (
                <p className="mt-0.5 truncate text-2xs text-fg-muted">
                    {[time, author].filter(Boolean).join(" · ")}
                </p>
            )}

            {/* The identity, kept: it is what the widget and the status cell show, and the hash is the
                only thing that separates two revisions carrying the same message. */}
            {(state.kind === "current" || state.kind === "revision") && (
                <div className="mt-0.5 flex items-baseline gap-2 text-2xs text-fg-subtle">
                    {numberLabel(state, focused) && (
                        <span className="tabular-nums">{numberLabel(state, focused)}</span>
                    )}
                    <span className="font-mono">
                        {shortRevision(state.kind === "current" ? state.head : state.revision)}
                    </span>
                </div>
            )}

            {onRevision && (
                <button
                    type="button"
                    onClick={surface.returnToCurrent}
                    className="mt-2 flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-2xs text-on-primary transition-opacity cursor-default hover:opacity-90"
                >
                    <RotateCcw className="h-3 w-3" />
                    {t("workspace.shell.versionControl.returnToCurrent")}
                </button>
            )}
        </div>
    );
}

/**
 * `#4`, from whichever source has it: the freeze's own label, the head's number, or the history row.
 *
 * Null rather than a placeholder when none of them does - which happens for the beat between opening
 * the panel and the page arriving, and for a preview entered without a label. The hash beside it always
 * names the revision, so a missing number costs nothing.
 */
function numberLabel(state: VersionSurface["state"], focused: FlatHistoryEntry | null): string | null {
    if (state.kind === "revision") {
        return state.label ?? (focused ? revisionLabel(focused.number) : null);
    }
    if (state.kind === "current") {
        return state.number !== null
            ? revisionLabel(state.number)
            : focused ? revisionLabel(focused.number) : null;
    }
    return null;
}

/**
 * A revision's time, in the reader's locale.
 *
 * The stored value is **epoch milliseconds, UTC** - measured by bracketing a commit between two
 * `Date.now()` readings, not inferred - so it is handed to `Date` unconverted. Reading it as seconds
 * dates every revision to 1970 and reading seconds as ms lands them in the year 56000; both look like
 * a permanent UI defect. The year is included because a history outlives a calendar year, unlike the
 * notification list this mirrors.
 *
 * Non-finite is rejected rather than rendered: nothing obliges another client to write a number here,
 * and `Invalid Date` in the rail would read as a corrupt repository.
 */
function formatRevisionTime(timestamp: number, locale: string): string | null {
    if (!Number.isFinite(timestamp)) {
        return null;
    }
    return new Date(timestamp).toLocaleString(locale, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/**
 * The working tree's changes, as a summary the author asked for.
 *
 * A count only ever appears after an explicit refresh - opening the rail is one, the button is another
 * - because the scan behind it is not a pure read: it records newly discovered directories into staged
 * state, so anything periodic would show the author deletions they never made (docs §4.17). `null`
 * therefore means "nobody has looked", which is a different thing from "clean" and is rendered as such.
 */
function ChangesSection({ surface }: { surface: VersionSurface }) {
    const { t } = useTranslation();
    const { status } = surface;
    // Directories are counted as changes in their own right by the backend, so the list an author
    // reads drops them - `getChangedFiles`' documented shape, re-derived here from the snapshot.
    const files = status?.files.filter(file => !file.directory) ?? null;

    return (
        <div data-vcs-seam="change-list" className="border-b border-edge px-3 py-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-2xs uppercase tracking-wide text-fg-subtle">
                    {t("workspace.shell.versionControl.changes")}
                </span>
                <button
                    type="button"
                    onClick={surface.refreshChanges}
                    title={t("workspace.shell.versionControl.refreshChanges")}
                    aria-label={t("workspace.shell.versionControl.refreshChanges")}
                    className="flex h-5 w-5 items-center justify-center rounded text-fg-subtle transition-colors cursor-default hover:bg-fill hover:text-fg"
                >
                    <RotateCcw className="h-3 w-3" />
                </button>
            </div>
            <p className="mt-1 text-2xs text-fg-muted">
                {files === null
                    ? t("workspace.shell.versionControl.changesUnknown")
                    : files.length === 0
                        ? t("workspace.shell.versionControl.noChanges")
                        : t("workspace.shell.versionControl.changesCount", { count: String(files.length) })}
            </p>
        </div>
    );
}

/**
 * The offer for a project that is not a repository yet.
 *
 * A button and one line, because enabling is irreversible in the way that matters: it writes `.lore/`
 * into the author's project folder and takes an exclusive lock on it. So it says what it will do, and
 * it only ever happens because they pressed it.
 */
function EnableVersionControl({ surface }: { surface: VersionSurface }) {
    const { t } = useTranslation();
    return (
        <div className="px-3 py-3">
            <button
                type="button"
                onClick={surface.enableVersionControl}
                disabled={surface.busy !== null}
                className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-2xs text-on-primary transition-opacity cursor-default hover:opacity-90 disabled:opacity-50"
            >
                <Plus className="h-3 w-3" />
                {t("workspace.shell.versionControl.enable")}
            </button>
            <p className="mt-2 text-2xs text-fg-subtle">{t("workspace.shell.versionControl.enableHint")}</p>
        </div>
    );
}

/**
 * The linear history: one row per revision, newest first, click to show it in the editors.
 *
 * Linear by flattening the DAG on first parent, which is a VIEW decision and lives in
 * `versionRailModel` - the service still answers a graph, because collaboration makes side branches
 * real and a data layer that had assumed a chain would need rebuilding rather than extending.
 * A merge is marked instead of expanded, so the list never quietly hides a second ancestry.
 *
 * Scrolling this list is how the author reaches other versions; the plan's "scrolling down moves
 * through the linear history" is this, bounded to one page. Paging past the page is the next pass.
 */
function HistoryList({ surface, rows }: { surface: VersionSurface; rows: FlatHistoryEntry[] }) {
    const { t } = useTranslation();
    const { state } = surface;
    const focused = state.kind === "revision" ? state.revision : state.kind === "current" ? state.head : null;

    return (
        <div>
            <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2">
                <span className="text-2xs uppercase tracking-wide text-fg-subtle">
                    {t("workspace.shell.versionControl.history")}
                </span>
                {(surface.hiddenCheckpoints > 0 || surface.showCheckpoints) && (
                    <button
                        type="button"
                        onClick={() => surface.setShowCheckpoints(!surface.showCheckpoints)}
                        className="text-2xs text-fg-subtle transition-colors cursor-default hover:text-fg"
                    >
                        {surface.showCheckpoints
                            ? t("workspace.shell.versionControl.hideCheckpoints")
                            : t("workspace.shell.versionControl.showCheckpoints", {
                                count: String(surface.hiddenCheckpoints),
                            })}
                    </button>
                )}
            </div>
            {rows.map(row => {
                const isFocused = row.revision === focused;
                return (
                    <button
                        key={row.revision}
                        type="button"
                        onClick={() => surface.showRevision(row.revision, revisionLabel(row.number))}
                        disabled={isFocused || surface.busy !== null}
                        title={isFocused ? undefined : t("workspace.shell.versionControl.showVersion")}
                        className={cn(
                            "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors cursor-default",
                            isFocused ? "bg-fill-strong text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                        )}
                    >
                        <span className="w-3 shrink-0">
                            {row.merge
                                ? <GitMerge className="h-3 w-3" />
                                : row.kind === "checkpoint"
                                    ? <Clock className="h-3 w-3" />
                                    : <GitCommitHorizontal className="h-3 w-3" />}
                        </span>
                        <span className="w-10 shrink-0 text-2xs tabular-nums">{revisionLabel(row.number)}</span>
                        <span className="flex-1 truncate font-mono text-2xs text-fg-subtle">
                            {shortRevision(row.revision)}
                        </span>
                        {row.merge && (
                            <span className="shrink-0 text-2xs text-fg-subtle">
                                {t("workspace.shell.versionControl.merge")}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

/**
 * What to call the version on screen.
 *
 * The freeze's own label when it has one - that label is `#4`, recorded by whoever asked for the
 * revision - and the short hash when it does not, because a revision view entered from somewhere that
 * did not pass a label still has to name what the author is looking at.
 */
function shownName(state: VersionSurface["state"]): string {
    if (state.kind === "revision") {
        return state.label ?? shortRevision(state.revision);
    }
    if (state.kind === "current" && state.number !== null) {
        return revisionLabel(state.number);
    }
    return "";
}

function busyKey(busy: NonNullable<VersionSurface["busy"]>) {
    switch (busy) {
        case "history":
            return "workspace.shell.versionControl.loadingHistory" as const;
        case "revision":
            return "workspace.shell.versionControl.loadingRevision" as const;
        case "init":
            return "workspace.shell.versionControl.enabling" as const;
        case "return":
            return "workspace.shell.versionControl.returning" as const;
    }
}
