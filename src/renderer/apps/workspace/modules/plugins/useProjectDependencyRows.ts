import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAppInfo } from "@/lib/renderApp";
import { useTranslation } from "@/lib/i18n";
import { activateWorkspacePlugin } from "@/lib/plugins/pluginRuntime";
import type { PluginCatalog } from "@/lib/plugins/ui/usePluginCatalog";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { ProjectDependencyService } from "@/lib/workspace/services/core/ProjectDependencyService";
import {
    isActionable,
    isUnmet,
    planDependencyRemedy,
    type DependencyRemedy,
    type DependencyRemedyStep,
} from "@/lib/workspace/project/dependencyRemedy";
import {
    PROJECT_DEPENDENCY_SCHEMA_VERSION,
    type DependencyResolutionEntry,
    type ProjectDependencyTable,
} from "@shared/types/pluginDependencies";
import { resolveDependencies } from "@shared/utils/resolveDependencies";
import type { PluginListItem } from "@shared/types/plugins";
import type { PluginRegistryEntry } from "@shared/types/pluginRegistry";

/** One plugin the project needs, with everything a row has to show about it. */
export interface DependencyRow {
    entry: DependencyResolutionEntry;
    remedy: DependencyRemedy;
    /**
     * What to call it: the installed plugin's own name where there is one, otherwise the name the
     * project recorded when the dependency was written, otherwise the id. A dependency on a plugin
     * nobody has installed is the case the recorded name exists for.
     */
    name: string;
    installed: PluginListItem | null;
    registryEntry: PluginRegistryEntry | null;
}

/** What became of one row in the last run. */
export type DependencyRowOutcome =
    | { status: "working" }
    | { status: "done"; step: DependencyRemedyStep }
    /** The author closed the authorization prompt, or refused it. Nothing happened, and that is an answer. */
    | { status: "canceled" }
    | { status: "failed"; message: string };

export interface ProjectDependencyRows {
    rows: DependencyRow[];
    /** Rows this screen can act on, in the order a run applies them. */
    actionable: DependencyRow[];
    /** How many of the project's plugins contribute nothing as things stand. */
    unavailable: number;
    outcomes: Record<string, DependencyRowOutcome>;
    running: boolean;
    /** Apply the remedies of the given rows, one after another, under a single report. */
    run: (rows: DependencyRow[]) => void;
}

/**
 * The project's dependency table as a list of rows the plugin sidebar can act on.
 *
 * The table comes from the *persisted* resolution rather than a fresh scan: what the project
 * declares is what the author was handed, and a scan needs every plugin loaded to attribute usage -
 * which is exactly what is not true when a dependency is missing. Re-resolving is cheap (it reads
 * the installed list and compares versions) and writes nothing, so it happens on open and after a
 * run.
 */
export function useProjectDependencyRows(
    context: WorkspaceContext | null,
    catalog: PluginCatalog,
    /** False where a change can only be recorded, not started: recovery, and a frozen project. */
    live: boolean,
): ProjectDependencyRows {
    const { t } = useTranslation();
    const [resolved, setResolved] = useState<DependencyResolutionEntry[]>([]);
    const [outcomes, setOutcomes] = useState<Record<string, DependencyRowOutcome>>({});
    const [running, setRunning] = useState(false);

    const service = useMemo(
        () => context?.services.get<ProjectDependencyService>(Services.ProjectDependency) ?? null,
        [context],
    );

    useEffect(() => {
        if (!service) {
            return;
        }
        let active = true;
        const read = () => {
            if (active) {
                setResolved(service.getResolution()?.entries ?? []);
            }
        };
        read();
        // Re-resolve against what is installed right now: the record was resolved when the project
        // opened, and a plugin installed since then is exactly what this screen is for.
        void service.resolve().catch(() => { /* the resolution already on file stands */ });
        const off = service.onResolutionChanged(read);
        return () => { active = false; off(); };
    }, [service]);

    /**
     * The table resolved against the installed list *this panel* is holding.
     *
     * The service's own resolution is a snapshot, refreshed when something asks it to; the catalog's
     * list is re-read after every operation the panel performs. Deriving the rows from the snapshot
     * left a plugin switched off from the list beside this screen still reading as satisfied here,
     * with no remedy offered - the two halves of one panel disagreeing about the same plugin. The
     * resolver is pure and takes no IPC, so running it again over the fresher half costs nothing.
     *
     * The service's entries still stand while the installed list is empty, which is what it is
     * before the first read returns: every dependency would otherwise flash as missing.
     */
    const entries = useMemo<DependencyResolutionEntry[]>(() => {
        if (resolved.length === 0 || catalog.plugins.length === 0) {
            return resolved;
        }
        const table: ProjectDependencyTable = {
            schemaVersion: PROJECT_DEPENDENCY_SCHEMA_VERSION,
            plugins: resolved.map(entry => entry.dependency),
        };
        return resolveDependencies(table, catalog.plugins.map(plugin => ({
            id: plugin.pluginId,
            version: plugin.manifest.version,
            enabled: plugin.enabled,
        }))).entries;
    }, [catalog.plugins, resolved]);

    const registryKnown = catalog.registry !== null;

    const rows = useMemo<DependencyRow[]>(() => entries.map((entry) => {
        const id = entry.dependency.id;
        const installed = catalog.installedById.get(id) ?? null;
        const registryEntry = catalog.registryById.get(id) ?? null;
        return {
            entry,
            installed,
            registryEntry,
            name: installed?.manifest.name
                || entry.dependency.name?.trim()
                || registryEntry?.name
                || id,
            remedy: planDependencyRemedy({
                entry,
                registryEntry,
                registryKnown,
                studioVersion: getAppInfo().version,
                ...(installed ? { installedStatus: installed.status } : {}),
            }),
        };
    }), [catalog.installedById, catalog.registryById, entries, registryKnown]);

    const actionable = useMemo(() => rows.filter(row => isActionable(row.remedy)), [rows]);
    const unavailable = useMemo(() => rows.filter(row => isUnmet(row.entry)).length, [rows]);

    // Read through a ref so the run closure never captures a stale list: every step re-reads the
    // installed set, and the row objects it was handed are from before that.
    const catalogRef = useRef(catalog);
    catalogRef.current = catalog;

    const run = useCallback((selected: DependencyRow[]) => {
        if (!service || selected.length === 0) {
            return;
        }
        void catalogRef.current.runTask(t("plugins.dependencies.task.running"), async () => {
            setRunning(true);
            setOutcomes({});
            const report = (id: string, outcome: DependencyRowOutcome) =>
                setOutcomes(current => ({ ...current, [id]: outcome }));
            const applied: string[] = [];
            let failed = 0;
            try {
                for (const row of selected) {
                    const id = row.entry.dependency.id;
                    report(id, { status: "working" });
                    try {
                        let answered = true;
                        for (const step of row.remedy.steps) {
                            if (step === "enable") {
                                await catalogRef.current.apply.setEnabled(id, true);
                                continue;
                            }
                            if (step === "authorize") {
                                if (!await catalogRef.current.apply.approve(id)) {
                                    answered = false;
                                    break;
                                }
                                continue;
                            }
                            // Install and update are the same call: the main process matches the id
                            // against the registry index it fetched itself and downloads only the
                            // address that index carries.
                            const outcome = await catalogRef.current.apply.installFromStore(id);
                            if (outcome !== "installed") {
                                answered = false;
                                break;
                            }
                        }
                        if (answered) {
                            applied.push(id);
                            report(id, { status: "done", step: row.remedy.steps[0] });
                        } else {
                            report(id, { status: "canceled" });
                        }
                    } catch (error) {
                        failed += 1;
                        report(id, { status: "failed", message: describeError(error) });
                    }
                }

                // A plugin the project suppressed is refused by the loader whatever its switch says,
                // and the verdict is read from this resolution - so it has to be recomputed before a
                // plugin that has just been updated out of that state can start in this window.
                await service.resolve();
                if (live && context) {
                    for (const id of applied) {
                        await activateWorkspacePlugin(context, id);
                    }
                }
            } finally {
                setRunning(false);
            }
            catalogRef.current.setTask(failed > 0
                ? { status: "error", message: t("plugins.dependencies.task.partial") }
                : { status: "success", message: t("plugins.dependencies.task.done") });
        });
    }, [context, live, service, t]);

    return { rows, actionable, unavailable, outcomes, running, run };
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
