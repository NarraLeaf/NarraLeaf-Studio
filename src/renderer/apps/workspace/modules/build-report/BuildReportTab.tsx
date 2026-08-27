import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, FolderOpen } from "lucide-react";
import { Badge, EmptyState, SearchInput, type BadgeTone } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import type { GameBuildPlatform, LastGameBuildRun, ShippedAssetReportEntry } from "@shared/types/gameBuild";
import { RELEASE_APP_TAG } from "@shared/types/appTag";
import { revealInFileManagerKey } from "@/lib/app/platform";
import { BuildService } from "@/lib/workspace/services/core/BuildService";
import { Services } from "@/lib/workspace/services/services";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { useWorkspace } from "../../context";
import { DashboardSection, StatTile } from "../dashboard/DashboardPrimitives";
import { formatByteSize } from "../asset-overview/assetOverviewModel";
import {
    buildArtifactRows,
    filterShippedAssets,
    formatBuildDuration,
    groupShippedAssets,
    shippedAssetReport,
    totalArtifactBytes,
    type ShippedAssetGroup,
} from "./buildReportModel";

/**
 * Rows of one type shown before the group has to be asked to show the rest.
 *
 * A library can hold a few thousand assets, and a page that printed every one of them would be a
 * page nobody reads. The rows are ordered heaviest first, so the ones this cap hides are the ones
 * worth the least - and the search box reaches any of them by name.
 */
const GROUP_ROW_LIMIT = 50;

const OUTCOME_TONE: Record<"done" | "error" | "cancelled", BadgeTone> = {
    done: "success",
    error: "danger",
    cancelled: "neutral",
};

const OUTCOME_LABEL_KEYS: Record<"done" | "error" | "cancelled", TranslationKey> = {
    done: "build.report.outcome.done",
    error: "build.report.outcome.error",
    cancelled: "build.report.outcome.cancelled",
};

const ASSET_TYPE_VALUES = new Set<string>(Object.values(AssetType));

/**
 * What one finished build produced, and what it carried out of the asset library.
 *
 * A scrolling document rather than the one control row over one windowed list that the lint and test
 * reports use: those answer one question about one kind of thing, and this answers four - what was
 * produced, what shipped, what did not, and which characters went with it. Sections are the shape
 * the dashboard and the asset overview already use for exactly that.
 *
 * What the shape is defending:
 *
 *  - **The excluded list opens, the carried list stays folded.** An author opens this page to check
 *    that nothing they meant to ship was left behind; the carried list is the corroboration, and
 *    corroboration does not need to be the first thing on the screen.
 *  - **Both lists are grouped by type and ordered by size.** The one excluded asset that matters is
 *    almost always the largest, and a list ordered by name buries it among icons.
 *  - **A run that narrowed nothing says so.** Previews and older builds carry no asset report, and
 *    an empty list in place of one would read as a build that shipped no assets at all.
 *  - **The page describes the last run that finished, not the one now running.** Starting a second
 *    build leaves this reading the first until the second ends.
 */
export function BuildReportTab() {
    const { t, tn, formatNumber } = useTranslation();
    const { context, isInitialized } = useWorkspace();

    const buildService = useMemo(
        () => (context && isInitialized ? context.services.get<BuildService>(Services.Build) : null),
        [context, isInitialized],
    );

    const [run, setRun] = useState<LastGameBuildRun | null>(null);

    /**
     * The recorded run, re-read whenever one finishes.
     *
     * From the record rather than from this session, so the page has something to show the morning
     * after: a build made yesterday is still the last one this project produced.
     */
    useEffect(() => {
        if (!buildService) {
            setRun(null);
            return;
        }
        let current = true;
        const load = () => {
            void buildService.loadLastRun().then(next => {
                if (current) {
                    setRun(next);
                }
            });
        };
        load();
        const stop = buildService.onStateChanged(state => {
            if (state.status === "done" || state.status === "error") {
                load();
            }
        });
        return () => {
            current = false;
            stop();
        };
    }, [buildService]);

    /**
     * The variant's own name, as it was when the run happened. Untranslated by design - a build
     * compares `AppTag` against it - and read off the record rather than resolved again, because a
     * variant renamed since does not change what this run was.
     */
    const variantName = run?.appTagName?.trim() || RELEASE_APP_TAG.name;

    if (!run) {
        return (
            <div className="flex h-full min-h-0 flex-col bg-surface" data-help-topic="build">
                <EmptyState title={t("build.report.empty")} />
            </div>
        );
    }

    const state = run.state;
    const outcome = run.cancelled ? "cancelled" : state.status === "done" ? "done" : "error";
    const artifacts = buildArtifactRows(state);
    const measured = artifacts.filter(artifact => artifact.bytes !== undefined).length;
    const platforms = state.platforms ?? [];
    const duration = formatBuildDuration(state, t);
    const report = shippedAssetReport(state);

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface" data-help-topic="build">
            <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
                <Badge className="shrink-0" tone={OUTCOME_TONE[outcome]}>{t(OUTCOME_LABEL_KEYS[outcome])}</Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">
                    {t(run.kind === "patch" ? "build.report.kind.patch" : "build.report.kind.build")}
                </span>
                {duration ? <span className="shrink-0 tabular-nums text-2xs text-fg-subtle">{duration}</span> : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex flex-col gap-5 px-3 py-3">
                    <DashboardSection title={t("build.report.summary")}>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <StatTile label={t("build.report.variant")} value={variantName} />
                            <StatTile
                                label={t("build.report.platforms")}
                                value={platforms.length > 0 ? platforms.map(platform => t(platformLabelKey(platform))).join(" · ") : "—"}
                            />
                            <StatTile label={t("build.report.duration")} value={duration || "—"} />
                            <StatTile
                                label={t("build.report.artifacts")}
                                value={formatNumber(artifacts.length)}
                                hint={measured > 0 ? formatByteSize(totalArtifactBytes(artifacts)) : undefined}
                            />
                        </div>

                        {state.outputDir ? (
                            <OutputFolderRow path={state.outputDir} onReveal={() => buildService?.revealLastOutput()} />
                        ) : null}

                        {artifacts.length === 0 ? (
                            <p className="text-2xs text-fg-subtle">{t("build.report.artifactsEmpty")}</p>
                        ) : (
                            <ul className="flex flex-col gap-0.5">
                                {artifacts.map(artifact => (
                                    <li
                                        key={artifact.path}
                                        className="flex items-baseline gap-2 rounded-md px-1.5 py-1"
                                        data-tip={artifact.path}
                                    >
                                        <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{artifact.name}</span>
                                        <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">
                                            {artifact.bytes === undefined ? t("build.size.unknown") : formatByteSize(artifact.bytes)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </DashboardSection>

                    {outcome === "error" && state.error ? (
                        <DashboardSection title={t("build.report.failure")}>
                            <p className="nl-selectable-text whitespace-pre-wrap rounded-md border border-edge bg-fill-subtle px-3 py-2 text-xs text-fg-muted">
                                {state.error}
                            </p>
                        </DashboardSection>
                    ) : null}

                    {report === null ? (
                        <p className="text-xs text-fg-subtle">{t("build.report.wholeLibrary")}</p>
                    ) : (
                        <>
                            <ShippedAssetSection
                                title={t("build.report.excludedTitle")}
                                emptyLabel={t("build.report.excludedEmpty")}
                                entries={report.excluded}
                                bytes={report.excludedBytes}
                                initiallyOpen
                            />
                            <ShippedAssetSection
                                title={t("build.report.includedTitle")}
                                emptyLabel={t("build.report.includedEmpty")}
                                entries={report.included}
                                bytes={report.includedBytes}
                            />
                            {report.excludedCharacters.length > 0 ? (
                                <DashboardSection
                                    title={t("build.report.charactersTitle")}
                                    description={tn("assets.itemCount", report.excludedCharacters.length)}
                                >
                                    <ul className="flex flex-col gap-0.5">
                                        {report.excludedCharacters.map(character => (
                                            <li
                                                key={character.id}
                                                className="flex items-baseline gap-2 rounded-md px-1.5 py-1"
                                                data-tip={character.id}
                                            >
                                                <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                                                    {character.name}
                                                </span>
                                            </li>
                                        ))}
                                    </ul>
                                </DashboardSection>
                            ) : null}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * The output folder, and the one thing that can be done with the path from here.
 *
 * The path copies rather than opens: revealing a folder is a main-process operation, and the only
 * one the renderer can reach reveals the project rather than an arbitrary directory. A build that
 * was asked to open its output folder when done has already done so.
 */
function OutputFolderRow({ path, onReveal }: { path: string; onReveal: () => void }) {
    const { t } = useTranslation();
    return (
        <div className="flex items-baseline gap-2 rounded-md border border-edge bg-fill-subtle px-3 py-2">
            <span className="shrink-0 text-2xs text-fg-subtle">{t("build.report.outputDir")}</span>
            <span className="nl-selectable-text min-w-0 flex-1 truncate font-mono text-2xs text-fg-muted" data-tip={path}>
                {path}
            </span>
            <button
                type="button"
                data-tip={t(revealInFileManagerKey())}
                aria-label={t(revealInFileManagerKey())}
                onClick={onReveal}
                className="shrink-0 rounded-md p-0.5 text-fg-subtle hover:bg-fill hover:text-fg-muted"
            >
                <FolderOpen className="h-3 w-3" />
            </button>
        </div>
    );
}

/**
 * One of the two asset lists: a search box in the section header, then a foldable group per type.
 *
 * The search box sits in the header rather than in a row of its own, so two lists on one page cost
 * two headers instead of two headers and two bars. A search unfolds every group it matches, because
 * a hit hidden inside a folded group reads as no hit at all.
 */
function ShippedAssetSection({
    title,
    emptyLabel,
    entries,
    bytes,
    initiallyOpen = false,
}: {
    title: string;
    emptyLabel: string;
    entries: readonly ShippedAssetReportEntry[];
    bytes: number;
    initiallyOpen?: boolean;
}) {
    const { t, tn } = useTranslation();
    const [query, setQuery] = useState("");
    const [openTypes, setOpenTypes] = useState<ReadonlySet<string>>(() => new Set());
    const [expandedTypes, setExpandedTypes] = useState<ReadonlySet<string>>(() => new Set());

    const groups = useMemo(
        () => groupShippedAssets(filterShippedAssets(entries, query)),
        [entries, query],
    );

    const searching = query.trim().length > 0;
    const toggle = useCallback((type: string) => {
        setOpenTypes(previous => {
            const next = new Set(previous);
            if (!next.delete(type)) {
                next.add(type);
            }
            return next;
        });
    }, []);

    // `openTypes` holds whatever the reader changed, so it means "folded" in a section that starts
    // open and "unfolded" in one that starts folded. A search overrides both.
    const isOpen = (type: string) => searching || initiallyOpen !== openTypes.has(type);

    return (
        <DashboardSection
            title={title}
            description={`${tn("assets.itemCount", entries.length)} · ${formatByteSize(bytes)}`}
            actions={
                entries.length > 0 ? (
                    <SearchInput
                        size="sm"
                        className="w-44"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder={t("build.report.search")}
                        aria-label={t("build.report.search")}
                    />
                ) : undefined
            }
        >
            {groups.length === 0 ? (
                <p className="text-2xs text-fg-subtle">{searching ? t("build.report.noMatches") : emptyLabel}</p>
            ) : (
                <ul className="flex flex-col gap-1">
                    {groups.map(group => (
                        <ShippedAssetGroupRow
                            key={group.type}
                            group={group}
                            open={isOpen(group.type)}
                            expanded={expandedTypes.has(group.type)}
                            onToggle={() => toggle(group.type)}
                            onExpand={() => setExpandedTypes(previous => new Set(previous).add(group.type))}
                        />
                    ))}
                </ul>
            )}
        </DashboardSection>
    );
}

function ShippedAssetGroupRow({
    group,
    open,
    expanded,
    onToggle,
    onExpand,
}: {
    group: ShippedAssetGroup;
    open: boolean;
    expanded: boolean;
    onToggle: () => void;
    onExpand: () => void;
}) {
    const { t, tn } = useTranslation();
    const shown = expanded ? group.entries : group.entries.slice(0, GROUP_ROW_LIMIT);
    const hidden = group.entries.length - shown.length;

    return (
        <li className="flex flex-col">
            <button
                type="button"
                className="flex w-full cursor-default items-baseline gap-2 rounded-md px-1.5 py-1 text-left hover:bg-fill-subtle"
                aria-expanded={open}
                onClick={onToggle}
            >
                <ChevronDown className={cn("h-3 w-3 shrink-0 self-center text-fg-subtle transition-transform", !open && "-rotate-90")} />
                <span className="min-w-0 truncate text-xs font-medium text-fg-muted">{assetTypeLabel(group.type, t)}</span>
                <span className="min-w-0 flex-1 text-2xs text-fg-subtle">{tn("assets.itemCount", group.entries.length)}</span>
                <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">{formatByteSize(group.bytes)}</span>
            </button>
            {open ? (
                <ul className="ml-2 flex flex-col border-l border-edge pl-3">
                    {shown.map(entry => (
                        <li
                            key={entry.id}
                            className="flex items-baseline gap-2 rounded-md px-1.5 py-0.5"
                            data-tip={entry.id}
                        >
                            <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{entry.name}</span>
                            <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">
                                {entry.bytes === undefined ? t("build.size.unknown") : formatByteSize(entry.bytes)}
                            </span>
                        </li>
                    ))}
                    {hidden > 0 ? (
                        <button
                            type="button"
                            className="mt-0.5 self-start rounded-md px-1.5 py-0.5 text-2xs text-fg-subtle hover:bg-fill-subtle hover:text-fg-muted"
                            onClick={onExpand}
                        >
                            {t("build.report.showAll", { count: group.entries.length })}
                        </button>
                    ) : null}
                </ul>
            ) : null}
        </li>
    );
}

/** The library's own word for a shard, where the report names one this Studio knows. */
function assetTypeLabel(type: string, t: (key: TranslationKey) => string): string {
    return ASSET_TYPE_VALUES.has(type) ? t(`assets.types.${type}` as TranslationKey) : type;
}

function platformLabelKey(platform: GameBuildPlatform): TranslationKey {
    return `build.platform.${platform}` as TranslationKey;
}
