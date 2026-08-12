import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, RefreshCw } from "lucide-react";
import { Button, Select, Switch } from "@/lib/components/elements";
import { HelpTrigger, type HelpTopicId } from "@/lib/help";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { cn } from "@/lib/utils/cn";
import { join } from "@shared/utils/path";
import { translate, useTranslation } from "@/lib/i18n";
import {
    deriveGameAppId,
    GAME_BUILD_ARCHS_BY_PLATFORM,
    gameBuildArtifactBaseName,
    hostCanBuildTarget,
    platformFromSystem,
    predictGameBuildArtifacts,
    type BuildPreflightFinding,
    type BuildPreflightSection,
    type BuildPreflightSeverity,
    type GameBuildArch,
    type GameBuildCompression,
    type GameBuildDesktopPlatform,
    type GameBuildFormat,
    type GameBuildPlatform,
    type GameBuildRequest,
} from "@shared/types/gameBuild";
import {
    APP_TAG_OVERRIDE_KEYS,
    isBuiltinAppTagId,
    RELEASE_APP_TAG,
    resolveAppTagIdentity,
    type AppTagBaseIdentity,
    type AppTagIdentity,
    type ProjectAppTag,
} from "@shared/types/appTag";
import type { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import { displayedAppTags } from "@/lib/workspace/services/appTag/appTagDisplay";
import {
    BUILD_COMPRESSIONS,
    SIGNING_PLATFORMS,
    type SigningConfiguration,
} from "@/lib/workspace/project/configuration";
import type { Workspace } from "@/lib/workspace/workspace";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/ui";
import { BuildService } from "@/lib/workspace/services/core/BuildService";
import { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { ProjectDependencyService } from "@/lib/workspace/services/core/ProjectDependencyService";
import {
    DEPENDENCY_STATUS_LABEL_KEYS,
    DEPENDENCY_STATUS_TEXT_STYLES,
    dependencyNeedsAttention,
} from "@/lib/workspace/project/dependencyStatusDisplay";
import type {
    DependencyStatus,
    ProjectDependencyResolution,
    ProjectDependencyTable,
} from "@shared/types/pluginDependencies";
import { getInterface } from "@/lib/app/bridge";
import { openProjectPanel } from "../project";
import {
    appTagSelection,
    BUILD_DIALOG_SECTIONS,
    DESKTOP_PLATFORMS,
    DIALOG_PLATFORMS,
    OFFERED_FORMATS,
    initialDialogState,
    isDesktopPlatform,
    requestToBuildConfiguration,
    stateFromRequest,
    stateToRequest,
    toggleFormat,
    togglePlatform,
    visibleBuildDialogPages,
    type BuildDialogPage,
    type BuildDialogState,
} from "./buildDialogState";
import { BuildIconRow } from "./BuildIconRow";
import { SigningSummary } from "./BuildSigningSection";
import { PROJECT_ICON_TARGETS } from "@shared/types/projectIcons";

/**
 * Which topic answers for each page of the rail.
 *
 * Three of the five sections are about the shipped files rather than about the build: what is inside
 * them, how big they are, and who they say they came from. Those have topics of their own, and the
 * two that are genuinely about the run share the build topic. The variant page decides which edition
 * every page after it describes, which is a subject of its own.
 */
const PAGE_HELP_TOPICS: Record<BuildDialogPage, HelpTopicId> = {
    variant: "buildVariant",
    targets: "build",
    identity: "icons",
    content: "assetProtection",
    signing: "signing",
    output: "build",
};

/** Everything the dialog reads about the project but does not itself own. */
export type BuildDialogInfo = {
    hostPlatform: GameBuildDesktopPlatform;
    hostArch: string;
    /**
     * The project's own name - what the artifacts are named from, together with the selected
     * variant's name. Held rather than a pre-sanitized base name, because the base name depends on
     * a selection this dialog owns; `gameBuildArtifactBaseName` is where the two meet, on both
     * sides of the bridge.
     */
    productName: string;
    appId: string;
    /**
     * The build variants the project has, release first, and the project's own identity that a
     * variant stating nothing inherits.
     *
     * Both are carried so the Identity section can show what the *selected* variant will ship
     * without another round trip: the same fold the pipeline does, on the same three keys.
     */
    appTags: ProjectAppTag[];
    baseIdentity: AppTagBaseIdentity;
    /**
     * Bundled locales; the source locale is flagged.
     *
     * The one thing in the Content section that stays a plain reading. Asset protection and the
     * network policy are two switches this dialog now owns, and the plugin table has one action
     * (rescan) - but which languages ship is decided by the localization panel a translation at a
     * time, and there is nothing here to toggle that would not be a worse version of it.
     */
    locales: { name: string; source: boolean }[];
    /** Absolute default output dir (`<project>/dist`), shown when none is chosen. */
    defaultOutputDir: string;
    electronMirror: string;
};

/**
 * The two project settings the Content section decides, held together because they are written to
 * the same file and so must be written one at a time (see {@link BuildDialogContent}).
 */
export type BuildContentSettings = {
    encryptAssets: boolean;
    allowHttp: boolean;
};

/** One plugin that ships with the game, as the Content section shows it. */
export type BuildPluginEntry = {
    id: string;
    /** Display name captured at authoring time, falling back to the id when the plugin is absent. */
    label: string;
    /** The version the project was authored against - what the game expects to find. */
    version: string;
    /** Absent before the first resolve: the table still says what ships, only not whether it works. */
    status?: DependencyStatus;
    /** True when an unmet hard dependency disables this plugin for the project. */
    suppressed?: boolean;
};

/**
 * Turn a dependency resolution into the section's rows, falling back to the persisted table.
 *
 * The resolution is preferred because it is the only thing that knows whether the plugin the project
 * names is actually installed here, and a plugin that is suppressed ships in a game that cannot use
 * it - which is the one fact about this list worth crossing a dialog for. The table alone is still
 * worth showing when no resolution exists yet: it names what ships.
 */
export function buildPluginEntries(
    resolution: ProjectDependencyResolution | null,
    table?: ProjectDependencyTable | null,
): BuildPluginEntry[] {
    if (resolution) {
        return resolution.entries.map(entry => ({
            id: entry.dependency.id,
            label: entry.dependency.name?.trim() || entry.dependency.id,
            version: entry.dependency.authoredVersion,
            status: entry.status,
            suppressed: entry.suppressed,
        }));
    }
    return (table?.plugins ?? []).map(plugin => ({
        id: plugin.id,
        label: plugin.name?.trim() || plugin.id,
        version: plugin.authoredVersion,
    }));
}

export function BuildDialogContent({
    info,
    initialState,
    initialPage,
    copyright,
    signing,
    initialContent,
    initialPlugins,
    onChange,
    onPersistContent,
    onRescanPlugins,
    onEditIdentity,
    onEditSigning,
    onCommit,
    onCancel,
    runPreflight,
}: {
    info: BuildDialogInfo;
    initialState: BuildDialogState;
    initialPage: BuildDialogPage;
    /**
     * Identity and signing as the project currently records them.
     *
     * Not `initial*` and not state: this dialog reports them and the project panel writes them, so
     * nothing here can change them. `openBuildDialog` re-reads the manifest before building the
     * element, so an edit made in the panel is what the next open shows. The version arrives as part
     * of `info.baseIdentity`, which is what the variant fold reads it from.
     */
    copyright: string;
    signing: SigningConfiguration;
    initialContent: BuildContentSettings;
    initialPlugins: BuildPluginEntry[];
    onChange: (request: GameBuildRequest, page: BuildDialogPage) => void;
    /** Writes one Content setting through. Rejects when it did not land, so the switch can go back. */
    onPersistContent: (patch: Partial<BuildContentSettings>) => Promise<void>;
    /** Re-derives the dependency table from current usage and persists it. */
    onRescanPlugins: () => Promise<BuildPluginEntry[]>;
    /** Closes the dialog and opens the panel page that owns version, copyright and the icons. */
    onEditIdentity: () => void;
    /** Closes the dialog and opens the panel page that owns the signing credentials. */
    onEditSigning: () => void;
    onCommit: (request: GameBuildRequest) => void;
    onCancel: () => void;
    runPreflight: (request: GameBuildRequest) => Promise<BuildPreflightFinding[]>;
}) {
    const { t } = useTranslation();
    const [state, setState] = useState<BuildDialogState>(initialState);
    /** The variant every page after the first one describes. */
    const variant = useMemo(
        () => info.appTags.find(tag => tag.id === state.appTagId) ?? RELEASE_APP_TAG,
        [info.appTags, state.appTagId],
    );
    /**
     * The three identity values as the selected variant will ship them - the same fold the pipeline
     * applies, on the same three keys.
     *
     * Computed once here rather than inside each page, because three of them report it: Variant
     * summarizes what this edition ships, Identity says what the package will claim to be, and
     * Output predicts the file names, which carry the version. Folding more than once is how those
     * would come to disagree.
     */
    const identity = useMemo(
        () => resolveAppTagIdentity(variant, info.baseIdentity),
        [info.baseIdentity, variant],
    );
    /**
     * A project whose only variant is the release one has nothing to pick, so the page that picks is
     * dropped and the walk is what it was before variants existed.
     */
    const pages = useMemo(
        () => visibleBuildDialogPages(info.appTags.some(tag => !isBuiltinAppTagId(tag.id))),
        [info.appTags],
    );
    // A draft parked on a page that is no longer shown (the last variant was deleted meanwhile)
    // lands on the first one instead of on a step the rail cannot reach.
    const [page, setPage] = useState<BuildDialogPage>(
        () => (pages.includes(initialPage) ? initialPage : pages[0]),
    );
    const [findings, setFindings] = useState<BuildPreflightFinding[]>([]);
    // Whether preflight has answered at least once. The variant page reports what is blocking the
    // build, and "nothing" before the first check is a verdict that withdraws itself 250ms later.
    const [checked, setChecked] = useState(false);
    const [content, setContent] = useState<BuildContentSettings>(initialContent);
    const [plugins, setPlugins] = useState<BuildPluginEntry[]>(initialPlugins);
    // Which Content write is in flight, so its own switch spins and the other one waits.
    const [savingContent, setSavingContent] = useState<keyof BuildContentSettings | null>(null);
    const [rescanning, setRescanning] = useState(false);
    // Bumped only once a Content write has landed on disk. Preflight reads the project from the
    // file, so re-checking on the optimistic state would judge the previous one.
    const [contentRevision, setContentRevision] = useState(0);

    const request = useMemo(() => stateToRequest(state), [state]);

    const update = useCallback((next: BuildDialogState) => {
        setState(next);
    }, []);

    /**
     * Write one Content setting, optimistically.
     *
     * Not folded into the debounced identity/signing write below, and not best-effort like it: a
     * switch reports its own state, so a write that fails has to put it back rather than leave the
     * author looking at a promise the project never made. These two decide what ships.
     *
     * One at a time, guarded across both settings rather than per setting: they live in the same
     * manifest and every write is a read-modify-write of the whole file, so two in flight together
     * would have the second clobber the first with a copy read before it landed.
     */
    const commitContent = useCallback(async (field: keyof BuildContentSettings, value: boolean) => {
        if (savingContent) {
            return;
        }
        const previous = content;
        setSavingContent(field);
        setContent(current => ({ ...current, [field]: value }));
        try {
            await onPersistContent({ [field]: value });
            setContentRevision(revision => revision + 1);
        } catch {
            // The caller has already said so; all that is left here is to stop showing the lie.
            setContent(previous);
        } finally {
            setSavingContent(null);
        }
    }, [content, onPersistContent, savingContent]);

    const rescanPlugins = useCallback(async () => {
        if (rescanning) {
            return;
        }
        setRescanning(true);
        try {
            setPlugins(await onRescanPlugins());
            // A rescan writes the table the build reads, so preflight's verdict on it is now stale.
            setContentRevision(revision => revision + 1);
        } catch {
            // Keep the list that was there: it is still what is on disk.
        } finally {
            setRescanning(false);
        }
    }, [onRescanPlugins, rescanning]);

    // Park every change on the service, so closing the dialog (to fix an icon,
    // say) never loses the selection.
    useEffect(() => {
        onChange(request, page);
    }, [onChange, request, page]);

    // Re-check, debounced.
    //
    // This used to persist the identity and signing edits first and then run preflight, because
    // preflight reads the project from disk and would otherwise have judged the previous version.
    // Both are read-only here now - the panel owns those writes - so the ordering problem is gone
    // and only the check is left. `cancelled` keeps a slow reply from overwriting a newer one.
    //
    // The Content section still writes, on its own (a switch cannot wait 250ms to admit it moved),
    // and joins here through `contentRevision`, which it bumps only after its write has landed - so
    // the same "disk first, then judge" order holds for `encryption-key-unavailable` and
    // `web-unprotected`.
    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            void (async () => {
                const result = await runPreflight(request);
                if (!cancelled) {
                    setFindings(result);
                    setChecked(true);
                }
            })();
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [request, runPreflight, contentRevision]);

    // Only the platforms this build actually produces: a credential row for a
    // target nobody selected is a question the author has no reason to answer.
    //
    // The GPG slot is the exception. It is filed under "linux" in the config,
    // but its detached signatures cover every artifact the build writes, not
    // Linux's - so it is offered whenever the build writes anything. Gating it
    // on a Linux target would put it out of reach on a Windows host, which
    // cannot build a Linux target at all.
    const signablePlatforms = useMemo(() => {
        const producesSomething = DIALOG_PLATFORMS.some(platform => state.formats[platform].size > 0);
        return SIGNING_PLATFORMS.filter(platform => (platform === "linux"
            ? producesSomething
            : state.formats[platform].size > 0));
    }, [state.formats]);

    const severityBySection = useMemo(() => {
        const map = {} as Partial<Record<BuildPreflightSection, BuildPreflightSeverity>>;
        for (const finding of findings) {
            if (map[finding.section] !== "error") {
                map[finding.section] = finding.severity === "error" ? "error" : (map[finding.section] ?? "warning");
            }
        }
        return map;
    }, [findings]);

    const blocking = useMemo(() => findings.filter(f => f.severity === "error"), [findings]);

    const commit = () => {
        // Never a disabled button: a build that cannot run sends the user to the
        // reason instead of going grey and silent.
        if (blocking.length > 0) {
            setPage(blocking[0].section);
            return;
        }
        onCommit(request);
    };

    const isLastPage = page === pages[pages.length - 1];

    return (
        // Negative margins undo DialogContainer's content padding so the rail and
        // footer meet the dialog edges; the footer lives here because
        // dialogs.show snapshots `buttons` and could not follow preflight state.
        <div className="-mx-6 -my-4 flex flex-col text-sm">
            <div className="flex h-96 items-stretch">
                <nav className="w-32 shrink-0 space-y-0.5 border-r border-edge p-2">
                    {pages.map(id => (
                        <button
                            key={id}
                            type="button"
                            onClick={() => setPage(id)}
                            className={cn(
                                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs",
                                "transition-colors duration-150",
                                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
                                page === id ? "bg-primary/15 text-fg" : "text-fg-muted hover:bg-fill",
                            )}
                        >
                            <span className="flex-1 truncate">{t(`build.section.${id}`)}</span>
                            {/* No dot on the variant page: no finding names it, and one there would
                                have to stand for a section the author is already being sent to. */}
                            <SeverityDot severity={id === "variant" ? undefined : severityBySection[id]} />
                        </button>
                    ))}
                </nav>

                <div className="min-w-0 flex-1 overflow-y-auto px-4 py-3" data-help-topic={PAGE_HELP_TOPICS[page]}>
                    {page === "variant" && (
                        <VariantPage
                            info={info}
                            state={state}
                            identity={identity}
                            findings={findings}
                            checked={checked}
                            onChange={update}
                            onOpenSection={setPage}
                        />
                    )}
                    {page === "targets" && (
                        <TargetsSection info={info} state={state} findings={findings} onChange={update} />
                    )}
                    {page === "identity" && (
                        <IdentitySection
                            info={info}
                            identity={identity}
                            copyright={copyright}
                            findings={findings}
                            onEdit={onEditIdentity}
                        />
                    )}
                    {page === "content" && (
                        <ContentSection
                            info={info}
                            state={state}
                            content={content}
                            plugins={plugins}
                            saving={savingContent}
                            rescanning={rescanning}
                            findings={findings}
                            onContentChange={(field, value) => { void commitContent(field, value); }}
                            onRescanPlugins={() => { void rescanPlugins(); }}
                        />
                    )}
                    {page === "signing" && (
                        <SigningSummary platforms={signablePlatforms} signing={signing}>
                            <Findings findings={findings} section="signing" />
                            <EditInProject label={t("build.signing.editInProject")} onClick={onEditSigning} />
                        </SigningSummary>
                    )}
                    {page === "output" && (
                        <OutputSection
                            info={info}
                            state={state}
                            variant={variant}
                            identity={identity}
                            findings={findings}
                            onChange={update}
                        />
                    )}
                </div>
            </div>

            <div className="group/help flex items-center justify-end gap-2 border-t border-edge bg-surface-overlay px-6 py-3">
                {/* Answers for the page on screen. A dialog is the one place `F1` is easy to
                    miss, and most of these pages decide something about the shipped files that
                    cannot be seen from the switch itself. */}
                <HelpTrigger topic={PAGE_HELP_TOPICS[page]} className="mr-auto" />
                <Button variant="secondary" onClick={onCancel}>
                    {t("common.cancel")}
                </Button>
                {isLastPage ? (
                    <Button variant="primary" onClick={commit}>
                        {t("build.dialog.start")}
                    </Button>
                ) : (
                    <Button variant="primary" onClick={() => setPage(pages[pages.indexOf(page) + 1])}>
                        {t("common.next")}
                    </Button>
                )}
            </div>
        </div>
    );
}

/** Low-key rail marker; absent when a section is clean. */
function SeverityDot({ severity }: { severity?: BuildPreflightSeverity }) {
    if (!severity) {
        return null;
    }
    return (
        <span
            aria-hidden
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", severity === "error" ? "bg-danger" : "bg-warning")}
        />
    );
}

/** Findings for one section, rendered as plain sentences (no chips). */
/**
 * Detail fields whose value is a platform id, and how many ids each holds.
 *
 * A finding travels as a code plus raw values so the console can render English
 * while the dialog renders the author's language - which means every value that
 * is an internal identifier has to be turned into a name here, not just the one
 * called `platform`. `host` reads "This machine runs macos" untranslated, and
 * `targetPlatform` and the comma-joined `platforms` are the same vocabulary.
 *
 * Listed rather than inferred from the value: "linux" is a platform id and also
 * a plausible substring of something that is not, and guessing would eventually
 * translate a word that was never an id.
 */
const PLATFORM_DETAIL_FIELDS: Record<string, "one" | "list"> = {
    platform: "one",
    host: "one",
    targetPlatform: "one",
    platforms: "list",
};

/** A finding's detail with every platform id replaced by its display name. */
function localizePlatformDetail(
    detail: BuildPreflightFinding["detail"],
    t: ReturnType<typeof useTranslation>["t"],
): Record<string, string> {
    const name = (id: string): string => {
        const key = `build.platform.${id as GameBuildPlatform}` as const;
        // An id from a newer Studio, or one that is not a platform after all:
        // showing it verbatim beats showing a missing-key marker.
        const translated = t(key);
        return translated === key ? id : translated;
    };
    const localized: Record<string, string> = { ...detail };
    for (const [field, arity] of Object.entries(PLATFORM_DETAIL_FIELDS)) {
        const value = detail?.[field];
        if (!value) {
            continue;
        }
        localized[field] = arity === "list"
            ? value.split(",").map(part => name(part.trim())).join(", ")
            : name(value);
    }
    return localized;
}

function Findings({ findings, section }: { findings: BuildPreflightFinding[]; section: BuildPreflightSection }) {
    const { t } = useTranslation();
    const mine = findings.filter(finding => finding.section === section);
    if (mine.length === 0) {
        return null;
    }
    return (
        <div className="grid gap-1">
            {mine.map(finding => (
                <p
                    key={`${finding.code}-${finding.detail?.platform ?? ""}`}
                    className={cn(
                        "whitespace-pre-wrap text-2xs leading-relaxed",
                        finding.severity === "error" ? "text-danger" : "text-fg-subtle",
                    )}
                >
                    {t(`build.preflight.${finding.code}`, localizePlatformDetail(finding.detail, t))}
                </p>
            ))}
        </div>
    );
}

/**
 * Which edition of the project this build is, and what that choice comes to.
 *
 * The first page, and shown only where there is something to choose (see
 * `visibleBuildDialogPages`), because every page after it describes the variant picked here. The
 * summary under the list answers the two questions an author has before walking the rest: what this
 * edition ships as, and what is stopping the build.
 */
function VariantPage({
    info,
    state,
    identity,
    findings,
    checked,
    onChange,
    onOpenSection,
}: {
    info: BuildDialogInfo;
    state: BuildDialogState;
    identity: AppTagIdentity;
    findings: BuildPreflightFinding[];
    /** False until preflight has answered once; see `checked` in {@link BuildDialogContent}. */
    checked: boolean;
    onChange: (next: BuildDialogState) => void;
    onOpenSection: (section: BuildPreflightSection) => void;
}) {
    const { t } = useTranslation();
    const selected = state.appTagId || RELEASE_APP_TAG.id;

    return (
        <div className="grid gap-3">
            {/* The handle stays on the container it was on when this was a `Select`, so anything
                that reads the selection off the dialog keeps reading it in one place. */}
            <div
                role="radiogroup"
                aria-label={t("build.identity.variant")}
                className="grid gap-0.5"
                data-build-app-tag={selected}
            >
                {info.appTags.map(tag => (
                    <button
                        key={tag.id}
                        type="button"
                        role="radio"
                        aria-checked={tag.id === selected}
                        data-build-app-tag-option={tag.id}
                        onClick={() => onChange({ ...state, appTagId: appTagSelection(tag.id) })}
                        className={cn(
                            "flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs",
                            // `.nl-focus-ring` rather than a Tailwind ring: `styles.css` drops
                            // `box-shadow` on every native control, so a ring on a `<button>` is
                            // dead code (design-system §5), and a keyboard walking this list needs
                            // to be visible.
                            "nl-focus-ring transition-colors duration-150",
                            tag.id === selected ? "bg-primary/15 text-fg" : "text-fg-muted hover:bg-fill",
                        )}
                    >
                        <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                    </button>
                ))}
            </div>

            {/* One fact per line, so a further fact about the selected variant is one more line
                rather than a rearrangement. */}
            <div className="grid gap-2 border-t border-edge pt-3">
                {APP_TAG_OVERRIDE_KEYS.map(key => (
                    <VariantFact
                        key={key}
                        label={t(`project.appTags.fields.${key}`)}
                        value={identity[key].value}
                        note={identity[key].overridden
                            ? t("build.identity.fromVariant")
                            : t("build.variant.inherited")}
                    />
                ))}
            </div>

            {checked && <VariantBlocking findings={findings} onOpenSection={onOpenSection} />}
        </div>
    );
}

/** One resolved value of the selected variant, and where it comes from. */
function VariantFact({ label, value, note }: { label: string; value: string; note: string }) {
    const { t } = useTranslation();
    return (
        <Field label={label}>
            <span className="flex min-w-0 items-baseline gap-2">
                {value.trim()
                    ? <span className="min-w-0 truncate text-fg">{value}</span>
                    : <span className="text-2xs text-fg-subtle">{t("build.identity.notSet")}</span>}
                <span className="shrink-0 text-2xs text-fg-subtle">{note}</span>
            </span>
        </Field>
    );
}

/**
 * What is stopping this build, filed under the page that can fix it.
 *
 * Grouped by page rather than listed flat because the remedy is the page: a row is the way there,
 * which is the same journey the Build button makes when it refuses.
 */
function VariantBlocking({
    findings,
    onOpenSection,
}: {
    findings: BuildPreflightFinding[];
    onOpenSection: (section: BuildPreflightSection) => void;
}) {
    const { t } = useTranslation();
    const blocking = findings.filter(finding => finding.severity === "error");

    return (
        <div className="grid gap-1 border-t border-edge pt-3">
            <span className="text-xs text-fg">{t("build.variant.blocking")}</span>
            {blocking.length === 0 ? (
                <span className="text-2xs leading-relaxed text-fg-muted">{t("build.variant.blockingNone")}</span>
            ) : BUILD_DIALOG_SECTIONS.map(section => {
                const mine = blocking.filter(finding => finding.section === section);
                if (mine.length === 0) {
                    return null;
                }
                return (
                    <div key={section} className="grid gap-0.5">
                        <span className="text-2xs text-fg-subtle">{t(`build.section.${section}`)}</span>
                        {mine.map(finding => (
                            <button
                                key={`${finding.code}-${finding.detail?.platform ?? ""}`}
                                type="button"
                                onClick={() => onOpenSection(section)}
                                className={cn(
                                    "w-full rounded-md px-1.5 py-1 text-left",
                                    "whitespace-pre-wrap text-2xs leading-relaxed text-danger",
                                    "nl-focus-ring transition-colors duration-150 hover:bg-fill",
                                )}
                            >
                                {t(`build.preflight.${finding.code}`, localizePlatformDetail(finding.detail, t))}
                            </button>
                        ))}
                    </div>
                );
            })}
        </div>
    );
}

function TargetsSection({
    info,
    state,
    findings,
    onChange,
}: {
    info: BuildDialogInfo;
    state: BuildDialogState;
    findings: BuildPreflightFinding[];
    onChange: (next: BuildDialogState) => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="grid gap-2">
            {DIALOG_PLATFORMS.map(platform => {
                const canBuild = hostCanBuildTarget(info.hostPlatform, platform);
                const enabled = state.formats[platform].size > 0;
                return (
                    <div key={platform} className="rounded-md border border-edge-subtle px-3 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                                <Switch
                                    checked={enabled}
                                    disabled={!canBuild}
                                    onCheckedChange={value => onChange(togglePlatform(state, platform, value))}
                                    size="sm"
                                />
                                <span
                                    className={canBuild ? "text-fg" : "text-fg-subtle"}
                                    // The reason lives in a tooltip: it matters only
                                    // for the row you cannot use, and a permanent
                                    // line of it is noise on every other open.
                                    title={canBuild ? undefined : t(`build.unavailable.${platform}`)}
                                >
                                    {t(`build.platform.${platform}`)}
                                </span>
                            </div>
                            {enabled && canBuild && isDesktopPlatform(platform) && (
                                <Select
                                    size="sm"
                                    value={state.archs[platform]}
                                    onChange={value => onChange({
                                        ...state,
                                        archs: { ...state.archs, [platform]: value as GameBuildArch },
                                    })}
                                    options={GAME_BUILD_ARCHS_BY_PLATFORM[platform].map(arch => ({
                                        value: arch,
                                        label: t(`build.arch.${arch}`),
                                    }))}
                                />
                            )}
                        </div>
                        {enabled && canBuild && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {OFFERED_FORMATS[platform].map(format => (
                                    <FormatPill
                                        key={format}
                                        format={format}
                                        active={state.formats[platform].has(format)}
                                        onClick={() => onChange(toggleFormat(state, platform, format))}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
            <Findings findings={findings} section="targets" />
            <CrossBuildNote info={info} state={state} />
        </div>
    );
}

function FormatPill({
    format,
    active,
    onClick,
}: {
    format: GameBuildFormat;
    active: boolean;
    onClick: () => void;
}) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs",
                "transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
                active ? "bg-primary/15 text-fg" : "bg-fill-subtle text-fg-muted hover:bg-fill hover:text-fg",
            )}
        >
            {active && <Check className="h-3 w-3" />}
            {t(`build.format.${format}`)}
        </button>
    );
}

/** Only shown while a cross target is selected — the mirror matters only then. */
function CrossBuildNote({ info, state }: { info: BuildDialogInfo; state: BuildDialogState }) {
    const { t } = useTranslation();
    const cross = DESKTOP_PLATFORMS.filter(
        platform => platform !== info.hostPlatform
            && state.formats[platform].size > 0
            && hostCanBuildTarget(info.hostPlatform, platform),
    );
    if (cross.length === 0) {
        return null;
    }
    return (
        <p className="text-2xs leading-relaxed text-fg-subtle">
            {`${t("build.arch.label")}: ${info.electronMirror || t("build.mirror.official")}`}
        </p>
    );
}

/**
 * Who the package says it came from, reported rather than asked for.
 *
 * Every field here is read-only. Two of them always were - the product name is the project name and
 * the app id is derived from the identifier - and version and copyright have joined them, because
 * one setting written from two surfaces is a setting that eventually disagrees with itself. They are
 * edited in Project ▸ App now, and the jump at the bottom is how an author gets there without
 * losing the build selection.
 *
 * The section stays in the rail regardless: preflight files `version-invalid`, `version-missing`,
 * `identifier-missing` and every icon finding here, and a finding with no section to render it in is
 * a blocked build with nothing on screen to say why.
 *
 * Which variant these readings are of is picked on the first page. One picker, and it is not here.
 */
function IdentitySection({
    info,
    identity,
    copyright,
    findings,
    onEdit,
}: {
    info: BuildDialogInfo;
    identity: AppTagIdentity;
    copyright: string;
    findings: BuildPreflightFinding[];
    onEdit: () => void;
}) {
    const { t } = useTranslation();
    const versionInvalid = findings.some(finding => finding.code === "version-invalid");
    /*
     * `overridden` is what turns the readings into an answer to "why does this say that": a value the
     * variant states is marked, and an unmarked one is the project's, editable through the jump at
     * the bottom. Without it the section would show a name the App page does not contain and offer
     * no account of where it came from.
     */
    const appId = deriveGameAppId(identity.identifier.value, identity.displayName.value || info.productName);
    return (
        <div className="grid gap-3">
            <Field label={t("build.identity.version")}>
                {/* The error colour is what the `error` input variant used to carry. The sentence
                    itself is in the findings below; this is the pointer to which field it is about. */}
                <ReadValue
                    value={identity.version.value}
                    className={cn("font-mono", versionInvalid && "text-danger")}
                    fromVariant={identity.version.overridden}
                />
            </Field>
            <Field label={t("build.identity.productName")}>
                <span className="text-fg">{identity.displayName.value || info.productName}</span>
                <span className="ml-2 text-2xs text-fg-subtle">
                    {identity.displayName.overridden
                        ? t("build.identity.fromVariant")
                        : t("build.identity.productNameSource")}
                </span>
            </Field>
            <Field label={t("build.identity.appId")}>
                <span className="font-mono text-2xs text-fg-muted">{appId}</span>
                {identity.identifier.overridden ? (
                    <span className="ml-2 text-2xs text-fg-subtle">{t("build.identity.fromVariant")}</span>
                ) : null}
            </Field>
            <Field label={t("build.identity.copyright")}>
                <ReadValue value={copyright} />
            </Field>
            <Field label={t("build.identity.icons")} align="start">
                <div>
                    <div className="flex gap-2">
                        {PROJECT_ICON_TARGETS.map(target => (
                            <BuildIconRow key={target} target={target} onClick={onEdit} />
                        ))}
                    </div>
                    <p className="mt-1.5 text-2xs text-fg-subtle">{t("build.identity.iconsHint")}</p>
                </div>
            </Field>
            <Findings findings={findings} section="identity" />
            <EditInProject label={t("build.identity.editInProject")} onClick={onEdit} />
        </div>
    );
}

/**
 * A value the dialog only reports, saying so when the project has not set one.
 *
 * `fromVariant` marks a value the selected variant states rather than inherits. In words rather than
 * a coloured pill: the reader's question is "why is this not what the App page says", and the answer
 * is a sentence, not a status.
 */
function ReadValue({ value, className, fromVariant }: { value: string; className?: string; fromVariant?: boolean }) {
    const { t } = useTranslation();
    if (!value.trim()) {
        return <span className="text-2xs text-fg-subtle">{t("build.identity.notSet")}</span>;
    }
    return (
        <span>
            <span className={cn("text-fg", className)}>{value}</span>
            {fromVariant ? (
                <span className="ml-2 text-2xs text-fg-subtle">{t("build.identity.fromVariant")}</span>
            ) : null}
        </span>
    );
}

/**
 * The way out of a read-only segment.
 *
 * Follows the icon rows' precedent (see `onEditIdentity` in `openBuildDialog`): the draft is parked
 * on the build service by then, so closing the dialog costs nothing and the next open restores
 * exactly this selection.
 */
function EditInProject({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <Button variant="ghost" size="sm" className="justify-self-start gap-1 px-1.5" onClick={onClick}>
            {label}
            <ChevronRight className="h-3.5 w-3.5" />
        </Button>
    );
}

function Field({
    label,
    align = "center",
    children,
}: {
    label: string;
    align?: "center" | "start";
    children: React.ReactNode;
}) {
    return (
        <div className={cn("flex gap-3", align === "start" ? "items-start" : "items-center")}>
            {/* Wide enough that the longest label ("Product name") stays on one line. */}
            <span className={cn("w-24 shrink-0 text-xs text-fg-muted", align === "start" && "pt-2.5")}>{label}</span>
            <div className="min-w-0 flex-1">{children}</div>
        </div>
    );
}

/**
 * What goes inside the package, and - for the parts that are a decision rather than a consequence -
 * the decision itself.
 *
 * This section used to be five sentences and no controls. Everything it described was settable in
 * Project ▸ Settings and Project ▸ App, so an author who disagreed with what it said had to close
 * the dialog, cross the workspace, change one switch, come back, and walk the rail again - for a
 * question ("does this ship encrypted?") that only ever gets asked here, on the way to a build. The
 * switches are now in the sentence that raised the question.
 *
 * They write the same project settings the panel writes, through the same service, so the two
 * surfaces cannot disagree - and this dialog re-reads the manifest on open, so a change made in the
 * panel is what the author finds here.
 */
export function ContentSection({
    info,
    state,
    content,
    plugins,
    saving,
    rescanning,
    findings,
    onContentChange,
    onRescanPlugins,
}: {
    info: BuildDialogInfo;
    state: BuildDialogState;
    content: BuildContentSettings;
    plugins: BuildPluginEntry[];
    saving: keyof BuildContentSettings | null;
    rescanning: boolean;
    findings: BuildPreflightFinding[];
    onContentChange: (field: keyof BuildContentSettings, value: boolean) => void;
    onRescanPlugins: () => void;
}) {
    const { t } = useTranslation();
    // Every one of these writes `project.json`, so the section goes read-only with the workspace.
    const freeze = useFreezeGuard();
    // The caveat is shown only to the author it applies to. Both switches are about the packaged
    // desktop game; the web export is a static site and honours neither, which is worth a line when
    // web is in the selection and is noise on every other build.
    const buildsWeb = state.formats.web.size > 0;

    return (
        <div className="grid gap-3">
            <Toggled
                label={t("build.content.protection")}
                value={content.encryptAssets ? t("build.content.protectionOn") : t("build.content.protectionOff")}
                checked={content.encryptAssets}
                loading={saving === "encryptAssets"}
                frozen={freeze.writes(saving !== null)}
                onChange={next => onContentChange("encryptAssets", next)}
            />
            <Toggled
                label={t("build.content.network")}
                value={content.allowHttp ? t("build.content.networkAllowHttp") : t("build.content.networkStrict")}
                checked={content.allowHttp}
                loading={saving === "allowHttp"}
                frozen={freeze.writes(saving !== null)}
                onChange={next => onContentChange("allowHttp", next)}
            />
            {buildsWeb && (
                <p className="text-2xs leading-relaxed text-fg-subtle">{t("build.webStaticNotice")}</p>
            )}

            <PluginList
                plugins={plugins}
                rescanning={rescanning}
                frozen={freeze.writes(rescanning)}
                onRescan={onRescanPlugins}
            />

            <Stated
                label={t("build.content.locales")}
                value={info.locales.length > 0
                    ? info.locales
                        .map(locale => locale.source ? t("build.content.localeSource", { name: locale.name }) : locale.name)
                        .join(" · ")
                    : t("build.content.localesNone")}
            />
            <Findings findings={findings} section="content" />
        </div>
    );
}

/** A read-only fact, written out rather than compressed into a chip. */
function Stated({ label, value }: { label: string; value: string }) {
    return (
        <div className="grid gap-0.5">
            <span className="text-xs text-fg">{label}</span>
            <span className="whitespace-pre-wrap text-2xs leading-relaxed text-fg-muted">{value}</span>
        </div>
    );
}

/**
 * {@link Stated}, but the fact is a decision and the sentence is its consequence.
 *
 * The line under the label keeps saying what the current position *means* for the package rather
 * than settling into a fixed description of the setting. The switch already reports on/off; what an
 * author standing in a build dialog wants from the second line is what that costs them, and those
 * two sentences were already written for the read-only version.
 */
function Toggled({
    label,
    value,
    checked,
    loading,
    frozen,
    onChange,
}: {
    label: string;
    value: string;
    checked: boolean;
    loading: boolean;
    /** From `FreezeGuard.writes` - the reason goes on the row, because a disabled switch has no hover. */
    frozen: { disabled: boolean; title: string | undefined };
    onChange: (value: boolean) => void;
}) {
    return (
        <div className="flex items-start justify-between gap-3" title={frozen.title}>
            <div className="grid min-w-0 gap-0.5">
                <span className="text-xs text-fg">{label}</span>
                <span className="whitespace-pre-wrap text-2xs leading-relaxed text-fg-muted">{value}</span>
            </div>
            <Switch
                size="sm"
                className="mt-0.5 shrink-0"
                checked={checked}
                loading={loading}
                disabled={frozen.disabled}
                onCheckedChange={onChange}
                aria-label={label}
            />
        </div>
    );
}

/**
 * The plugins that ship, and the one thing an author can do about the list.
 *
 * There is no "bundle this / do not bundle this" here and there is not one in the project panel
 * either: the table is derived from what the project actually references, never chosen. So what
 * crossing the workspace used to buy was Rescan - re-deriving the table from current usage and
 * writing it - and that is what is offered here.
 *
 * Each row now carries the status the panel shows, which the read-only version dropped. A plugin
 * the project names but this machine cannot honour still ships, in a game that cannot use it; that
 * is worth knowing before the build and not after it.
 */
function PluginList({
    plugins,
    rescanning,
    frozen,
    onRescan,
}: {
    plugins: BuildPluginEntry[];
    rescanning: boolean;
    frozen: { disabled: boolean; title: string | undefined };
    onRescan: () => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="grid gap-1">
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-fg">{t("build.content.plugins")}</span>
                <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 px-1.5"
                    disabled={frozen.disabled}
                    title={frozen.title}
                    onClick={onRescan}
                >
                    <RefreshCw className={cn("h-3.5 w-3.5", rescanning && "animate-spin")} />
                    {t("project.dependencies.rescan")}
                </Button>
            </div>
            {plugins.length === 0 ? (
                <span className="text-2xs leading-relaxed text-fg-muted">
                    {rescanning ? t("project.dependencies.scanning") : t("build.content.pluginsNone")}
                </span>
            ) : (
                <div className="grid gap-0.5">
                    {plugins.map(plugin => (
                        <div key={plugin.id} className="flex items-baseline justify-between gap-3">
                            <span className="min-w-0 truncate text-2xs text-fg-muted">
                                {`${plugin.label} ${plugin.version}`}
                            </span>
                            <PluginStatus plugin={plugin} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/** The status word, and only when there is something to say - see `dependencyNeedsAttention`. */
function PluginStatus({ plugin }: { plugin: BuildPluginEntry }) {
    const { t } = useTranslation();
    if (!plugin.status || !dependencyNeedsAttention(plugin.status, plugin.suppressed ?? false)) {
        return null;
    }
    return (
        <span className={cn("shrink-0 text-2xs font-medium", DEPENDENCY_STATUS_TEXT_STYLES[plugin.status])}>
            {plugin.suppressed
                ? t("project.dependencies.status.disabled")
                : t(DEPENDENCY_STATUS_LABEL_KEYS[plugin.status])}
        </span>
    );
}

export function OutputSection({
    info,
    state,
    variant,
    identity,
    findings,
    onChange,
}: {
    info: BuildDialogInfo;
    state: BuildDialogState;
    variant: ProjectAppTag;
    identity: AppTagIdentity;
    findings: BuildPreflightFinding[];
    onChange: (next: BuildDialogState) => void;
}) {
    const { t } = useTranslation();
    const request = useMemo(() => stateToRequest(state), [state]);
    // The same call the pipeline makes, on the same two names, so a predicted name and the file the
    // build writes cannot differ. A variant that overrides nothing still writes its own files, which
    // is why the prediction changes when the selection does even though nothing else on this page has.
    const artifactBaseName = gameBuildArtifactBaseName(
        info.productName,
        isBuiltinAppTagId(variant.id) ? null : variant.name,
    );
    const artifacts = useMemo(() => predictGameBuildArtifacts({
        artifactBaseName,
        // Mirrors the pipeline's own fallback, so the preview matches a build
        // started with no version set.
        version: identity.version.value.trim() || "0.0.0",
        targets: request.targets,
    }), [artifactBaseName, identity.version.value, request.targets]);

    const browse = async () => {
        const result = await getInterface().gameBuild.selectOutputDir(state.outputDir || info.defaultOutputDir);
        if (result.success && result.data.path) {
            onChange({ ...state, outputDir: result.data.path });
        }
    };

    return (
        <div className="grid gap-3">
            <div className="grid gap-1">
                <span className="text-xs text-fg-muted">{t("build.outputDir")}</span>
                <div className="flex items-center gap-2">
                    <span
                        className="flex-1 truncate rounded-md bg-fill-subtle px-2 py-1.5 text-2xs text-fg"
                        title={state.outputDir || info.defaultOutputDir}
                    >
                        {state.outputDir || info.defaultOutputDir}
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => { void browse(); }}>
                        {t("build.chooseFolder")}
                    </Button>
                </div>
            </div>

            <div className="grid gap-1">
                <span className="text-xs text-fg-muted">{t("build.output.artifacts")}</span>
                {artifacts.length === 0 ? (
                    <span className="text-2xs text-fg-subtle">{t("build.output.artifactsEmpty")}</span>
                ) : (
                    <div className="grid gap-1 rounded-md bg-fill-subtle px-2.5 py-2">
                        {artifacts.map(artifact => (
                            <span key={`${artifact.platform}-${artifact.name}`} className="font-mono text-2xs text-fg-muted">
                                {artifact.name}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-fg">{t("build.output.openWhenDone")}</span>
                <Switch
                    size="sm"
                    checked={state.openWhenDone}
                    onCheckedChange={value => onChange({ ...state, openWhenDone: value })}
                />
            </div>

            <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-fg">{t("build.output.compression")}</span>
                <Select
                    size="sm"
                    value={state.compression}
                    onChange={value => onChange({ ...state, compression: value as GameBuildCompression })}
                    options={BUILD_COMPRESSIONS.map(level => ({
                        value: level,
                        label: t(`build.output.compression${capitalize(level)}` as "build.output.compressionStore"),
                    }))}
                />
            </div>
            <Findings findings={findings} section="output" />
        </div>
    );
}

function capitalize(value: string): string {
    return `${value[0].toUpperCase()}${value.slice(1)}`;
}

/**
 * Open the build configuration dialog (or, when a build is already running, a
 * small status dialog with cancel). Committing starts the build, remembers the
 * selection, and streams progress to the console.
 */
export async function openBuildDialog(workspace: Workspace): Promise<void> {
    const context = workspace.getContext();
    const services = context.services;
    const uiService = services.get<UIService>(Services.UI);
    const buildService = services.get<BuildService>(Services.Build);
    const projectService = services.get<ProjectService>(Services.Project);

    if (buildService.isBuilding()) {
        openBuildInProgressDialog(uiService, buildService);
        return;
    }

    // The dialog only describes what the package will contain, and the pipeline
    // reads the manifest from disk - so this has to too. The cached copy only
    // tracks writes this window made, which let the Content section keep
    // reporting encrypted assets after the setting was turned off elsewhere.
    // Best-effort: an unreadable manifest falls back to the cache rather than
    // blocking the dialog, and preflight still judges the file itself.
    await projectService.reloadProjectConfig().catch(() => undefined);

    const projectConfig = projectService.getProjectConfig();
    const projectPath = context.project.getConfig().projectPath;
    const hostResult = await getInterface().getPlatform();
    const hostPlatform: GameBuildDesktopPlatform = hostResult.success
        ? platformFromSystem(hostResult.data.system)
        : "linux";
    const hostArch = hostResult.success ? hostResult.data.arch : "x64";
    const localization = projectService.getLocalizationConfiguration();
    const productName = projectConfig.name?.trim() || "NarraLeaf Game";
    // A workspace without the service still gets the dialog, with the release variant alone - which
    // is what an unselected build produces anyway.
    let appTagService: AppTagService | null = null;
    try {
        appTagService = services.get<AppTagService>(Services.AppTags);
    } catch (error) {
        console.warn("[build] app tag service unavailable", error);
    }

    const info: BuildDialogInfo = {
        hostPlatform,
        hostArch,
        productName,
        appId: deriveGameAppId(projectConfig.identifier, productName),
        // Release first, straight off the service, so the list here is the list the App page shows.
        // A workspace whose variants could not be read still offers the release one, which is the
        // only variant the pipeline can be certain of anyway.
        // Named for display before it leaves here. `listTags` prepends the synthesized release
        // variant under the model's untranslated word, and this picker sits beside a panel that
        // shows the translated one.
        appTags: displayedAppTags(
            appTagService?.listTags() ?? [RELEASE_APP_TAG],
            translate("project.appTags.releaseName"),
        ),
        baseIdentity: {
            displayName: productName,
            identifier: projectConfig.identifier?.trim() ?? "",
            version: projectConfig.metadata?.version?.trim() ?? "",
        },
        locales: localization.sourceLocale
            ? localization.locales.map(locale => ({
                name: locale.displayName || locale.code,
                source: locale.code === localization.sourceLocale,
            }))
            : [],
        defaultOutputDir: join(projectPath, "dist"),
        electronMirror: "",
    };

    // Seeded from the resolution computed at project open, which resolves the *persisted* table -
    // the same table the build packages. Deliberately not `previewResolve()`, which rescans current
    // usage: that answers "what would ship if you rescanned", which is Rescan's job to offer, not
    // the opening screen's job to claim. A workspace without the service still gets the rest of the
    // dialog, with the table read straight from the manifest and no status beside it.
    let dependencyService: ProjectDependencyService | null = null;
    try {
        dependencyService = services.get<ProjectDependencyService>(Services.ProjectDependency);
    } catch (error) {
        console.warn("[build] plugin dependency service unavailable", error);
    }
    const initialPlugins = buildPluginEntries(
        dependencyService?.getResolution() ?? null,
        projectService.getDependencyTable(),
    );

    // A parked draft wins over the persisted selection: it is what the user was
    // in the middle of, and the only reason they left was to fix something.
    const draft = buildService.getDraft();
    const storedConfig = projectService.getBuildConfiguration();
    const restored = draft
        ? stateFromRequest(draft.request, hostPlatform, hostArch)
        : initialDialogState(storedConfig, hostPlatform, hostArch);
    // A variant deleted since the last build leaves its id in the remembered selection, and the
    // pipeline refuses an id the project does not have. Dropped back to release here, where the list
    // is in hand, rather than left to fail a build the dialog had already shown as ready.
    const initialState: BuildDialogState = info.appTags.some(tag => tag.id === restored.appTagId)
        ? restored
        : { ...restored, appTagId: "" };

    let request: GameBuildRequest = stateToRequest(initialState);
    // The dialog clamps this to a page it is actually showing, which is where the list of variants
    // is in hand.
    let page: BuildDialogPage = draft?.page ?? "variant";

    const dialogId = uiService.dialogs.show({
        title: translate("build.dialog.title"),
        width: 720,
        closable: true,
        // Footer is drawn inside the content: dialogs.show snapshots `buttons`
        // at open time, so it cannot react to preflight state.
        content: (
            <BuildDialogContent
                info={info}
                initialState={initialState}
                initialPage={page}
                copyright={typeof projectConfig.metadata?.copyright === "string" ? projectConfig.metadata.copyright : ""}
                signing={projectService.getSigningConfiguration()}
                initialContent={{
                    encryptAssets: projectService.getSecurityConfiguration().encryptAssets,
                    allowHttp: projectService.getNetworkConfiguration().allowHttp,
                }}
                initialPlugins={initialPlugins}
                onChange={(nextRequest, nextPage) => {
                    request = nextRequest;
                    page = nextPage;
                    buildService.setDraft({ request: nextRequest, page: nextPage });
                }}
                onPersistContent={async patch => {
                    // The dialog's only write, and not a best-effort one. A silently dropped
                    // `encryptAssets` is a switch that says the assets are protected and a package
                    // where they are not. So this says what went wrong and rethrows, and the switch
                    // goes back.
                    //
                    // One field per call - both patches are never sent together (see
                    // `commitContent`), so the two writes never race for the manifest.
                    try {
                        if (patch.encryptAssets !== undefined) {
                            await projectService.updateSecurityConfiguration({ encryptAssets: patch.encryptAssets });
                        }
                        if (patch.allowHttp !== undefined) {
                            await projectService.updateNetworkConfiguration({ allowHttp: patch.allowHttp });
                        }
                    } catch (error) {
                        uiService.showNotification(error instanceof Error ? error.message : String(error), "error");
                        throw error;
                    }
                }}
                onRescanPlugins={async () => {
                    if (!dependencyService) {
                        const message = translate("build.content.pluginsRescanUnavailable");
                        uiService.showNotification(message, "error");
                        throw new Error(message);
                    }
                    try {
                        return buildPluginEntries(await dependencyService.rescanAndPersist());
                    } catch (error) {
                        uiService.showNotification(error instanceof Error ? error.message : String(error), "error");
                        throw error;
                    }
                }}
                onEditIdentity={() => {
                    // The draft is already parked, so closing here is safe: the
                    // next open restores exactly this selection.
                    uiService.dialogs.close(dialogId);
                    openProjectPanel(context, { section: "app" });
                }}
                onEditSigning={() => {
                    // Same bargain as the identity jump. Settings, not App: the credential picker and
                    // the import form live beside the network policy and asset protection, which are
                    // the other two decisions about what leaves this machine.
                    uiService.dialogs.close(dialogId);
                    openProjectPanel(context, { section: "settings" });
                }}
                onCancel={() => {
                    buildService.clearDraft();
                    uiService.dialogs.close(dialogId);
                }}
                onCommit={async committed => {
                    uiService.dialogs.close(dialogId);
                    await startBuild(workspace, committed);
                }}
                runPreflight={nextRequest => buildService.preflight(nextRequest)}
            />
        ),
    });
}

function openBuildInProgressDialog(uiService: UIService, buildService: BuildService): void {
    const dialogId = uiService.dialogs.show({
        title: translate("build.dialog.runningTitle"),
        width: 400,
        closable: true,
        content: (
            <p className="text-sm text-fg-muted leading-relaxed">
                {translate("build.dialog.runningBody")}
            </p>
        ),
        buttons: [
            {
                label: translate("build.dialog.viewConsole"),
                onClick: () => {
                    uiService.panels.show("narraleaf-studio:console");
                    uiService.dialogs.close(dialogId);
                },
            },
            {
                label: translate("build.dialog.cancelBuild"),
                onClick: async () => {
                    uiService.dialogs.close(dialogId);
                    await buildService.cancel();
                },
            },
        ],
    });
}

async function startBuild(workspace: Workspace, request: GameBuildRequest): Promise<void> {
    const services = workspace.getContext().services;
    const uiService = services.get<UIService>(Services.UI);
    const buildService = services.get<BuildService>(Services.Build);
    const projectService = services.get<ProjectService>(Services.Project);

    // Remember the selection for next time (best-effort; never blocks the build).
    void projectService.updateBuildConfiguration(requestToBuildConfiguration(request)).catch(() => undefined);

    uiService.panels.show("narraleaf-studio:console");
    // Submission feedback only — the toolbar's build-status subscriber owns the
    // success/error toast, so the outcome is not double-reported.
    uiService.showNotification(translate("build.toast.submitted"), "info");
    await buildService.start(request);
}
