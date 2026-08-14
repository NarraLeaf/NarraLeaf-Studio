import { Fragment, useEffect, useMemo, useState } from "react";
import {
    ArchiveRestore,
    Check,
    ChevronDown,
    Cloud,
    CloudDownload,
    CloudUpload,
    ChevronsLeft,
    Clock,
    Copy,
    FileMinus,
    FilePen,
    FilePlus,
    FileSymlink,
    GitBranch,
    GitCommitHorizontal,
    GitCompare,
    GitMerge,
    History,
    KeyRound,
    Loader2,
    Pin,
    PinOff,
    Plus,
    RefreshCw,
    ShieldCheck,
    TriangleAlert,
    X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { VcsChangeKind, VcsFileChange, VcsServerAuthority, VcsServerReach, VcsServerSession, VcsSignInProblem, VcsSyncState } from "@shared/types/vcs";
import { parseVcsRemoteUrl, vcsAuthorityIsVouchedFor } from "@shared/types/vcs";
import { cn } from "@/lib/utils/cn";
import { HelpTrigger } from "@/lib/help";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { Input, TextArea } from "@/lib/components/elements/Input";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { IconButton } from "@/lib/components/elements/Button";
import { getInterface } from "@/lib/app/bridge";
import { SERVERS_PANEL_SETTING_KEY } from "@shared/constants/servers";
import { useWorkspace } from "../../context";
import { openVcsChangesTab } from "../../modules/vcs-changes/openVcsChangesTab";
import type { VersionSurface } from "../../hooks/useVersionSurface";
import {
    VERSION_RAIL_COLLAPSED_WIDTH,
    VERSION_RAIL_EXPANDED_WIDTH,
    MANUAL_SERVER,
    NO_SERVER,
    buildChangeList,
    canCommit,
    initialServerChoice,
    filterHistoryRows,
    historyDayKey,
    historyDayLabel,
    historyRowHeadline,
    isCommitFormPresent,
    isVersionSurfaceVisible,
    revisionLabel,
    revisionMessageLine,
    shortRevision,
    splitChangePath,
    versionFace,
    type FlatHistoryEntry,
    type VersionRailPresence,
} from "./versionRailModel";
import { registerVersionRailBridge, VERSION_COMMIT_MESSAGE_ATTRIBUTE } from "./versionRailController";

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
 * author still needs the sidebar, the asset panel and the scene tree. So this
 * is a column of its own rather than a panel in the left dock - a panel would have taken the place of
 * the very things the author came here to read.
 *
 * **The 48px strip exists only while the workspace is frozen**, because what it expresses is control
 * over a temporary state: it is the indicator that project data is not being saved, and it carries the
 * way out. At HEAD there is no strip and the rail costs the layout nothing - it is an openable panel
 * reached from the status cell or the switcher menu, and closing it leaves nothing behind. Frozen, it
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
    // Only for the strip's merge button; everything else here reads the surface. Null before the
    // workspace has a context, which is why that button is conditional on it.
    const { context } = useWorkspace();
    const { state, busy, failure, history } = surface;
    const onRevision = state.kind === "revision";
    const visible = isVersionSurfaceVisible(state);
    const open = presence === "panel";

    // The status-bar cell and the switcher menu both promise "click to open the rail" and neither is
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
        // history has zero side effects" is the decision this whole feature is shaped around.
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
                // No right edge here, and this is the one state that goes without one. The tinted
                // block IS the seam - it meets the sidebar selector's own `border-r border-edge`
                // directly, and a coloured rule between two columns that are already different
                // colours is a second edge drawn over the first.
                className="flex shrink-0 flex-col items-center gap-1 bg-primary/15 px-1 py-2"
                style={{ width: VERSION_RAIL_COLLAPSED_WIDTH }}
            >
                <button
                    type="button"
                    onClick={() => onExpandedChange(true)}
                    data-tip={onRevision
                        ? t("workspace.shell.versionControl.viewingVersion", { version: shownName(state) })
                        : t("workspace.shell.freeze.enteredTitle")}
                    aria-label={t("workspace.shell.versionControl.open")}
                    className="flex h-10 w-10 items-center justify-center rounded-md text-primary transition-colors cursor-default hover:bg-fill"
                >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
                </button>

                {/* **A merge is the one freeze with no way out through `thaw`.** Leaving would
                    re-read a working tree whose conflicted documents are still unparseable - the
                    state this freeze exists because of - so the strip offers the way FORWARD
                    instead: open the merge. The panel's section says the same at full width.

                    Otherwise the ordinary escape, disabled for exactly one operation: leaving
                    DURING a restore would re-read a tree the main process is halfway through
                    rewriting, and the editors would hold a project that is part one version and
                    part another. Every other busy state is a read, and an escape hatch that greys
                    out whenever anything is loading is not an escape hatch. */}
                {surface.frozen === "merge" && context ? (
                    <button
                        type="button"
                        onClick={() => openVcsChangesTab(context, { mode: "resolve" })}
                        data-tip={t("workspace.shell.versionControl.mergeResolve")}
                        aria-label={t("workspace.shell.versionControl.mergeResolve")}
                        className="flex h-10 w-10 items-center justify-center rounded-md text-primary transition-colors cursor-default hover:bg-fill"
                    >
                        <GitMerge className="h-4 w-4" />
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={surface.returnToCurrent}
                        disabled={busy === "restore"}
                        data-tip={escapeLabel}
                        aria-label={escapeLabel}
                        className="flex h-10 w-10 items-center justify-center rounded-md text-primary transition-colors cursor-default hover:bg-fill disabled:opacity-50"
                    >
                        {/* Not a revert glyph. This control leaves a mode; the one that rewrites
                            files is two lines down and wears `ArchiveRestore`. A counter-clockwise
                            arrow here said "undo my project" on the one surface where that would be
                            the most expensive thing to get wrong. */}
                        <X className="h-4 w-4" />
                    </button>
                )}

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
        // Ruled on the right like every other column of the window's left edge - the same
        // `border-r border-edge` the sidebar selector and the left dock wear. A tone change alone
        // was tried and read as a missing edge next to neighbours that all have one; the panel is
        // one column in that row, not a surface of its own.
        //
        // Grey even while frozen: which version is on screen is said by the tinted block at the top
        // of the panel, the button under it and the status cell, all of which name it - a coloured
        // line cannot, and it would be the only tinted edge in a row of grey ones.
        //
        // The border sits INSIDE `VERSION_RAIL_EXPANDED_WIDTH` (border-box), so the width the dock
        // solver is told about is still the width this column takes.
        <div
            data-workspace-version-rail="panel"
            // What F1 answers with anywhere in this column. The topic follows the state, because
            // "what is this" has a different answer while a past version is on screen - which is
            // also the state the author is most likely to be asking from.
            data-help-topic={onRevision ? "versionViewing" : "versionControl"}
            className="flex shrink-0 flex-col border-r border-edge bg-surface-sunken"
            style={{ width: VERSION_RAIL_EXPANDED_WIDTH }}
        >
            <div className="group/help flex h-12 shrink-0 items-center border-b border-edge px-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <GitBranch className={cn("h-4 w-4 shrink-0", onRevision ? "text-primary" : "text-fg-muted")} />
                    <h2 className="truncate text-sm font-medium text-fg">
                        {t("workspace.shell.versionControl.title")}
                    </h2>
                </div>
                <HelpTrigger topic={onRevision ? "versionViewing" : "versionControl"} className="mr-1" />
                <button
                    type="button"
                    onClick={() => onExpandedChange(false)}
                    data-tip={dismissLabel}
                    aria-label={dismissLabel}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-fg-muted transition-colors cursor-default hover:bg-fill hover:text-fg"
                >
                    <ChevronsLeft className="h-4 w-4" />
                </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
                <FocusedVersion surface={surface} />

                {/* Between the version block and the commit form, which is where it belongs in the
                    hierarchy rather than where it is most eye-catching: a server is a property of
                    the REPOSITORY, a sibling of the branch and the head above it - not of the
                    working tree the two sections below describe. Reading down the panel therefore
                    goes "which version am I on -> where does that live -> what have I changed",
                    which is also the order in which the answers stop being true. */}
                {state.kind !== "not-a-repository" && state.kind !== "probing" && (
                    <ServerSection surface={surface} />
                )}

                {/* Under the server, because that is where a merge comes from, and above the commit
                    form, because while one is open committing is not "record my work" - it is what
                    closes the merge. Absent whenever there is none, which is almost always. */}
                <MergeSection surface={surface} />

                {/* Above the change list, which is the opposite of a review-then-act reading order and
                    is deliberate: this is a 320px column with ONE scroller, and the list can be fifty
                    rows. Putting the action after them means the only button this panel exists for
                    starts below the fold on any real working tree. The sidebar this most resembles -
                    VS Code's source control view, also a narrow column - makes the same call. */}
                <CommitForm surface={surface} />

                {/* Absent on a past revision, and that is a change from what this used to do. The list
                    describes the WORKING TREE while the screen shows a revision, which are not the same
                    thing; the scan is skipped in that state anyway (the effect above), so what it drew
                    there was whatever the last scan happened to leave behind - observed on a real app,
                    reporting a count from before the preview was entered. Keeping the refresh button
                    would also hand the author a way to trigger a scan while browsing history, and "zero
                    side effects while browsing" is the decision this feature is built around.

                    Keyed on `state.kind`, NOT on `frozen`: a manual freeze leaves the state on
                    `current`, and there the working tree is real, unchanging and worth showing. */}
                {state.kind !== "not-a-repository" && state.kind !== "probing" && state.kind !== "revision" && (
                    <ChangesSection surface={surface} />
                )}

                {state.kind === "not-a-repository" && <EnableVersionControl surface={surface} />}

                {/* Rendered for a page with NO rows in it as long as the collapse is what emptied it:
                    a project whose history is all automatic checkpoints has fifty revisions and zero
                    rows, and the list is the only place carrying the "show N checkpoints" control
                    that would bring them back - and now the way further back as well. */}
                {history !== null && (history.length > 0 || surface.hiddenCheckpoints > 0) && (
                    <HistoryList surface={surface} rows={history} />
                )}
                {history !== null && history.length === 0 && surface.hiddenCheckpoints === 0 && !busy && (
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
                {/* Red is reserved for something having gone wrong. The most common line this panel
                    ever draws is the answer to submitting a version of an unchanged tree, and in
                    red it read as a broken feature rather than as "there was nothing to record".

                    Withheld altogether when the server section is already saying, in a sentence
                    somebody can act on, that this installation has to sign in first: the string
                    underneath it would be the client library's own, in English, naming a verb no
                    author has heard of. */}
                {failure && !surface.remoteNeedsSignIn && (
                    <p className={cn(
                        "px-3 py-2 text-2xs",
                        failure.tone === "failure" ? "text-danger" : "text-fg-muted",
                    )}>
                        {failure.text}
                    </p>
                )}
            </div>
        </div>
    );
}

/**
 * Who and what the author is looking at, plus the way back.
 *
 * Leads with what the revision SAYS - its message - and drops the number and short hash to the line
 * below, where they are still the thing that tells two revisions apart by eye and still match what the
 * switcher menu and the status cell show. All three metadata fields are optional, and absent renders as
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
    // Studio's own sentences read back in the author's language; the author's own words untouched.
    // `original` is the stored English, and it goes in the title beside the message - what a
    // collaborator's client shows has to stay reachable from here.
    const headline = revisionMessageLine(focused?.message, t);
    const face = versionFace({ state, branch: surface.branch, rowNumber: focused?.number }, t);
    const hash = state.kind === "current"
        ? shortRevision(state.head)
        : state.kind === "revision"
            ? shortRevision(state.revision)
            : "";

    return (
        <div
            data-vcs-seam="revision-metadata"
            className={cn("border-b px-3 py-3", onRevision ? "border-primary/40 bg-primary/10" : "border-edge")}
        >
            <p
                // One truncated line, so the whole of it has to be reachable somehow; a version
                // message is often a sentence and this is the surface that names the version the
                // author is looking at.
                // `data-tip`, not `title`: Studio draws its own tooltips now and the native bubble is
                // banned outright (`noNativeTooltips.test.ts`). It honours `whitespace-pre-line`, so
                // the two lines below still arrive as two lines.
                data-tip={[headline?.text, headline?.original]
                    // Identical in English, where the reading and the stored bytes are the same
                    // sentence - printing it twice would look like a fault.
                    .filter((line, index, lines) => line && lines.indexOf(line) === index)
                    .join("\n") || undefined}
                className={cn("truncate text-sm font-medium", onRevision ? "text-primary" : "text-fg")}
            >
                {headline?.text
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

            {/* The identity, through the same `versionFace` as the switcher menu and the status
                cell - three surfaces naming one version three ways is a contradiction an author
                reads as a broken feature.

                **The hash used to be drawn beside it and is now in the title.** It earned its place
                as the only thing separating two revisions that carry the same message - except the
                line directly above already carries the time, which separates them just as well and
                means something to a person. What was left was seven characters of hex permanently on
                screen in a product whose authors never write code, which is the one thing the copy
                rules name outright. It is still HERE, because a hash is what the author's own `lore`
                CLI and any collaborator's client identify a revision by; it is just no longer the
                second thing they read.

                `unnumbered` is left at its default for the same reason: a revision reached from
                somewhere that never learned its number has nothing else to be called, and an empty
                line is worse than a hash. */}
            {(state.kind === "current" || state.kind === "revision") && face.text && (
                <div className="mt-0.5 text-2xs text-fg-subtle">
                    <span
                        className="block truncate tabular-nums"
                        // `data-tip` rather than `title` for the same reason as the line above.
                        data-tip={[face.full, hash].filter((line, index, lines) => lines.indexOf(line) === index).join("\n")}
                    >
                        {face.text}
                    </span>
                </div>
            )}

            {onRevision && (
                <div className="mt-2 flex items-center gap-1.5">
                    {/* Only a restore locks the way out; see the strip's copy of this button. */}
                    <button
                        type="button"
                        onClick={surface.returnToCurrent}
                        disabled={surface.busy === "restore"}
                        className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-2xs text-on-primary transition-opacity cursor-default hover:opacity-90 disabled:opacity-50"
                    >
                        <X className="h-3 w-3" />
                        {t("workspace.shell.versionControl.returnToCurrent")}
                    </button>

                    {/* The secondary of the pair, and it stays that way. Reading an old version is
                        what the author came here to do; putting the project back to it is the rarer
                        act and the only one on this panel that touches their files, so it does not
                        get to look like the way out. Icon-only for the same reason the 320px column
                        keeps everything else short - and because the confirmation it opens carries
                        the whole explanation, which no button this size could.

                        Disabled rather than absent while something runs: it is present in this state
                        unconditionally, so hiding it mid-operation would make the panel appear to
                        lose a control. */}
                    <button
                        type="button"
                        onClick={() => void surface.restoreRevision(state.revision, state.label)}
                        disabled={surface.busy !== null}
                        data-tip={t("workspace.shell.versionControl.restore")}
                        aria-label={t("workspace.shell.versionControl.restore")}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/40 text-primary transition-colors cursor-default hover:bg-fill disabled:opacity-50"
                    >
                        {surface.busy === "restore"
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <ArchiveRestore className="h-3 w-3" />}
                    </button>
                </div>
            )}
        </div>
    );
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
 * The working tree's changes: a summary the author asked for, and the files behind it.
 *
 * A count only ever appears after an explicit refresh - opening the rail is one, the button is another
 * - because the scan behind it is not a pure read: it records newly discovered directories into staged
 * state, so anything periodic would show the author deletions they never made (docs §4.17). `null`
 * therefore means "nobody has looked", which is a different thing from "clean" and is rendered as such.
 *
 * **One number, and it counts files.** `VcsStatus.counts` is the backend's own summary and it counts
 * DIRECTORIES too - one new folder holding one file is two - so the two disagree by design
 * (`VersionControlService.getChangedFiles`). A panel showing both would be a panel arguing with itself
 * about how much the author changed, so it shows the one the rows below it can be counted against.
 *
 * The list is bounded twice over: by `VERSION_CHANGE_LIST_LIMIT`, which says out loud how many rows it
 * left out, and by a height of its own. The height is the less obvious of the two, and it is not about
 * performance - it is that the history lives further down the SAME scroller. Fifty rows is a
 * screenful, so without a ceiling here the way to another version would be below the fold whenever the
 * author had been working, which is exactly when they are most likely to want it.
 *
 * **It lists files and never a change inside one.** A row used to expand into that file's comparison,
 * drawn in place; eight rows was the whole of what fitted, and the read behind it was a scan. The
 * comparison is a two-pane tab now (`modules/vcs-changes`), which has the width for an index and a
 * detail, so the rail keeps the half it can hold honestly - which files moved - and the button beside
 * the refresh is the way to the other half. The rail therefore runs no document comparison at all,
 * rather than running one whenever a row was opened.
 */
export function ChangesSection({ surface }: { surface: VersionSurface }) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const { status } = surface;
    const view = useMemo(() => (status ? buildChangeList(status.files) : null), [status]);

    return (
        <div data-vcs-seam="change-list" className="border-b border-edge px-3 py-2">
            <div className="flex items-center justify-between gap-2">
                <span className="text-2xs tracking-wide text-fg-subtle">
                    {t("workspace.shell.versionControl.changes")}
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                    {/* The way to the comparison, and the only one this section offers: a row cannot
                        be the way in, because the tab opens on a comparison rather than on a file,
                        and a row that opened onto some other file's detail would be a promise
                        broken on the first press. Same icon and same sentence as the history rows'
                        own compare button, because it is the same act. */}
                    {context && (
                        <button
                            type="button"
                            onClick={() => openVcsChangesTab(context, {
                                mode: "working-tree",
                                // What this panel is calling the head right now, so the tab's
                                // heading says the same `#36` the block above it does.
                                headLabel: surface.state.kind === "current" && surface.state.number !== null
                                    ? revisionLabel(surface.state.number)
                                    : undefined,
                            })}
                            data-tip={t("documentDiff.rail.compareWithPrevious")}
                            aria-label={t("documentDiff.rail.compareWithPrevious")}
                            className="flex h-5 w-5 items-center justify-center rounded-md text-fg-subtle transition-colors cursor-default hover:bg-fill hover:text-fg"
                        >
                            <GitCompare className="h-3 w-3" />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={surface.refreshChanges}
                        data-tip={t("workspace.shell.versionControl.refreshChanges")}
                        aria-label={t("workspace.shell.versionControl.refreshChanges")}
                        className="flex h-5 w-5 items-center justify-center rounded-md text-fg-subtle transition-colors cursor-default hover:bg-fill hover:text-fg"
                    >
                        <RefreshCw className="h-3 w-3" />
                    </button>
                </div>
            </div>
            <p className="mt-1 text-2xs text-fg-muted">
                {view === null
                    ? t("workspace.shell.versionControl.changesUnknown")
                    : view.total === 0
                        ? t("workspace.shell.versionControl.noChanges")
                        : t("workspace.shell.versionControl.changesCount", { count: String(view.total) })}
            </p>

            {view !== null && view.rows.length > 0 && (
                <div className="-mx-1 mt-1 max-h-64 overflow-y-auto">
                    {view.rows.map(file => (
                        <ChangeRow key={file.path} file={file} />
                    ))}
                    {view.hidden > 0 && (
                        <p className="px-1 pt-1 text-2xs text-fg-subtle">
                            {t("workspace.shell.versionControl.changesMore", { count: String(view.hidden) })}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * One changed file.
 *
 * **A plain `<div>`, because it opens onto nothing.** It was a button for one milestone, expanding
 * into that file's changes in place; those changes are the comparison tab's now, and the tab opens on
 * a comparison rather than on a file - so a row that looked pressable would land the author on some
 * other file's detail. Highlighting something that opens onto nothing is worse than not highlighting
 * it, which is the rule this row was written under before it briefly became a control.
 *
 * The freeze is deliberately not consulted anywhere here. Reading which files moved is a read by
 * construction, and a manual freeze leaves this section on screen (it is keyed on the surface state,
 * not on `frozen`) - so switching it off would take away the only way to see what is uncommitted
 * precisely while the author is unable to commit it.
 *
 * The path is split so the FILE NAME survives a narrow column and the directory is what gets cut - and
 * cut at its head, not its tail, because the distinguishing end of a path here is the last thing on it
 * (`editor/story/chapter-01.json` against `editor/story/chapter-02.json` differ in the one character an
 * ordinary trailing ellipsis would eat). Overflowing to the left is what `direction: rtl` on the
 * directory box buys; the inner span puts the characters back in reading order, which an
 * all-neutral directory name (`2026/07`) would otherwise get wrong. Inline rather than as utilities:
 * narraleaf-react injects a Tailwind v4 sheet over this app and betting on generated utilities here
 * has burned us before.
 */
function ChangeRow({ file }: { file: VcsFileChange }) {
    const { t } = useTranslation();
    const { directory, name } = splitChangePath(file.path);
    const Icon = CHANGE_ICONS[file.kind];
    // Not cast to `TranslationKey`: the template resolves to a union of the five literal keys, so a
    // renamed or missing one is a type error here rather than a string that renders as itself.
    const kindLabel = t(`workspace.shell.versionControl.changeKind.${file.kind}`);
    // The whole repository-relative path, plus where a move or copy came from - the row itself has no
    // room for an origin, and dropping it would make a move indistinguishable from an add.
    const title = file.fromPath
        ? `${file.path}\n${t("workspace.shell.versionControl.changeFromPath", { path: file.fromPath })}`
        : file.path;

    return (
        <div
            data-tip={title}
            data-vcs-change-row={file.path}
            className="flex w-full items-center gap-1.5 overflow-hidden rounded-md px-1 py-0.5 text-left"
        >
            {/* `role="img"` beside the label: an <svg> carrying only aria-label is announced by nothing,
                and the kind is the one thing about this row that is not in the text. */}
            <Icon
                role="img"
                className={cn("h-3 w-3 shrink-0", CHANGE_TINTS[file.kind])}
                aria-label={kindLabel}
            />
            {/* Shrinks first and by a wide margin, so the file name only starts to give way once the
                directory has nothing left to give. */}
            {directory !== null && (
                <span
                    className="overflow-hidden whitespace-nowrap text-2xs text-fg-subtle"
                    style={{ direction: "rtl", textOverflow: "ellipsis", flexShrink: 999, minWidth: 0 }}
                >
                    <span style={{ direction: "ltr", unicodeBidi: "embed" }}>{directory}/</span>
                </span>
            )}
            <span className="min-w-0 truncate text-2xs text-fg-muted">{name}</span>
            {file.conflictUnresolved && (
                <TriangleAlert
                    role="img"
                    className="ml-auto h-3 w-3 shrink-0 text-danger"
                    aria-label={t("workspace.shell.versionControl.changeConflict")}
                />
            )}
        </div>
    );
}

/**
 * The marker each kind wears.
 *
 * Five, matching `VcsChangeKind` - which is Studio's vocabulary and not the backend's: an edited file
 * comes back as KEEP and is translated to `modified` in `repository.ts` (docs §4.18), so nothing here
 * ever sees a raw action.
 */
const CHANGE_ICONS: Record<VcsChangeKind, LucideIcon> = {
    added: FilePlus,
    modified: FilePen,
    deleted: FileMinus,
    moved: FileSymlink,
    copied: Copy,
};

/**
 * Colour for the two kinds that lose something.
 *
 * Only added and deleted are tinted. The other three are ordinary edits and a list where every row is
 * coloured says nothing at all; a deletion is the row an author most needs to catch before recording.
 */
const CHANGE_TINTS: Record<VcsChangeKind, string> = {
    added: "text-success",
    modified: "text-fg-subtle",
    deleted: "text-danger",
    moved: "text-fg-subtle",
    copied: "text-fg-subtle",
};

/**
 * How the author submits a version - and until this existed, there was no way to do it anywhere in
 * Studio.
 *
 * **Absent rather than disabled** whenever it cannot be pressed for a reason that is not "something
 * is already running": the rule is in `isCommitFormPresent`, and the reason it is a rule rather than
 * a condition here is that a frozen workspace showing an inert Commit button is the exact thing
 * `freezeGuard` says never to offer.
 *
 * **The button reads the change count only once someone has looked.** `surface.status` is null until
 * a scan happens, and scanning to decide whether to enable a button would be the implicit scan docs
 * §4.17 forbids - so a null count leaves the button live and the backend answers "nothing has changed
 * since the last version", which for someone who pressed Submit is the answer to what they asked. A
 * count that a scan actually produced is different: the section right below is already saying "No
 * changes", and a live button under that sentence only ever produced a refusal (`canCommit`).
 *
 * **An empty message is allowed** - `VcsCommitOptions.message` documents empty as "the default for
 * the kind", and a revision with no message already renders as itself in `FocusedVersion`. So there
 * is no validation and nothing to dismiss; the placeholder carries the whole explanation.
 *
 * The draft survives a failed commit and is cleared only by one that succeeded, because it is the
 * only copy of what the author wrote. It does not survive closing the panel - the form unmounts with
 * it - which is a deliberate boundary rather than an oversight: a draft that outlived the panel would
 * also outlive a project switch, and reappear over someone else's project.
 */
function CommitForm({ surface }: { surface: VersionSurface }) {
    const { t } = useTranslation();
    const [message, setMessage] = useState("");
    const frozen = surface.frozen !== null;
    const present = isCommitFormPresent({ state: surface.state, frozen });
    // The same count the section below draws, from the same builder - the two disagreeing about
    // whether this project has changes would be the panel arguing with itself. Null while nobody has
    // scanned, which is not "clean" and does not disable anything.
    const changedFiles = surface.status ? buildChangeList(surface.status.files).total : null;
    const enabled = canCommit({
        state: surface.state,
        frozen,
        busy: surface.busy !== null,
        changedFiles,
    });

    const submit = () => {
        if (!enabled) {
            return;
        }
        void surface.commit(message).then(recorded => {
            if (recorded) setMessage("");
        });
    };

    if (!present) {
        return null;
    }

    return (
        <div data-vcs-seam="commit-form" className="border-b border-edge px-3 py-2">
            {/* Above the message box, because it is answered once and then never again - and because
                the question it asks ("who is this version by") is about the version the author is
                one press away from recording. */}
            <AuthorIdentity surface={surface} />
            <TextArea
                size="sm"
                rows={2}
                value={message}
                onChange={event => setMessage(event.target.value)}
                // The keyboard way out of a multi-line box, where plain Enter belongs to the text.
                onKeyDown={event => {
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        submit();
                    }
                }}
                // Only while the message is being consumed. A history read (which goes to the
                // network on a project with a remote) must not take the box away mid-sentence.
                disabled={surface.busy === "commit"}
                placeholder={t("workspace.shell.versionControl.commitPlaceholder")}
                aria-label={t("workspace.shell.versionControl.commitMessage")}
                // How the palette's "Submit a version" finds this box after opening the rail. An
                // attribute rather than the aria-label, which is translated.
                {...{ [VERSION_COMMIT_MESSAGE_ATTRIBUTE]: "" }}
                className="text-2xs"
            />
            <button
                type="button"
                onClick={submit}
                disabled={!enabled}
                className="mt-2 flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-2xs text-on-primary transition-opacity cursor-default hover:opacity-90 disabled:opacity-50"
            >
                {surface.busy === "commit"
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <GitCommitHorizontal className="h-3 w-3" />}
                {t("workspace.shell.versionControl.commit")}
            </button>
        </div>
    );
}

/**
 * Who to sign versions as, asked once and only while nobody has said.
 *
 * **The setting has always existed and nothing ever asked**, so every project in every install
 * records `NarraLeaf Studio` as the author of every version. Alone that is merely uninformative;
 * with a server configured it means a shared history in which nobody can tell who wrote what, which
 * is most of what a shared history is for.
 *
 * Asked HERE rather than added to the first-run wizard, and not filled in from the OS account: it is
 * the moment the name is about to be used, the author is already looking at a version they are
 * about to record, and one line in the panel they are using costs nothing to ignore. Studio does not
 * publish their login name on their behalf (`UNCONFIGURED_IDENTITY` explains why), so the only two
 * honest options are to ask or to keep recording the tool.
 *
 * Absent the moment it is answered. Changing it afterwards is Settings → Version control, which is
 * where a decision made once a year belongs - a permanent field in a 320px column would cost every
 * author width for a question they have already answered.
 */
function AuthorIdentity({ surface }: { surface: VersionSurface }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState("");
    const [saving, setSaving] = useState(false);

    if (surface.authorName !== null) {
        return null;
    }

    const submit = () => {
        const name = draft.trim();
        // Nothing to store, and the offer stays: an empty name is what is already recorded, so
        // "saving" it would only make the row disappear without changing anything.
        if (!name || saving) {
            return;
        }
        setSaving(true);
        void surface.setAuthorName(name).finally(() => setSaving(false));
    };

    return (
        <div data-vcs-seam="author-identity" className="mb-2">
            <label className="block text-2xs tracking-wide text-fg-subtle" htmlFor={AUTHOR_INPUT_ID}>
                {t("workspace.shell.versionControl.authorLabel")}
            </label>
            <div className="mt-1 flex items-center gap-1.5">
                <Input
                    id={AUTHOR_INPUT_ID}
                    size="sm"
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === "Enter") {
                            event.preventDefault();
                            submit();
                        }
                    }}
                    disabled={saving}
                    placeholder={t("workspace.shell.versionControl.authorPlaceholder")}
                    className="min-w-0 flex-1 text-2xs"
                />
                {/* A button rather than saving on blur: this writes a Studio-wide setting, and a
                    field that stored itself when the author clicked elsewhere would do it while
                    they were still deciding. */}
                <button
                    type="button"
                    onClick={submit}
                    disabled={saving || draft.trim() === ""}
                    data-tip={t("workspace.shell.versionControl.authorSave")}
                    aria-label={t("workspace.shell.versionControl.authorSave")}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-edge text-fg-muted transition-colors cursor-default hover:bg-fill hover:text-fg disabled:opacity-50"
                >
                    {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                </button>
            </div>
        </div>
    );
}

/**
 * How many versions a list has to hold before it offers to be narrowed.
 *
 * Below this, the filter would be a control that costs a row of height to save nothing: a dozen rows
 * is a list an author reads. It counts what is DRAWN, so a project of fifty checkpoints and three
 * commits does not get a filter until the checkpoints are shown - which is exactly when it needs one.
 */
const HISTORY_FILTER_THRESHOLD = 12;

/**
 * One id, because the row is drawn in two places and a `<label for>` needs one that matches.
 *
 * Both are never on screen at once - the commit form is absent while the server form is open - so a
 * constant is safe here in a way it would not be for a repeated row.
 */
const AUTHOR_INPUT_ID = "vcs-author-name";

/**
 * The server this project synchronises with: whether there is one, where it stands, and the two
 * buttons that move versions between here and there.
 *
 * **Nothing here contacts the server until the author asks.** Whether a server is CONFIGURED is a
 * local read and is known on open; whether it ANSWERS costs up to two seconds against a host that
 * is not there (measured), so the section opens on "not checked" and `checkRemote` is the only
 * thing that reaches out. A row that phoned home on mount would put those two seconds on the path
 * of opening the panel, and would do it again on every project.
 *
 * **The credential fields are behind a press, never in front of one.** Signing in needs both a
 * token and an https address, and a bare server on a LAN has neither and needs neither - measured.
 * Two mandatory-looking boxes in front of every author, for a case most will never meet, is the
 * thing to avoid; a single quiet line that opens them is not. It is a line rather than a state
 * reached only by being refused, because a server that wants a token wants it before the first
 * push, and finding that out by being turned away costs two seconds and teaches nothing.
 *
 * That is also why the common setup is genuinely one field: the backend keeps only the ORIGIN of
 * the URL it is given and identifies the repository by its own id, so a per-project address is not
 * a thing that exists.
 */
/**
 * Signing in to the server this project is pointed at, and saying who is signed in.
 *
 * **The whole point of it is on the last line**: while a session is in force, what goes on a
 * revision is the name the server knows this account by, not what somebody typed into their own
 * settings - so the panel says that name, where it came from, and nothing else.
 *
 * The refusal sentences are not decoration either. The backend answers an untrusted certificate,
 * a port nothing listens on, an unresolvable name and an endpoint speaking plain HTTP with one
 * identical sentence, so the reason arrives here as a code and this is where it becomes something
 * a person can act on. The certificate case is the one worth reading twice: nothing inside Studio
 * can trust an authority on this machine's behalf, so it names the fingerprint to compare and
 * sends them to the person who runs the server.
 */
function SignInSection({ surface }: { surface: VersionSurface }) {
    const { t } = useTranslation();
    const { serverSession, signIn, busy } = surface;
    const [open, setOpen] = useState(false);
    const [address, setAddress] = useState("");
    const [token, setToken] = useState("");
    const running = busy !== null;
    // Both read off the last answer rather than held as state, so they cannot disagree
    // with the sentence being shown underneath the fields.
    const needsAddress = signIn !== null && !signIn.ok && signIn.problem.kind === "address";
    const untrusted = signIn !== null && !signIn.ok && signIn.problem.kind === "certificate"
        ? signIn.problem.authority
        : null;
    // A token that named a DIFFERENT authority than the one answering gets no button at
    // all - not a quieter one. The sentence above says something is standing in the way,
    // and a control underneath offering to trust it anyway argues with that sentence.
    const offer = untrusted && (vcsAuthorityIsVouchedFor(untrusted) || untrusted.expected === "")
        ? untrusted
        : null;

    if (serverSession) {
        return (
            <div data-vcs-seam="server-identity" className="mt-1 flex items-baseline gap-1.5">
                <span className="min-w-0 flex-1 truncate text-2xs text-fg-muted" data-tip={serverSession.account.identity}>
                    {t("workspace.shell.versionControl.server.signIn.signedInAs", {
                        name: serverSession.account.displayName,
                    })}
                </span>
                <button
                    type="button"
                    onClick={() => void surface.signOutOfServer()}
                    disabled={running}
                    className="shrink-0 text-2xs text-fg-subtle transition-colors cursor-default hover:text-fg disabled:opacity-50"
                >
                    {t("workspace.shell.versionControl.server.signIn.signOut")}
                </button>
            </div>
        );
    }

    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                disabled={running}
                className="mt-1 flex items-center gap-1.5 text-2xs text-fg-subtle transition-colors cursor-default hover:text-fg disabled:opacity-50"
            >
                <KeyRound className="h-3 w-3" />
                {t("workspace.shell.versionControl.server.signIn.open")}
            </button>
        );
    }

    const submit = () => {
        if (!token.trim()) return;
        void surface.signInToServer(address.trim(), token.trim()).then(signedIn => {
            if (!signedIn) return;
            setOpen(false);
            // The token is not kept for a moment longer than the call that used it. Nothing
            // here needs it again, and a box still holding a credential is one a screenshot,
            // a screen share or the next person at this desk can read.
            setToken("");
        });
    };

    return (
        <div data-vcs-seam="sign-in-form" className="mt-2">
            <label className="block text-2xs tracking-wide text-fg-subtle">
                {t("workspace.shell.versionControl.server.signIn.tokenLabel")}
            </label>
            <Input
                size="sm"
                autoFocus
                value={token}
                onChange={event => setToken(event.target.value)}
                onKeyDown={event => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        submit();
                    }
                    if (event.key === "Escape") {
                        event.preventDefault();
                        setOpen(false);
                    }
                }}
                disabled={running}
                placeholder={t("workspace.shell.versionControl.server.signIn.tokenPlaceholder")}
                className="mt-1 text-2xs"
            />
            {/* Only once a sign-in has come back saying the token names nowhere. A Team server's
                token carries its own endpoint, so for most people this box never appears;
                putting it above the token box, as this form used to, asked everybody for
                an address most of them had no way to know. */}
            {needsAddress && (
                <>
                    <label className="mt-2 block text-2xs tracking-wide text-fg-subtle">
                        {t("workspace.shell.versionControl.server.signIn.addressLabel")}
                    </label>
                    <Input
                        size="sm"
                        autoFocus
                        value={address}
                        onChange={event => setAddress(event.target.value)}
                        disabled={running}
                        placeholder={t("workspace.shell.versionControl.server.signIn.addressPlaceholder")}
                        className="mt-1 text-2xs"
                    />
                </>
            )}
            <p className="mt-1 text-2xs text-fg-subtle">
                {t("workspace.shell.versionControl.server.signIn.hint")}
            </p>
            {/* `break-words` earns its place on exactly one of these sentences: the ones about
                certificates end in a 95-character fingerprint with no spaces in it, and a rail
                320px wide cuts it off two thirds of the way through - which leaves the author
                comparing a fingerprint against half of one. Ordinary prose is unaffected; only a
                word that cannot fit at all is broken. */}
            {signIn && !signIn.ok && describeSignInProblem(signIn.problem, t) !== "" && (
                <p data-vcs-seam="sign-in-problem" className="mt-1.5 break-words text-2xs text-danger">
                    {describeSignInProblem(signIn.problem, t)}
                </p>
            )}
            {offer && (
                <AuthorityOffer
                    authority={offer}
                    surface={surface}
                    onTrusted={() => { void surface.signInToServer(address.trim(), token.trim()); }}
                />
            )}
            <div className="mt-2 flex items-center gap-1.5">
                <button
                    type="button"
                    onClick={submit}
                    disabled={running || !token.trim() || (needsAddress && !address.trim())}
                    className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-2 text-2xs text-on-primary transition-opacity cursor-default hover:opacity-90 disabled:opacity-50"
                >
                    {busy === "remote"
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <KeyRound className="h-3 w-3" />}
                    {t("workspace.shell.versionControl.server.signIn.submit")}
                </button>
                <button
                    type="button"
                    onClick={() => setOpen(false)}
                    disabled={running}
                    className="flex h-7 items-center justify-center rounded-md border border-edge px-2 text-2xs text-fg-muted transition-colors cursor-default hover:bg-fill hover:text-fg disabled:opacity-50"
                >
                    {t("workspace.shell.versionControl.server.signIn.cancel")}
                </button>
            </div>
        </div>
    );
}

/**
 * The offer to trust a server's certificate authority, and the dialog that decides it.
 *
 * **What this replaced.** The certificate refusal used to end in a paragraph telling the
 * author to ask whoever runs the server for a command. That command names a certificate
 * file living on the server's own disk, so on the author's machine it could not be run at
 * all - and the people who reach this are, by construction, the ones who do not run the
 * server. The certificate is now on this machine before the question is asked.
 *
 * **Two ways in, and they are not the same question.** Where the pasted token names this
 * authority, the comparison has already been made and what is left is a decision. Where
 * it names none - a plain loreserver, an older Team server - the fingerprint is shown and the
 * author is asked to check it against what they were told, exactly as before. A token
 * that names a DIFFERENT authority never reaches here: that is the shape an interception
 * has, and the rail says so instead of offering a button.
 */
function AuthorityOffer({ authority, surface, onTrusted }: {
    authority: VcsServerAuthority;
    surface: VersionSurface;
    onTrusted: () => void;
}) {
    const { t } = useTranslation();
    const [asking, setAsking] = useState(false);
    const vouched = vcsAuthorityIsVouchedFor(authority);
    const key = "workspace.shell.versionControl.server.signIn.trust" as const;

    const confirm = () => {
        void surface.trustAuthority(authority.path).then(installed => {
            setAsking(false);
            // Only on success, and from the rail rather than from the surface: whether to
            // try again is a question about what is still in the token box up there.
            if (installed) onTrusted();
        });
    };

    return (
        <div data-vcs-seam="authority-offer" className="mt-1.5">
            <button
                type="button"
                onClick={() => setAsking(true)}
                disabled={surface.busy !== null}
                className={cn(
                    "flex h-7 w-full items-center justify-center gap-1.5 rounded-md px-2 text-2xs",
                    "transition-colors cursor-default disabled:opacity-50",
                    // Filled only where the token already vouched for this authority.
                    // Where it did not, the author still has a comparison to make, and a
                    // filled button in front of an unmade decision argues for pressing it.
                    vouched
                        ? "bg-primary text-on-primary hover:opacity-90"
                        : "border border-edge text-fg-muted hover:bg-fill hover:text-fg",
                )}
            >
                <ShieldCheck className="h-3 w-3" />
                {t(`${key}.open`)}
            </button>
            <Modal
                isOpen={asking}
                onClose={() => setAsking(false)}
                title={t(`${key}.title`)}
                size="md"
                footer={(
                    <div className="flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setAsking(false)}
                            className={dialogFooterButtonClass({ variant: "secondary" })}
                        >
                            {t(`${key}.cancel`)}
                        </button>
                        {authority.canInstall && (
                            <button
                                type="button"
                                onClick={confirm}
                                disabled={surface.busy !== null}
                                className={dialogFooterButtonClass({
                                    variant: "primary",
                                    disabled: surface.busy !== null,
                                })}
                            >
                                {t(`${key}.confirm`)}
                            </button>
                        )}
                    </div>
                )}
            >
                <div className="space-y-3 text-sm text-fg-muted">
                    <p>{t(vouched ? `${key}.vouched` : `${key}.compare`)}</p>
                    <div className="rounded-md border border-edge bg-fill-subtle p-3">
                        <FieldLabel>{t(`${key}.authorityLabel`)}</FieldLabel>
                        <p className="mt-1 text-sm text-fg">{authority.subject}</p>
                        <FieldLabel className="mt-2 block">{t(`${key}.fingerprintLabel`)}</FieldLabel>
                        {/* Monospaced and broken across lines on purpose: this is the one
                            string in the dialog somebody may read character by character
                            against another screen, and proportional type makes that worse. */}
                        <p className="mt-1 break-all font-mono text-xs text-fg">{authority.fingerprint}</p>
                    </div>
                    {/* Said plainly, and not softened. An authority is not one server's
                        certificate: whatever holds its key can issue a certificate for any
                        name and this account will believe it. */}
                    <p>{t(`${key}.meaning`)}</p>
                    {!authority.canInstall && (
                        <div>
                            <p>{t(`${key}.manual`)}</p>
                            <div className="mt-2 flex items-start gap-2 rounded-md border border-edge bg-fill-subtle p-3">
                                <code className="min-w-0 flex-1 break-all font-mono text-xs text-fg">
                                    {authority.command}
                                </code>
                                <IconButton
                                    size="sm"
                                    aria-label={t(`${key}.copy`)}
                                    onClick={() => void navigator.clipboard?.writeText(authority.command)}
                                >
                                    <Copy className="h-3.5 w-3.5" />
                                </IconButton>
                            </div>
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    );
}

/**
 * One sentence per way a sign-in can fail, in the reader's own language.
 *
 * Built here rather than passed through from the backend because the backend cannot tell four
 * of these apart - see {@link SignInSection} - and because the one sentence that has to be acted
 * on by a person, the certificate, names a command that is not Studio's to run.
 */
function describeSignInProblem(
    problem: VcsSignInProblem,
    t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): string {
    const key = "workspace.shell.versionControl.server.signIn.problem" as const;
    switch (problem.kind) {
        case "scheme":
            return t(`${key}.scheme`);
        case "token":
            return t(`${key}.token`);
        case "address":
            return t(`${key}.address`);
        case "certificate":
            // Vouched for: nothing is wrong that a sentence in red would describe. The
            // offer below the form is the whole of the answer, and a warning above it
            // would be arguing against the button it sits on top of.
            if (vcsAuthorityIsVouchedFor(problem.authority)) return "";
            // The token named an authority and something else answered. Not a variant of
            // "you have not trusted this one yet": both fingerprints are named, and no
            // button is offered anywhere on this path.
            if (problem.authority.expected) {
                return t(`${key}.mismatch`, {
                    expected: problem.authority.expected,
                    found: problem.authority.fingerprint,
                });
            }
            return t(`${key}.certificate`, { fingerprint: problem.authority.fingerprint || "-" });
        case "server":
            // Only answered where a server is added on its own, which happens in Settings.
            // Handled rather than defaulted so that adding a refusal kind keeps failing
            // here loudly instead of reading `detail` off a shape that has none.
            return t("settings.servers.problems.server");
        case "unreachable":
            return t(`${key}.unreachable`, { detail: problem.detail });
        case "refused":
            return t(`${key}.refused`, { detail: problem.detail });
        default:
            return t(`${key}.unknown`, { detail: problem.detail });
    }
}

/** What reaching the server after signing in came to, said as a sentence rather than a number. */
function describeReach(reach: VcsServerReach): TranslationKey {
    return `workspace.shell.versionControl.server.signIn.reach.${reach}` as TranslationKey;
}



/**
 * Choosing which server this project synchronises with.
 *
 * **A project chooses a server; it does not describe one.** The servers this installation
 * is signed in to are managed in Settings, once, and every project since then picks from
 * that list - which is why this is a dialog with names in it rather than a text field. A
 * project pointed at a server nobody has signed in to would be pointed at a refusal.
 *
 * Adding one is therefore not offered here at all: the last row of the list opens Settings
 * on the servers panel and closes this dialog. A token pasted into a side panel would put
 * a machine-wide credential behind a per-project control, and there would then be two
 * places that add a server and one of them would go stale.
 *
 * The address field stays for the case the list cannot cover: a `loreserver` with nothing
 * in front of it asks nobody who they are, so there is no account to add and nothing to
 * put in that list. It sits below the add row rather than beside the list, because a
 * project that reaches one is the exception and typing an address is not the way in.
 */
export function ServerPickerDialog({ surface, isOpen, onClose }: {
    surface: VersionSurface;
    isOpen: boolean;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const key = "workspace.shell.versionControl.server.picker";
    const [servers, setServers] = useState<VcsServerSession[]>([]);
    const [choice, setChoice] = useState<string>(NO_SERVER);
    const [address, setAddress] = useState("");
    const [name, setName] = useState("");
    const running = surface.busy !== null;

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        void getInterface().vcs.listServers().then(result => {
            if (cancelled) return;
            const list = result.success ? result.data.servers : [];
            setServers(list);
            // Seeded with the server this project already uses, so changing one is a choice
            // between named things rather than a retype. Falling back to nothing chosen
            // rather than to the first server: connecting somewhere nobody asked for is the
            // one outcome a dialog about where work is sent must not make easy.
            setChoice(initialServerChoice(list, surface.remote));
            setAddress(surface.remote ?? "");
            // The name this project answers to on the server. Its own name is the answer
            // nearly every time, so it is filled in rather than asked for - but it is a
            // field rather than a fact, because it is what a collaborator clones by and
            // two projects in one folder tree can be called the same thing locally.
            setName(vcsRemoteName(surface.remote) || projectFolderName(context) || "");
        });
        return () => {
            cancelled = true;
        };
    }, [isOpen, surface.remote]);

    /** The server chosen out of the list, as opposed to the address field or nothing yet. */
    const picked = choice === NO_SERVER || choice === MANUAL_SERVER ? null : choice;
    const chosen = picked !== null
        ? (name.trim() === "" ? "" : `${picked}/${name.trim()}`)
        : choice === MANUAL_SERVER ? address.trim() : "";

    const connect = () => {
        if (!chosen) return;
        void surface.setRemote(chosen).then(saved => {
            if (saved) onClose();
        });
    };

    // Adding one signs this installation in, which every project since then picks out of the
    // list above, so it happens in Settings and this dialog steps out of the way. Left open,
    // it would go on showing the list as it was read when it opened.
    const addServer = () => {
        void getInterface().app.launchSettings({ highlight: SERVERS_PANEL_SETTING_KEY });
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={t(`${key}.title`)}
            size="md"
            footer={(
                <div className="flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className={dialogFooterButtonClass({ variant: "secondary" })}
                    >
                        {t("workspace.shell.versionControl.server.cancel")}
                    </button>
                    <button
                        type="button"
                        onClick={connect}
                        disabled={running || chosen === ""}
                        className={dialogFooterButtonClass({
                            variant: "primary",
                            disabled: running || chosen === "",
                        })}
                    >
                        {t("workspace.shell.versionControl.server.save")}
                    </button>
                </div>
            )}
        >
            <div data-vcs-seam="server-picker" className="space-y-3 text-sm text-fg-muted">
                {/* Asked here as well, and this is where it matters most: connecting a server
                    means the history is about to be shared, and one signed by the tool tells a
                    collaborator nothing. Absent the moment it is answered. */}
                <AuthorIdentity surface={surface} />
                {servers.length === 0 && <p>{t(`${key}.empty`)}</p>}
                <div className="flex flex-col gap-1">
                    {servers.map(server => (
                        <button
                            key={server.remoteOrigin}
                            type="button"
                            aria-pressed={choice === server.remoteOrigin}
                            onClick={() => setChoice(server.remoteOrigin)}
                            data-server-choice={server.remoteOrigin}
                            className={cn(
                                "flex min-h-9 items-center justify-between gap-3 rounded-md border px-3 text-left transition-colors cursor-default",
                                choice === server.remoteOrigin
                                    ? "border-primary bg-fill-subtle text-fg"
                                    : "border-edge hover:bg-fill",
                            )}
                        >
                            <span className="min-w-0 flex-1 truncate text-sm">
                                {serverHost(server.remoteOrigin)}
                            </span>
                            <span className="shrink-0 text-xs text-fg-subtle">
                                {server.account.displayName}
                            </span>
                        </button>
                    ))}
                    {/* The last row of the list, not a control beside it: adding a server and
                        choosing one are the same question asked a moment apart, and an author
                        looking at a list that does not hold their server looks at its end. */}
                    <button
                        type="button"
                        onClick={addServer}
                        data-vcs-seam="picker-add"
                        className="flex min-h-9 items-center gap-2 rounded-md border border-dashed border-edge px-3 text-left text-sm transition-colors cursor-default hover:bg-fill hover:text-fg"
                    >
                        <Plus className="h-3.5 w-3.5 shrink-0" />
                        {t(`${key}.add`)}
                    </button>
                </div>

                {picked !== null && (
                    <div>
                        <FieldLabel>{t(`${key}.nameLabel`)}</FieldLabel>
                        <Input
                            size="sm"
                            value={name}
                            onChange={event => setName(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    connect();
                                }
                            }}
                            disabled={running}
                            placeholder={t(`${key}.namePlaceholder`)}
                            className="mt-1"
                        />
                    </div>
                )}

                {/* Below the add row, because a server that can be signed in to is the case
                    this dialog is for. Kept all the same: a `loreserver` with nothing in front
                    of it issues no token, so Settings has nothing to add for it and this field
                    is the only place a project can be pointed at one, or read the address of
                    the one it already uses. */}
                <div data-vcs-seam="picker-address">
                    <button
                        type="button"
                        aria-pressed={choice === MANUAL_SERVER}
                        onClick={() => setChoice(MANUAL_SERVER)}
                        className={cn(
                            "flex min-h-9 w-full items-center rounded-md border px-3 text-left text-sm transition-colors cursor-default",
                            choice === MANUAL_SERVER
                                ? "border-primary bg-fill-subtle text-fg"
                                : "border-edge hover:bg-fill",
                        )}
                    >
                        {t(`${key}.manual`)}
                    </button>
                    {choice === MANUAL_SERVER && (
                        <Input
                            size="sm"
                            autoFocus
                            value={address}
                            onChange={event => setAddress(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    connect();
                                }
                            }}
                            disabled={running}
                            placeholder={t("workspace.shell.versionControl.server.addressPlaceholder")}
                            className="mt-2"
                        />
                    )}
                </div>

                {/* A refusal used to be read off the rail, because the form asking the question
                    was in it. This dialog covers the rail, so the answer has to arrive here or
                    pressing Connect does nothing visible. The sign-in line is the one refusal
                    with a remedy that is not on this screen, and the add row is the way to it. */}
                {surface.failure !== null && (
                    <div data-vcs-seam="picker-failure" className="space-y-1">
                        <p className="break-words text-xs text-danger">{surface.failure.text}</p>
                        {surface.remoteNeedsSignIn && (
                            <p className="text-xs text-fg-subtle">
                                {t("workspace.shell.versionControl.server.signIn.required")}
                            </p>
                        )}
                    </div>
                )}

                {/* Only while a server is already configured: this undoes the connection, and
                    offering it during first setup would be a control for leaving a state the
                    author has not entered. */}
                {surface.remote !== null && (
                    <button
                        type="button"
                        onClick={() => {
                            void surface.setRemote(null).then(saved => {
                                if (saved) onClose();
                            });
                        }}
                        disabled={running}
                        className="text-xs text-fg-subtle transition-colors cursor-default hover:text-danger disabled:opacity-50"
                    >
                        {t("workspace.shell.versionControl.server.disconnect")}
                    </button>
                )}
            </div>
        </Modal>
    );
}

function ServerSection({ surface }: { surface: VersionSurface }) {
    const { t } = useTranslation();
    const { remote, syncState, busy } = surface;
    const [picking, setPicking] = useState(false);
    const running = busy !== null;

    const open = () => setPicking(true);

    if (remote === null) {
        return (
            <div data-vcs-seam="server" className="border-b border-edge px-3 py-2">
                <ServerPickerDialog surface={surface} isOpen={picking} onClose={() => setPicking(false)} />
                <p className="text-2xs text-fg-subtle">
                    {t("workspace.shell.versionControl.server.none")}
                </p>
                <button
                    type="button"
                    onClick={open}
                    disabled={running}
                    className="mt-1.5 flex items-center gap-1.5 text-2xs text-fg-muted transition-colors cursor-default hover:text-fg disabled:opacity-50"
                >
                    <Cloud className="h-3 w-3" />
                    {t("workspace.shell.versionControl.server.connect")}
                </button>
                {/* A server that demands a token refuses to be pointed at until this
                    installation has one, so the address is never written and the row that
                    normally offers a sign-in - the one beside a configured server - is
                    never drawn. Offered here, the only place left, or there is no way in
                    at all to exactly the servers signing in exists for. */}
                {surface.remoteNeedsSignIn && (
                    <>
                        <p className="mt-2 text-2xs text-danger">
                            {t("workspace.shell.versionControl.server.signIn.required")}
                        </p>
                        <SignInSection surface={surface} />
                    </>
                )}
            </div>
        );
    }

    const face = serverFace(syncState);

    return (
        <div data-vcs-seam="server" data-help-topic="versionServer" className="border-b border-edge px-3 py-2">
            <ServerPickerDialog surface={surface} isOpen={picking} onClose={() => setPicking(false)} />
            <div className="group/help flex items-center justify-between gap-2">
                <div className="flex shrink-0 items-center gap-0.5">
                    <span className="text-2xs tracking-wide text-fg-subtle">
                        {t("workspace.shell.versionControl.server.title")}
                    </span>
                    {/* Sending and getting are the two controls in this rail that reach another
                        machine, and the difference between them is the question this answers. */}
                    <HelpTrigger topic="versionServer" className="-my-1 h-5 w-5" />
                </div>
                {/* Editing the address is reachable from the host line itself rather than from a
                    button of its own: it is a once-per-project act, and a 320px row has no space
                    for a control that is pressed twice a year. */}
                <button
                    type="button"
                    onClick={open}
                    disabled={running}
                    data-tip={remote} aria-label={remote}
                    className="min-w-0 truncate text-2xs text-fg-muted transition-colors cursor-default hover:text-fg disabled:opacity-50"
                >
                    {serverHost(remote)}
                </button>
            </div>

            <div className="mt-1 flex items-center gap-1.5">
                <span className={cn("text-2xs", face.tone)}>{t(face.key)}</span>
                <button
                    type="button"
                    onClick={surface.checkRemote}
                    disabled={running}
                    data-tip={t("workspace.shell.versionControl.server.check")}
                    aria-label={t("workspace.shell.versionControl.server.check")}
                    className="ml-auto flex h-5 w-5 items-center justify-center rounded-md text-fg-subtle transition-colors cursor-default hover:bg-fill hover:text-fg disabled:opacity-50"
                >
                    {busy === "remote"
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <RefreshCw className="h-3 w-3" />}
                </button>
            </div>

            <SignInSection surface={surface} />

            {/* Said once, at the moment somebody connects, and as a sentence rather than two
                version numbers to compare. Studio pins a client library and the server runs
                whatever its operator installed; knowing which pairs work is not something to
                ask an author for. */}
            {surface.signIn?.ok && (
                <p
                    data-vcs-seam="server-reach"
                    className={cn(
                        "mt-1.5 text-2xs",
                        surface.signIn.reach === "ready" ? "text-fg-subtle" : "text-warning",
                    )}
                >
                    {t(describeReach(surface.signIn.reach))}
                </p>
            )}

            {/* Both buttons are always present once a server is configured, and neither is hidden
                by what the last check happened to say. The check is optional - the author may
                never press it - so a Send button that only appeared when a stale snapshot said
                "ahead" would be a button that vanished exactly when it was needed. The backend is
                the authority on whether either is possible, and it refuses with a sentence that
                names the remedy. */}
            <div className="mt-2 flex items-center gap-1.5">
                <button
                    type="button"
                    onClick={() => void surface.pushToRemote()}
                    disabled={running}
                    className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md border border-edge px-2 text-2xs text-fg transition-colors cursor-default hover:bg-fill disabled:opacity-50"
                >
                    {busy === "push"
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <CloudUpload className="h-3 w-3" />}
                    {t("workspace.shell.versionControl.server.push")}
                </button>
                <button
                    type="button"
                    onClick={() => void surface.syncFromRemote()}
                    disabled={running}
                    className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md border border-edge px-2 text-2xs text-fg transition-colors cursor-default hover:bg-fill disabled:opacity-50"
                >
                    {busy === "sync"
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <CloudDownload className="h-3 w-3" />}
                    {t("workspace.shell.versionControl.server.sync")}
                </button>
            </div>
        </div>
    );
}

/**
 * The merge this project is in the middle of, and the way into finishing it.
 *
 * **A section of its own rather than a line under the sync button**, for two reasons. A merge
 * outlives the sync that caused it and outlives the window, so it is a state the project is IN -
 * the notification the author dismissed is gone, and the row under a button they may never press
 * again is not where they would look tomorrow. And the server section is absent entirely on a
 * project with no remote, while a merge can be there anyway (the author's own `lore` CLI can start
 * one), so hanging this off it would hide the only way out of that state.
 *
 * **The button is how the author enters resolving, and nothing enters it for them.** A conflicted
 * sync reports and stops; this is the press. Same discipline as never creating a repository on
 * their behalf, and forced by the mechanism too - the paths exist only in the sync's own event
 * stream (docs §4.24), so handing them over has to be deliberate.
 *
 * It does NOT say how many conflicts are left to decide, and that is not an omission: settling a
 * path leaves no readable mark anywhere, so a count here would be the number the merge STARTED
 * with, shown as if it were progress.
 */
function MergeSection({ surface }: { surface: VersionSurface }) {
    const { t, tn } = useTranslation();
    const { context } = useWorkspace();

    if (!surface.merge?.inProgress || !context) {
        return null;
    }

    return (
        <div data-vcs-seam="merge" data-help-topic="versionConflicts" className="border-b border-edge bg-danger/5 px-3 py-2">
            <div className="group/help flex items-center gap-1.5">
                <GitMerge className="h-3 w-3 shrink-0 text-danger" aria-hidden />
                <span className="min-w-0 flex-1 text-2xs tracking-wide text-danger">
                    {t("workspace.shell.versionControl.mergeOpen")}
                </span>
                {/* A state the author did not choose, cannot undo their way out of, and which
                    freezes the project until it is finished. It is worth a `?` of its own. */}
                <HelpTrigger topic="versionConflicts" className="-my-1 h-5 w-5" />
            </div>
            <p className="mt-1 text-2xs text-fg-muted">
                {surface.merge.conflicts.length > 0
                    ? tn("workspace.shell.versionControl.mergeConflicts", surface.merge.conflicts.length)
                    : t("workspace.shell.versionControl.mergeNoConflicts")}
            </p>
            <button
                type="button"
                onClick={() => openVcsChangesTab(context, { mode: "resolve" })}
                className="mt-1.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-danger/40 px-2 text-2xs text-danger transition-colors cursor-default hover:bg-fill"
            >
                <GitMerge className="h-3 w-3" />
                {t("workspace.shell.versionControl.mergeResolve")}
            </button>
        </div>
    );
}

/**
 * What the last check said, as one line.
 *
 * Six states and they are NOT collapsible into "ok / not ok": the remedy differs for every one of
 * them. Unreachable is the author's network, unauthorized is their credentials, diverged needs a
 * sync before a push will work, and "not checked" is the honest answer to a question nobody has
 * asked - which is where this section spends most of its life, because checking costs two seconds
 * and never happens on its own.
 *
 * Ordered by which fact dominates: a server that cannot be reached has no opinion about whether
 * anyone is ahead, and one that refuses us cannot be trusted about that either.
 */
function serverFace(sync: VcsSyncState | null): { key: TranslationKey; tone: string } {
    if (sync === null) {
        return { key: "workspace.shell.versionControl.server.notChecked", tone: "text-fg-subtle" };
    }
    if (!sync.remoteAvailable) {
        return { key: "workspace.shell.versionControl.server.unreachable", tone: "text-danger" };
    }
    if (!sync.remoteAuthorized) {
        return { key: "workspace.shell.versionControl.server.unauthorized", tone: "text-danger" };
    }
    if (sync.localAhead && sync.remoteAhead) {
        return { key: "workspace.shell.versionControl.server.diverged", tone: "text-warning" };
    }
    if (sync.localAhead) {
        return { key: "workspace.shell.versionControl.server.localAhead", tone: "text-fg-muted" };
    }
    if (sync.remoteAhead) {
        return { key: "workspace.shell.versionControl.server.remoteAhead", tone: "text-fg-muted" };
    }
    return { key: "workspace.shell.versionControl.server.upToDate", tone: "text-success" };
}

/**
 * The name a project answers to on its server, read off the address it is pointed at.
 *
 * Empty for a project with no server, and for one whose address is only an origin - a
 * session is stored per origin, so the servers offered in the dialog carry no name.
 */
function vcsRemoteName(remote: string | null): string {
    return remote ? parseVcsRemoteUrl(remote)?.name ?? "" : "";
}

/**
 * What this project is called on disk, as the suggested name on a server.
 *
 * The folder rather than the title: a title has spaces and punctuation in it, and this
 * becomes a name in a URL that a collaborator types.
 */
function projectFolderName(context: { project: { getConfig(): { projectPath: string } } } | null): string {
    const projectPath = context?.project.getConfig().projectPath ?? "";
    const segments = projectPath.split(/[\\/]+/).filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] : "";
}

/**
 * The part of a server address worth showing in a 320px column.
 *
 * The scheme is always `lore://` and says nothing; the host is what tells two servers apart. Falls
 * back to the whole string rather than to nothing when it does not parse - the author typed it, so
 * showing it back verbatim is more useful than showing a blank where their server should be.
 */
function serverHost(url: string): string {
    const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url.trim());
    return match ? match[1] : url.trim();
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
 * Scrolling this list is how the author reaches other versions: scrolling down moves through the
 * linear history. It ends where the read ended, and the control below the last
 * row is what reaches further back.
 *
 * **A row leads with what the version SAYS.** It used to show an icon, `#12` and a short hash, which
 * is the one list in Studio an author cannot use: every row of a day's work looks the same, so the
 * only way to find the version they meant was to open each one in turn. The message has been on
 * `FlatHistoryEntry` since the page started asking for details - the list simply never drew it. The
 * identity moves to a second line where it is still what tells two revisions apart by eye and still
 * matches the switcher menu and the status cell.
 *
 * The header is sticky because the collapse control lives in it: a project with fifty checkpoints
 * pushes "Hide checkpoints" off the top of the same scroller the rows are in, and that control is
 * the way to make the list short again.
 */
function HistoryList({ surface, rows: allRows }: { surface: VersionSurface; rows: FlatHistoryEntry[] }) {
    const { t, locale } = useTranslation();
    const { context } = useWorkspace();
    const { state, compareBase: base } = surface;
    const focused = state.kind === "revision" ? state.revision : state.kind === "current" ? state.head : null;
    const [query, setQuery] = useState("");
    const rows = useMemo(() => filterHistoryRows(allRows, query, t), [allRows, query, t]);
    // Read once per render rather than per row, so a list drawn across midnight cannot label two
    // adjacent days "Today". Not state: nothing here re-renders on the hour, and a list whose
    // separators changed under a reader who had not touched anything would be worse than one that
    // is stale until they do.
    const now = Date.now();
    // The filter is offered once the list is long enough to be worth narrowing, and stays while a
    // query is in it - taking the box away because the query emptied the list is how a filter
    // becomes a trap.
    const filterable = allRows.length >= HISTORY_FILTER_THRESHOLD || query !== "";

    return (
        <div data-vcs-seam="history-list">
            {/* Opaque, not ruled: the rows slide under it because it carries the panel's own
                background, and a line under a sticky header is a border that appears from nowhere
                the moment the list is scrolled.

                Everything that CHANGES the list lives in here rather than above it, and stays
                reachable while the list is scrolled: the collapse, the filter, and the way to drop a
                comparison base. Each of the three can leave the list looking empty, so each of them
                has to be visible from wherever the author ended up. */}
            <div className="sticky top-0 z-10 bg-surface-sunken px-3 pb-1 pt-2">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-2xs tracking-wide text-fg-subtle">
                        {t("workspace.shell.versionControl.history")}
                    </span>
                    {(surface.hiddenCheckpoints > 0 || surface.showCheckpoints) && (
                        <button
                            type="button"
                            onClick={() => surface.setShowCheckpoints(!surface.showCheckpoints)}
                            className="shrink-0 text-2xs text-fg-subtle transition-colors cursor-default hover:text-fg"
                        >
                            {surface.showCheckpoints
                                ? t("workspace.shell.versionControl.hideCheckpoints")
                                : t("workspace.shell.versionControl.showCheckpoints", {
                                    count: String(surface.hiddenCheckpoints),
                                })}
                        </button>
                    )}
                </div>

                {filterable && (
                    <Input
                        size="sm"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        onKeyDown={event => {
                            // Escape empties the box rather than closing anything, which is what it
                            // does in every other filter in the workspace.
                            if (event.key === "Escape" && query !== "") {
                                event.preventDefault();
                                event.stopPropagation();
                                setQuery("");
                            }
                        }}
                        placeholder={t("workspace.shell.versionControl.filterPlaceholder")}
                        aria-label={t("workspace.shell.versionControl.filterPlaceholder")}
                        className="mt-1 text-2xs"
                    />
                )}

                {/* A line of its own rather than a third thing in the row above: the checkpoint
                    control's label is a sentence with a number in it, and a 320px column has no
                    room for both. Present only while a base is chosen, which is rarely. */}
                {base && (
                    <div className="mt-1 flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-2xs text-primary">
                            {t("workspace.shell.versionControl.compareBase.current", { version: base.label })}
                        </span>
                        <button
                            type="button"
                            onClick={() => surface.setCompareBase(null)}
                            data-tip={t("workspace.shell.versionControl.compareBase.clear")}
                            aria-label={t("workspace.shell.versionControl.compareBase.clear")}
                            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors cursor-default hover:bg-fill hover:text-fg"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </div>
                )}
            </div>
            {/* A filter that hides everything says so, rather than leaving a list that looks like a
                project with no history. The two controls that would bring rows back - the filter
                itself and the checkpoint collapse - are both directly above it, and "Show older
                versions" below still reaches further back, which is the only thing this filter
                cannot do on its own. */}
            {rows.length === 0 && (
                <p className="px-3 py-2 text-2xs text-fg-subtle">
                    {t("workspace.shell.versionControl.filterNoMatch", { count: String(allRows.length) })}
                </p>
            )}

            {rows.map((row, index) => {
                const isFocused = row.revision === focused;
                const headline = historyRowHeadline(row, t);
                const time = row.timestamp !== undefined ? formatRevisionTime(row.timestamp, locale) : null;
                // The row BELOW this one in the UNFILTERED list, which is what "the previous
                // version" means to someone reading this: the rows are newest-first and already
                // collapsed, so with checkpoints hidden the comparison is against the previous
                // COMMIT, which is the question an author asks about a commit. Taken from `allRows`
                // rather than from what is on screen - a filter narrows what the author is LOOKING
                // at, and a button that called some distant version "the previous one" because a
                // filter had removed the rows in between would be a sentence that is simply false.
                // Absent on the last row of the page: the version before it has not been read, and
                // comparing against a revision nobody has shown would name one they cannot see.
                const previous = allRows[allRows.indexOf(row) + 1];
                const isBase = base?.revision === row.revision;
                // What this row's compare button compares against. The chosen base wins, and the
                // sentence changes with it: "compare with the previous version" would be a lie the
                // moment the author picked something three weeks back.
                const against = base && !isBase
                    ? {
                        ...base,
                        title: t("workspace.shell.versionControl.compareBase.compare", { version: base.label }),
                    }
                    : !base && previous
                        ? {
                            revision: previous.revision,
                            label: revisionLabel(previous.number),
                            number: previous.number,
                            title: t("documentDiff.rail.compareWithPrevious"),
                        }
                        : null;
                // The first row of a day carries its date. Compared against the row ABOVE in the
                // filtered list, because these separators describe what is on screen: a filtered
                // list is a shorter list, not a list with holes claimed in it.
                const above = rows[index - 1];
                const day = row.timestamp !== undefined
                    && (above?.timestamp === undefined
                        || historyDayKey(above.timestamp) !== historyDayKey(row.timestamp))
                    ? historyDayLabel(row.timestamp, locale, t, now)
                    : null;
                return (
                    <Fragment key={row.revision}>
                    {/* Scanning a version history is scanning for a TIME - "the one before I broke
                        it on Tuesday" - and every row already carried a full timestamp that had to
                        be read one at a time to find the boundary. The separator makes the boundary
                        the thing the eye lands on. Sticky under the header so the day the author is
                        reading stays named while they scroll through it. */}
                    {day && (
                        <div className="sticky top-7 z-[5] bg-surface-sunken px-3 pb-0.5 pt-1.5 text-2xs text-fg-subtle">
                            {day}
                        </div>
                    )}
                    <div className="group relative">
                        <button
                            type="button"
                            onClick={() => surface.showRevision(row.revision, revisionLabel(row.number))}
                            disabled={isFocused || surface.busy !== null}
                            // The whole message plus the hash, because the row shows one truncated line of
                            // the first and none of the second. Without it a version whose message is
                            // longer than the column is a version the author cannot read at all.
                            // `original` is one of Studio's own sentences as it is STORED - absent
                            // unless the row is showing a translation of it, and dropped when the two
                            // are the same string, which they are in English.
                            data-tip={[
                                headline.isIdentity ? null : headline.text,
                                headline.original === headline.text ? null : headline.original,
                                shortRevision(row.revision),
                                isFocused ? null : t("workspace.shell.versionControl.showVersion"),
                            ].filter(Boolean).join("\n")}
                            className={cn(
                                "flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors cursor-default",
                                isFocused
                                    ? "bg-fill-strong text-fg"
                                    : "text-fg-muted hover:bg-fill hover:text-fg",
                            )}
                        >
                            <span className={cn("mt-0.5 w-3 shrink-0", isFocused ? "text-primary" : "text-fg-subtle")}>
                                {row.merge
                                    ? <GitMerge className="h-3 w-3" />
                                    : row.kind === "checkpoint"
                                        ? <Clock className="h-3 w-3" />
                                        : <GitCommitHorizontal className="h-3 w-3" />}
                            </span>
                            <span className="min-w-0 flex-1">
                                {/* No message is the repository's own first commit, and another client may
                                    write none either. It names itself with its hash rather than borrowing
                                    a sentence it does not have. */}
                                <span className={cn(
                                    "block truncate text-xs",
                                    headline.isIdentity ? "font-mono text-fg-subtle" : "",
                                )}>
                                    {headline.text}
                                </span>
                                <span className="mt-0.5 block truncate text-2xs text-fg-subtle">
                                    {[revisionLabel(row.number), time].filter(Boolean).join(" · ")}
                                </span>
                            </span>
                            {row.merge && (
                                <span className="mt-0.5 shrink-0 rounded-md border border-edge px-1 text-2xs text-fg-subtle">
                                    {t("workspace.shell.versionControl.merge")}
                                </span>
                            )}
                        </button>

                        {/* The row's other actions, and the reason they are revealed rather than
                            drawn: a history row's job is to show a version, and two permanent
                            controls on fifty rows in a 320px column would cost width on every one of
                            them to serve presses that happen occasionally.

                            Absolutely positioned rather than flex siblings, so revealing them moves
                            no text - a width that grows on hover is how the row content ends up
                            drifting. `pointer-events-none` while hidden, because invisible targets
                            over the right edge of every row would silently steal the click that
                            shows a version. Still reachable by keyboard: `pointer-events` does not
                            affect tab order, and `focus-visible` brings them back into view.
                            `.nl-focus-ring` because the app's global rule kills `focus:ring-*` on
                            buttons with `!important`, silently. */}
                        {context && (
                            /* ONE chip behind both, not one each. The chip's job is to mask the row
                               text it floats over, and two of them read as two identical grey boxes
                               - which is what they were, because the two lucide git-compare glyphs
                               differ by an arrowhead nobody can see at 14px. So: one surface, and
                               two icons that are not from the same family. */
                            <div className={cn(
                                // OPAQUE, and that is the whole reason for the two nested elements.
                                // `fill` is a translucent overlay, so a chip made of it alone let the
                                // row's own message show through underneath the icons - two glyphs
                                // sitting on top of the word "Merge". The panel's background goes
                                // down first and the row's own tint over it, which composites to
                                // exactly the colour of the row being hovered: the text disappears
                                // and the chip itself does not appear. Same trick, same reason, as
                                // the sticky header these rows scroll under.
                                "absolute right-2 top-1 z-10 rounded-md bg-surface-sunken",
                                "opacity-0 transition-opacity",
                                "pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100",
                                "focus-within:pointer-events-auto focus-within:opacity-100",
                            )}>
                            <div className={cn(
                                "flex items-center gap-0.5 rounded-md p-0.5",
                                isFocused ? "bg-fill-strong" : "bg-fill",
                            )}>
                                {/* Choosing a base is what makes "compare with anything" possible at
                                    all, and it is on every row including the one already chosen -
                                    where it becomes the way to drop it, so an author who set the
                                    wrong one does not have to find the header to undo it.

                                    A pin rather than a second pair of arrows: what this does is HOLD
                                    one version still while the others are compared against it, and
                                    the glyph beside it is already the comparison. `PinOff` on the
                                    row that holds it, because there the only thing left to do is let
                                    go. */}
                                <button
                                    type="button"
                                    onClick={() => surface.setCompareBase(isBase ? null : {
                                        revision: row.revision,
                                        label: revisionLabel(row.number),
                                        number: row.number,
                                    })}
                                    data-tip={isBase
                                        ? t("workspace.shell.versionControl.compareBase.clear")
                                        : t("workspace.shell.versionControl.compareBase.set")}
                                    aria-label={isBase
                                        ? t("workspace.shell.versionControl.compareBase.clear")
                                        : t("workspace.shell.versionControl.compareBase.set")}
                                    className={cn(
                                        "nl-focus-ring flex h-5 w-5 items-center justify-center rounded-md",
                                        "transition-colors cursor-default hover:bg-fill-strong hover:text-fg",
                                        // `fg-muted`, not `fg-subtle`: subtle is the placeholder tone
                                        // and a 14px stroke icon in it, sitting on a `fill` chip,
                                        // came out as an outline with nothing readable inside it.
                                        isBase ? "text-primary" : "text-fg-muted",
                                    )}
                                >
                                    {isBase
                                        ? <PinOff className="h-3.5 w-3.5" />
                                        : <Pin className="h-3.5 w-3.5" />}
                                </button>

                                {/* The comparison itself. Against the chosen base when there is one
                                    and this is not it, otherwise against the row below - and absent
                                    on the last row of a page with no base, because the version
                                    before it has not been read and naming a version the author
                                    cannot see would be worse than offering nothing. */}
                                {against && (
                                    <button
                                        type="button"
                                        onClick={() => openVcsChangesTab(context, {
                                            mode: "between",
                                            // Ordered by revision number rather than by which was
                                            // picked first: a comparison reads old → new whichever
                                            // end the author started from, and a base chosen ABOVE
                                            // the row would otherwise render every addition as a
                                            // deletion.
                                            from: against.number < row.number ? against.revision : row.revision,
                                            to: against.number < row.number ? row.revision : against.revision,
                                            fromLabel: against.number < row.number ? against.label : revisionLabel(row.number),
                                            toLabel: against.number < row.number ? revisionLabel(row.number) : against.label,
                                        })}
                                        data-tip={against.title}
                                        aria-label={against.title}
                                        className={cn(
                                            "nl-focus-ring flex h-5 w-5 items-center justify-center rounded-md",
                                            "text-fg-muted transition-colors cursor-default",
                                            "hover:bg-fill-strong hover:text-fg",
                                        )}
                                    >
                                        <GitCompare className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </div>
                            </div>
                        )}
                    </div>
                    </Fragment>
                );
            })}

            {/* The end of the list, and only there: reaching further back is a thing the author asks
                for, never something a scroll position or a timer decides. Present only while the
                last read filled its limit (`hasMoreHistory`, which counts RAW entries rather than
                these rows). No spinner of its own - the busy line the panel already renders sits
                directly beneath it, and two of them for one read is one too many. */}
            {surface.canLoadMoreHistory && (
                <button
                    type="button"
                    onClick={surface.loadMoreHistory}
                    disabled={surface.busy !== null}
                    className="flex w-full items-center justify-center gap-1.5 px-3 py-1.5 text-2xs text-fg-subtle transition-colors cursor-default hover:bg-fill hover:text-fg disabled:opacity-50"
                >
                    <ChevronDown className="h-3 w-3" />
                    {t("workspace.shell.versionControl.loadMoreHistory")}
                </button>
            )}
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
        case "commit":
            return "workspace.shell.versionControl.committing" as const;
        case "return":
            return "workspace.shell.versionControl.returning" as const;
        case "restore":
            return "workspace.shell.versionControl.restoring" as const;
        case "remote":
            return "workspace.shell.versionControl.server.checking" as const;
        case "push":
            return "workspace.shell.versionControl.server.pushing" as const;
        case "sync":
            return "workspace.shell.versionControl.server.syncing" as const;
    }
}
