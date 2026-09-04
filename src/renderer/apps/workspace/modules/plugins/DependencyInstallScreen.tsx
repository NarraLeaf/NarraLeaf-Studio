import type { ReactNode } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { PluginAvatar, statusText } from "@/lib/plugins/ui/pluginPresentation";
import { describeDependencyState } from "@/lib/workspace/project/dependencyStatusDisplay";
import { isUnmet, type DependencyRemedy, type DependencyRemedyStep } from "@/lib/workspace/project/dependencyRemedy";
import type { TranslationKey, Translator } from "@shared/i18n";
import type { DependencyRow, DependencyRowOutcome } from "./useProjectDependencyRows";

/** The control a row offers, by the step it would apply. Borrowed from the store and the switch. */
const STEP_LABEL_KEYS: Record<DependencyRemedyStep, TranslationKey> = {
    install: "plugins.store.install",
    update: "plugins.store.update",
    authorize: "plugins.authorize",
    enable: "common.enable",
};

/** What a row reports once its remedy has been applied. */
const STEP_RESULT_KEYS: Record<DependencyRemedyStep, TranslationKey> = {
    install: "plugins.store.installed",
    update: "plugins.dependencies.updated",
    authorize: "plugins.dependencies.authorized",
    enable: "plugins.status.enabled",
};

export interface DependencyInstallScreenProps {
    rows: DependencyRow[];
    /** The subset a run would act on, in the order it applies them. */
    actionable: DependencyRow[];
    outcomes: Record<string, DependencyRowOutcome>;
    busy: boolean;
    /** The panel's own strips - what it is doing, and the restart banner - which belong here too. */
    notices?: ReactNode;
    registryError: string | null;
    onRetryRegistry: () => void;
    onBack: () => void;
    onOpen: (pluginId: string) => void;
    onRun: (rows: DependencyRow[]) => void;
}

/**
 * The plugin sidebar, showing what this project declares it needs instead of what this machine has.
 *
 * A temporary state of the panel rather than a panel of its own: the list, the store and this are
 * three readings of one set of plugins, and the operations underneath are the same ones. The author
 * leaves by the back control at the top, which returns the panel to its installed list; nothing is
 * held here, so leaving with work outstanding loses nothing - the screen is derived from the
 * project's table and the installed set every time it is opened, and the warning that led here is
 * still standing.
 *
 * Three remedies, never one: a plugin that is absent has to be installed, one at the wrong major
 * has to be updated, one the author switched off has to be enabled. Each row carries its own, and
 * "Install all" applies every row that has one - which is not necessarily every row, because a
 * dependency may name a plugin no registry publishes.
 */
export function DependencyInstallScreen({
    rows,
    actionable,
    outcomes,
    busy,
    notices,
    registryError,
    onRetryRegistry,
    onBack,
    onOpen,
    onRun,
}: DependencyInstallScreenProps) {
    const { t, tn } = useTranslation();
    const unavailable = rows.filter(row => isUnmet(row.entry)).length;

    return (
        <>
            <div className="flex shrink-0 items-center gap-2 border-b border-edge p-2">
                <button
                    type="button"
                    onClick={onBack}
                    className="grid h-7 w-7 shrink-0 cursor-default place-items-center rounded-md text-fg-muted transition-colors hover:bg-fill hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                    aria-label={t("common.back")}
                    data-tip={t("common.back")}
                >
                    <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                    {t("plugins.dependencies.title")}
                </div>
            </div>

            {notices}

            <div className="min-h-0 flex-1 overflow-y-auto" data-dependency-screen>
                {rows.length === 0 ? (
                    <div className="px-6 py-10 text-center text-xs text-fg-muted">
                        {t("project.dependencies.empty")}
                    </div>
                ) : (
                    <>
                        <div
                            className="border-b border-edge-subtle px-3 py-2 text-2xs text-fg-muted"
                            data-dependency-summary
                        >
                            {unavailable > 0
                                ? tn("plugins.dependencies.unavailable", unavailable, { count: unavailable })
                                : t("plugins.dependencies.allReady")}
                        </div>
                        {registryError ? (
                            <div className="flex items-center gap-2 border-b border-edge-subtle px-3 py-2 text-2xs text-warning">
                                <span className="min-w-0 flex-1">{t("plugins.store.offline")}</span>
                                <button
                                    type="button"
                                    onClick={onRetryRegistry}
                                    className="shrink-0 cursor-default rounded-md px-1.5 py-0.5 text-primary hover:bg-fill"
                                >
                                    {t("plugins.store.retry")}
                                </button>
                            </div>
                        ) : null}
                        {rows.map(row => (
                            <DependencyScreenRow
                                key={row.entry.dependency.id}
                                row={row}
                                outcome={outcomes[row.entry.dependency.id] ?? null}
                                busy={busy}
                                onOpen={onOpen}
                                onRun={onRun}
                            />
                        ))}
                    </>
                )}
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-edge px-3 py-2">
                <Button
                    size="sm"
                    variant="primary"
                    disabled={busy || actionable.length === 0}
                    onClick={() => onRun(actionable)}
                    data-dependency-install-all
                >
                    {t("plugins.dependencies.installAll")}
                </Button>
            </div>
        </>
    );
}

function DependencyScreenRow({
    row,
    outcome,
    busy,
    onOpen,
    onRun,
}: {
    row: DependencyRow;
    outcome: DependencyRowOutcome | null;
    busy: boolean;
    onOpen: (pluginId: string) => void;
    onRun: (rows: DependencyRow[]) => void;
}) {
    const { t } = useTranslation();
    const { entry, remedy, name, installed, registryEntry } = row;
    const { dependency } = entry;

    const state = describeDependencyState(entry);
    // A word about the plugin itself, for the states the version verdict cannot see: waiting for
    // authorization, and failed. Taken from the Plugins panel, which already names both.
    const pluginState = !state && installed && installed.status !== "enabled" ? installed.status : null;

    // What is installed is stated only when something is: the state word beside the name already
    // says a plugin is missing, and saying it twice on one row reads as two different facts.
    const meta = [
        t("project.dependencies.meta.requires", { version: dependency.authoredVersion }),
        entry.installedVersion
            ? t("project.dependencies.meta.installed", { version: entry.installedVersion })
            : null,
        dependency.builtIn ? t("project.dependencies.meta.builtIn") : null,
        !dependency.hard ? t("project.dependencies.meta.dataOnly") : null,
    ].filter(Boolean).join("  ·  ");

    // Nothing to show for a plugin that is neither installed nor published: a page that could only
    // repeat the row is worse than a row that does not pretend to lead anywhere.
    const openable = Boolean(installed || registryEntry);
    const step = remedy.steps[0];
    const obstacle = describeObstacle(remedy, t);

    return (
        <section
            className="border-b border-edge-subtle last:border-b-0"
            data-dependency-row={dependency.id}
            data-dependency-remedy={describeRemedy(remedy)}
            data-dependency-outcome={outcome?.status ?? "none"}
        >
            <div
                className={`flex items-center gap-2.5 px-3 py-2 transition-colors ${openable ? "cursor-default hover:bg-fill" : ""}`}
                onClick={openable ? () => onOpen(dependency.id) : undefined}
            >
                <PluginAvatar name={name} src={installed?.iconUrl} size={28} />
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm text-fg">{name}</span>
                        {state ? (
                            <span className={`shrink-0 text-2xs font-medium ${state.className}`} data-dependency-state>
                                {t(state.labelKey)}
                            </span>
                        ) : pluginState ? (
                            <span
                                className={`shrink-0 text-2xs font-medium ${pluginState === "error" ? "text-danger" : "text-warning"}`}
                                data-dependency-state
                            >
                                {statusText(pluginState, t)}
                            </span>
                        ) : null}
                    </div>
                    <div className="truncate text-2xs text-fg-subtle">{meta}</div>
                    {/* Under the row rather than beside it: what stops a plugin being installed is a
                        sentence, and on one line it would push the plugin's own name out of view. */}
                    {obstacle ? <div className="mt-0.5 text-2xs text-fg-muted">{obstacle}</div> : null}
                    {outcome?.status === "failed" ? (
                        <div className="mt-0.5 text-2xs text-danger">{outcome.message}</div>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center" onClick={event => event.stopPropagation()}>
                    <RowControl busy={busy} outcome={outcome} step={step} onRun={() => onRun([row])} />
                </div>
            </div>
        </section>
    );
}

function RowControl({
    busy,
    outcome,
    step,
    onRun,
}: {
    busy: boolean;
    outcome: DependencyRowOutcome | null;
    step: DependencyRemedyStep | undefined;
    onRun: () => void;
}) {
    const { t } = useTranslation();

    if (outcome?.status === "working") {
        return <RefreshCw className="h-3.5 w-3.5 animate-spin text-fg-muted" />;
    }
    if (outcome?.status === "done") {
        return <span className="text-2xs font-medium text-success">{t(STEP_RESULT_KEYS[outcome.step])}</span>;
    }
    if (outcome?.status === "failed") {
        return <span className="text-2xs font-medium text-danger">{t("common.error")}</span>;
    }
    if (step) {
        return (
            <Button size="sm" variant="secondary" disabled={busy} onClick={onRun}>
                {t(STEP_LABEL_KEYS[step])}
            </Button>
        );
    }
    return null;
}

/**
 * Why nothing can be pressed on this row, in words.
 *
 * `registryUnavailable` says nothing: the strip above the list already reports that the registry
 * could not be read, and repeating it once per row would bury it.
 */
function describeObstacle(remedy: DependencyRemedy, t: Translator["t"]): string | null {
    switch (remedy.obstacle) {
        case "notInRegistry":
            return t("plugins.dependencies.notInRegistry");
        case "noCompatibleVersion":
            return t("plugins.dependencies.noCompatibleVersion");
        case "needsStudio":
            return t("plugins.store.needsStudio", { range: remedy.studioRange ?? "" });
        default:
            return null;
    }
}

/** The row's plan as one token, for tests and for reading the panel out of the DOM. */
function describeRemedy(remedy: DependencyRemedy): string {
    if (remedy.steps.length > 0) {
        return remedy.steps.join("+");
    }
    return remedy.obstacle ?? "none";
}
