/**
 * Clean up project: re-run, over the whole project, the work Studio already does one item at a time.
 *
 * In the Run menu beside Test because it is the same kind of thing: it acts on the project rather
 * than launching it, and the author reaches for it before a build, not while writing.
 *
 * The rows are counted before anything is ticked, so the dialog says what each task would touch and
 * a task with nothing to do is greyed rather than offered. Two rows start ticked - the avatars and the
 * cache - because neither changes anything the author wrote: avatars without a framing get one, and
 * the cache is rebuilt as it is needed. Everything below the rule moves or deletes the author's own
 * content, so it waits to be asked for.
 *
 * Comments in English per project convention.
 */

import { useEffect, useState } from "react";
import { Button, Checkbox } from "@/lib/components/elements";
import { translate, useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { formatBytes } from "@shared/utils/formatBytes";
import { cn } from "@/lib/utils/cn";
import type { Workspace } from "@/lib/workspace/workspace";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { HeadFrameDetector } from "@/lib/workspace/services/character/avatarAutoFrame";
import {
    runProjectCleanup,
    scanProjectCleanup,
    type ProjectCleanupOutcome,
    type ProjectCleanupScan,
    type ProjectCleanupTask,
} from "@/lib/workspace/services/cleanup/projectCleanup";

/** Loaded on the first run that frames avatars: onnxruntime-web is not part of opening the menu. */
const detectHeadFrame: HeadFrameDetector = async layers =>
    (await import("@/lib/workspace/services/character/headDetector")).detectHeadFrame(layers);

/** Rows above the rule, then the ones that move or delete what the author wrote. */
const REGENERATE: readonly ProjectCleanupTask[] = ["avatars", "projectCache"];
const REWRITE: readonly ProjectCleanupTask[] = ["blueprintLayout", "danglingNodes", "orphanComments", "orphanTranslations"];
const TICKED_BY_DEFAULT: ReadonlySet<ProjectCleanupTask> = new Set(["avatars", "projectCache"]);

const LABEL_KEYS: Record<ProjectCleanupTask, TranslationKey> = {
    avatars: "actions.cleanup.task.avatars",
    projectCache: "actions.cleanup.task.projectCache",
    blueprintLayout: "actions.cleanup.task.blueprintLayout",
    danglingNodes: "actions.cleanup.task.danglingNodes",
    orphanComments: "actions.cleanup.task.orphanComments",
    orphanTranslations: "actions.cleanup.task.orphanTranslations",
};

/** How much each task would touch, in the unit the author counts it in. Zero means nothing to do. */
function amountOf(scan: ProjectCleanupScan, task: ProjectCleanupTask, overwriteAvatars: boolean): number {
    switch (task) {
        case "avatars":
            return overwriteAvatars ? scan.avatars.all : scan.avatars.unframed;
        case "projectCache":
            return scan.projectCache.bytes;
        case "blueprintLayout":
            return scan.blueprintLayout.blueprints;
        case "danglingNodes":
            return scan.danglingNodes.nodes;
        case "orphanComments":
            return scan.orphanComments.threads;
        case "orphanTranslations":
            return scan.orphanTranslations.units;
    }
}

function ProjectCleanupContent({
    context,
    onCancel,
    onRun,
}: {
    context: WorkspaceContext;
    onCancel: () => void;
    onRun: (tasks: Set<ProjectCleanupTask>, overwriteAvatars: boolean) => void;
}) {
    const { t, tn } = useTranslation();
    const [scan, setScan] = useState<ProjectCleanupScan | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const [ticked, setTicked] = useState<Set<ProjectCleanupTask>>(new Set());
    const [overwriteAvatars, setOverwriteAvatars] = useState(false);

    useEffect(() => {
        let disposed = false;
        scanProjectCleanup(context).then(result => {
            if (disposed) return;
            setScan(result);
            setTicked(new Set([...TICKED_BY_DEFAULT].filter(task => amountOf(result, task, false) > 0)));
        }).catch(error => {
            if (!disposed) setFailed(error instanceof Error ? error.message : String(error));
        });
        return () => {
            disposed = true;
        };
    }, [context]);

    /** A task the author cannot run right now: nothing to do, or the cache is in use. */
    const blocked = (task: ProjectCleanupTask): boolean =>
        !scan || amountOf(scan, task, overwriteAvatars) === 0 || (task === "projectCache" && scan.projectCache.busy);

    const runnable = new Set([...ticked].filter(task => !blocked(task)));

    const amountText = (task: ProjectCleanupTask): string => {
        if (!scan) return "";
        if (task === "projectCache" && scan.projectCache.busy) return t("actions.cleanup.cacheBusy");
        const amount = amountOf(scan, task, overwriteAvatars);
        if (amount === 0) return t("actions.cleanup.nothing");
        switch (task) {
            case "avatars":
                return tn("actions.cleanup.amount.differentials", amount);
            case "projectCache":
                return formatBytes(amount);
            case "blueprintLayout":
                return tn("actions.cleanup.amount.blueprints", amount);
            case "danglingNodes":
                return tn("actions.cleanup.amount.nodes", amount);
            case "orphanComments":
                return tn("actions.cleanup.amount.comments", amount);
            case "orphanTranslations":
                return tn("actions.cleanup.amount.translations", amount);
        }
    };

    const toggle = (task: ProjectCleanupTask, on: boolean) => {
        setTicked(current => {
            const next = new Set(current);
            if (on) next.add(task);
            else next.delete(task);
            return next;
        });
    };

    const row = (task: ProjectCleanupTask) => (
        <div key={task} className="flex flex-col">
            <Checkbox
                checked={ticked.has(task) && !blocked(task)}
                disabled={blocked(task)}
                onCheckedChange={on => toggle(task, on)}
                className="min-h-8 rounded-md px-2 hover:bg-fill"
                data-cleanup-task={task}
            >
                <span className={cn("min-w-0 flex-1 truncate", blocked(task) ? "text-fg-subtle" : "text-fg")}>
                    {t(LABEL_KEYS[task])}
                </span>
                <span className="shrink-0 text-2xs text-fg-subtle">{amountText(task)}</span>
            </Checkbox>
            {/* Under its row rather than a row of its own: it changes what the avatar row counts.
                Never greyed by that row, and ticking it ticks the row: when every differential
                already has a framing, the row has nothing to do until this is on, so making this
                wait for the row would leave neither one reachable. */}
            {task === "avatars" && scan && scan.avatars.all > 0 ? (
                <Checkbox
                    checked={overwriteAvatars}
                    onCheckedChange={on => {
                        setOverwriteAvatars(on);
                        if (on) toggle("avatars", true);
                    }}
                    className="min-h-7 rounded-md pl-8 pr-2 hover:bg-fill"
                >
                    <span className="min-w-0 flex-1 truncate">{t("actions.cleanup.avatarsOverwrite")}</span>
                </Checkbox>
            ) : null}
            {/* The one task nothing can take back, said where it is ticked. */}
            {task === "orphanTranslations" && ticked.has(task) && !blocked(task) ? (
                <span className="pl-8 pr-2 text-2xs text-warning">{t("actions.cleanup.noUndo")}</span>
            ) : null}
        </div>
    );

    return (
        // Negative margins undo DialogContainer's content padding so the footer meets the dialog
        // edges, as the patch and test dialogs end.
        <div className="-mx-6 -my-4 flex min-w-0 flex-col">
            <div className="flex flex-col gap-0.5 px-4 py-3">
                {failed ? (
                    <span className="px-2 py-4 text-xs text-danger">{t("actions.cleanup.scanFailed", { message: failed })}</span>
                ) : !scan ? (
                    <span className="px-2 py-4 text-xs text-fg-subtle">{t("actions.cleanup.scanning")}</span>
                ) : (
                    <>
                        {REGENERATE.map(row)}
                        <div className="mx-2 my-1 h-px bg-edge" />
                        {REWRITE.map(row)}
                    </>
                )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-edge bg-surface-overlay px-6 py-3">
                <Button variant="secondary" onClick={onCancel}>
                    {t("common.cancel")}
                </Button>
                <Button
                    variant="primary"
                    disabled={runnable.size === 0}
                    onClick={() => onRun(runnable, overwriteAvatars)}
                >
                    {t("actions.cleanup.run")}
                </Button>
            </div>
        </div>
    );
}

/** The run's result in one sentence: each task that touched something, in the dialog's order. */
function summarize(outcome: ProjectCleanupOutcome): string {
    const parts: string[] = [];
    const counted = (task: ProjectCleanupTask, key: TranslationKey) => {
        const count = outcome[task];
        if (count) parts.push(translate(key, { count }));
    };
    counted("avatars", "actions.cleanup.done.avatars");
    if (outcome.projectCache) parts.push(translate("actions.cleanup.done.projectCache", { size: formatBytes(outcome.projectCache) }));
    counted("blueprintLayout", "actions.cleanup.done.blueprintLayout");
    counted("danglingNodes", "actions.cleanup.done.danglingNodes");
    counted("orphanComments", "actions.cleanup.done.orphanComments");
    counted("orphanTranslations", "actions.cleanup.done.orphanTranslations");
    return parts.join(translate("actions.cleanup.done.separator"));
}

export function openProjectCleanupDialog(workspace: Workspace): void {
    const context = workspace.getContext();
    const uiService = context.services.get<UIService>(Services.UI);
    const dialogId = uiService.dialogs.show({
        title: translate("actions.cleanup.title"),
        width: 440,
        closable: true,
        helpTopic: "projectCleanup",
        content: (
            <ProjectCleanupContent
                context={context}
                onCancel={() => uiService.dialogs.close(dialogId)}
                onRun={(tasks, overwriteAvatars) => {
                    uiService.dialogs.close(dialogId);
                    void runProjectCleanup(context, { tasks, overwriteAvatars }, detectHeadFrame)
                        .then(outcome => {
                            const summary = summarize(outcome);
                            uiService.showNotification(
                                summary ? translate("actions.cleanup.done.title", { summary }) : translate("actions.cleanup.done.nothing"),
                                "success",
                            );
                        })
                        .catch(error => {
                            uiService.showNotification(
                                translate("actions.cleanup.failed", { message: error instanceof Error ? error.message : String(error) }),
                                "error",
                            );
                        });
                }}
            />
        ),
    });
}
