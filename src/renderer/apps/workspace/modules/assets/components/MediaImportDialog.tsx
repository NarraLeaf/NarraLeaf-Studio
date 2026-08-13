import React, { useCallback, useMemo, useRef, useState } from "react";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements";
import { Progress, ProgressIndeterminate } from "@/lib/components/elements/Progress";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { basename } from "@shared/utils/path";
import { mediaConvertTargetExtension } from "@shared/types/mediaConvert";
import type { MediaImportGroup, MediaImportPlan, MediaImportProblem } from "../state/mediaImportTriage";
import {
    MEDIA_CONVERT_POLL_MS,
    runMediaConversion,
    type MediaConvertBridge,
} from "../state/runMediaConversion";

/**
 * What the author decided, in the form the importer takes.
 *
 * Deliberately not "which button was pressed": every outcome of this dialog is the same thing to the
 * caller - a list of files to import, some scaffolding to delete afterwards, and anything that has
 * to be reported. Cancel is the one exception and is a separate callback, because cancelling imports
 * nothing at all.
 */
export type MediaImportResolution = {
    /** Absolute paths to hand the importer. Converted files stand in for their sources. */
    paths: string[];
    /** Directories holding the converted files, removed once the importer has copied them. */
    scratchDirs: string[];
    /** Files that never reached the importer and are worth naming in the panel afterwards. */
    failures: { path: string; error?: string }[];
};

type ConversionStatus = "waiting" | "converting" | "done" | "failed" | "stopped" | "unavailable";

type ConversionState = {
    status: ConversionStatus;
    /** 0..1, or `null` when the source has no duration. Never a stand-in for "not started". */
    fraction: number | null;
    outputPath?: string;
};

const GROUP_ORDER: readonly MediaImportGroup[] = ["lossless", "lossy", "refused"];

const GROUP_LABEL = {
    lossless: "assets.mediaConvert.group.lossless",
    lossy: "assets.mediaConvert.group.lossy",
    refused: "assets.mediaConvert.group.refused",
} as const;

/** Only the two groups where something happens have an expectation to state. */
const GROUP_HINT = {
    lossless: "assets.mediaConvert.group.losslessHint",
    lossy: "assets.mediaConvert.group.lossyHint",
} as const;

const REFUSAL_LABEL = {
    notMedia: "assets.mediaConvert.refusal.notMedia",
    noStreams: "assets.mediaConvert.refusal.noStreams",
} as const;

const STATE_LABEL = {
    waiting: "assets.mediaConvert.state.waiting",
    done: "assets.mediaConvert.state.done",
    failed: "assets.mediaConvert.state.failed",
    stopped: "assets.mediaConvert.state.stopped",
    unavailable: "assets.mediaConvert.state.unavailable",
} as const;

/**
 * What the author is told about the files they just dropped, before any of them is copied.
 *
 * The alternative this replaces was a per-file sentence rendered into the import strip after the
 * fact: a wall of prose in a narrow panel column, arriving too late to act on, about files that had
 * already been turned away. A refusal an author can do something about has to be a question, and a
 * question needs a dialog.
 *
 * Three lists, in the order the answers cost: files that convert with nothing lost, files that
 * convert by being rebuilt, and files there is nothing to offer for. The third list has no action
 * beside it on purpose - offering one would imply a conversion that cannot exist.
 *
 * Converting happens **in here**, with the dialog still open. The alternative - close, then run the
 * work behind a spinner - hides the one part of this that can take minutes, and leaves nowhere to
 * put a stop button.
 */
export function MediaImportDialog({
    plan,
    onCancel,
    onResolve,
}: {
    /**
     * The files this dialog is about. Never opened with an empty problem list.
     *
     * The caller mounts this component only while there is a plan, rather than passing `null` to a
     * permanently mounted one: half the state here describes a conversion in flight, and a dialog
     * that merely rendered nothing would open the next import still showing the last one's bars.
     */
    plan: MediaImportPlan;
    onCancel: () => void;
    onResolve: (resolution: MediaImportResolution) => void;
}) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    // Every way out of this dialog except Cancel writes into the project, so a freeze that starts
    // while it is open has to reach the buttons - and the conversion loop, which outlives a render.
    const freeze = useFreezeGuard();
    const frozenRef = useRef(freeze.frozen);
    frozenRef.current = freeze.frozen;

    const [converting, setConverting] = useState(false);
    const [states, setStates] = useState<Record<string, ConversionState>>({});
    /** The job in flight and whether a stop was asked for; read by the loop, not by the render. */
    const runRef = useRef<{ stopped: boolean; jobId: string | null }>({ stopped: false, jobId: null });

    const problems = plan.problems;
    const convertible = useMemo(
        () => problems.filter(problem => problem.group !== "refused"),
        [problems],
    );
    const grouped = useMemo(() => GROUP_ORDER.map(group => ({
        group,
        rows: problems.filter(problem => problem.group === group),
    })).filter(entry => entry.rows.length > 0), [problems]);

    /**
     * Whether importing a problem file unconverted still gets the author part of it.
     *
     * This is what decides which secondary action the footer offers. When nothing is partially
     * usable, "import anyway" would produce assets that are dead in every respect, so the honest
     * second choice is to leave them out.
     */
    const anyPartiallyUsable = problems.some(problem => problem.partiallyUsable);

    const patch = useCallback((path: string, next: Partial<ConversionState>) => {
        setStates(previous => ({
            ...previous,
            [path]: { ...(previous[path] ?? { status: "waiting", fraction: null }), ...next },
        }));
    }, []);

    const resolveWith = useCallback((
        extraPaths: readonly string[],
        scratchDirs: readonly string[],
        failures: readonly { path: string; error?: string }[],
    ) => {
        onResolve({
            paths: [...plan.ready, ...extraPaths],
            scratchDirs: [...scratchDirs],
            failures: [...failures],
        });
    }, [onResolve, plan]);

    const bridge = useMemo<MediaConvertBridge>(() => ({
        async start(request) {
            const result = await getInterface().mediaConvert.start(request);
            return result.success ? result.data.state : null;
        },
        async cancel(jobId) {
            await getInterface().mediaConvert.cancel(jobId);
        },
        async getStatus(jobId) {
            const result = await getInterface().mediaConvert.getStatus(jobId);
            return result.success ? result.data.state : null;
        },
    }), []);

    /**
     * Convert every convertible file, one at a time, then import what came out.
     *
     * Sequential rather than parallel: a re-encode saturates the machine on its own, and running
     * four of them at once turns four bars that finish into four bars that crawl.
     */
    const convertAndImport = useCallback(async () => {
        if (!context || converting || frozenRef.current) {
            return;
        }
        setConverting(true);
        runRef.current = { stopped: false, jobId: null };
        setStates(Object.fromEntries(convertible.map(problem =>
            [problem.path, { status: "waiting" as const, fraction: null }])));

        // One directory for the whole run, one subdirectory per file inside it. The converted file
        // keeps the author's own name, because that name becomes the asset's - and two source
        // folders can each hold an `intro.avi`, so the names need somewhere separate to land.
        const scratchId = crypto.randomUUID();
        const scratchAt = (...rest: string[]) =>
            context.project.resolve(ProjectNameConvention.MediaConvertScratchDir(scratchId), ...rest);
        const runDirectory = scratchAt();

        const converted: string[] = [];
        const failures: { path: string; error?: string }[] = [];

        for (const [index, problem] of convertible.entries()) {
            if (runRef.current.stopped || frozenRef.current || !problem.target) {
                break;
            }
            const created = await getInterface().fs.createDir(scratchAt(String(index)));
            if (!created.success || !created.data.ok) {
                patch(problem.path, { status: "failed" });
                failures.push({ path: problem.path, error: t("assets.mediaConvert.failedError") });
                continue;
            }

            const stem = basename(problem.path).replace(/\.[^.]+$/, "");
            const targetPath = scratchAt(
                String(index),
                `${stem}.${mediaConvertTargetExtension(problem.target)}`,
            );

            patch(problem.path, { status: "converting", fraction: null });
            const outcome = await runMediaConversion(
                {
                    sourcePath: problem.path,
                    targetPath,
                    target: problem.target,
                    // Straight from the probe. Without it there is no denominator and the bar has
                    // no percentage to show at all.
                    durationUs: problem.durationUs,
                },
                bridge,
                {
                    onStarted: jobId => { runRef.current.jobId = jobId; },
                    onProgress: fraction => patch(problem.path, { fraction }),
                    wait: () => new Promise(resolve => setTimeout(resolve, MEDIA_CONVERT_POLL_MS)),
                },
            );
            runRef.current.jobId = null;

            if (outcome.status === "done") {
                patch(problem.path, { status: "done", outputPath: outcome.outputPath });
                converted.push(outcome.outputPath);
                continue;
            }
            patch(problem.path, { status: outcome.status });
            if (outcome.status === "failed") {
                failures.push({ path: problem.path, error: t("assets.mediaConvert.failedError") });
            }
            if (outcome.status === "unavailable") {
                // Nothing is wrong with any of these files and nothing will be: the tool is missing,
                // so the rest of the queue would report the same thing one row at a time.
                break;
            }
        }

        resolveWith(converted, [runDirectory], failures);
    }, [bridge, context, convertible, converting, patch, resolveWith, t]);

    const stop = useCallback(() => {
        runRef.current.stopped = true;
        const jobId = runRef.current.jobId;
        if (jobId) {
            void getInterface().mediaConvert.cancel(jobId);
        }
    }, []);

    /** Import the files that were already fine, and leave every problem file out. */
    const skip = useCallback(() => resolveWith([], [], []), [resolveWith]);

    /** Import the problem files untouched, minus the ones there is no point importing. */
    const importAnyway = useCallback(
        () => resolveWith(convertible.map(problem => problem.path), [], []),
        [convertible, resolveWith],
    );

    const title = converting
        ? t("assets.mediaConvert.convertingTitle")
        : convertible.length === 0
            ? t("assets.mediaConvert.titleRefusedOnly")
            : t("assets.mediaConvert.title");

    return (
        <Modal
            isOpen
            onClose={converting ? stop : onCancel}
            title={title}
            helpTopic="mediaConversion"
            size="lg"
            closeOnOverlayClick={false}
            // While the work runs there is no close, only a stop: an X that asked ffmpeg to stop and
            // then left the dialog on screen would read as a broken button.
            showCloseButton={!converting}
            footer={
                <div className="flex justify-end gap-2">
                    {converting ? (
                        <button className={dialogFooterButtonClass({ variant: "secondary" })} onClick={stop}>
                            {t("assets.mediaConvert.stopAction")}
                        </button>
                    ) : (
                        <>
                            {anyPartiallyUsable ? (
                                <button
                                    className={dialogFooterButtonClass({
                                        variant: "secondary",
                                        disabled: freeze.frozen,
                                    })}
                                    {...freeze.writes()}
                                    onClick={importAnyway}
                                >
                                    {t("assets.mediaConvert.importAnywayAction")}
                                </button>
                            ) : plan.ready.length > 0 ? (
                                <button
                                    className={dialogFooterButtonClass({
                                        variant: convertible.length === 0 ? "primary" : "secondary",
                                        disabled: freeze.frozen,
                                    })}
                                    {...freeze.writes()}
                                    onClick={skip}
                                >
                                    {t("assets.mediaConvert.skipAction")}
                                </button>
                            ) : null}
                            {convertible.length > 0 && (
                                <button
                                    className={dialogFooterButtonClass({
                                        variant: "primary",
                                        disabled: freeze.frozen,
                                    })}
                                    {...freeze.writes()}
                                    onClick={() => void convertAndImport()}
                                >
                                    {t("assets.mediaConvert.convertAction")}
                                </button>
                            )}
                            <button className={dialogFooterButtonClass({ variant: "secondary" })} onClick={onCancel}>
                                {t("common.cancel")}
                            </button>
                        </>
                    )}
                </div>
            }
        >
            <div className="space-y-3 py-1">
                <p className="text-xs text-fg-muted">
                    {converting
                        ? t("assets.mediaConvert.convertingIntro")
                        : t("assets.mediaConvert.intro")}
                </p>

                {converting ? (
                    <div className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-1">
                        {convertible.map(problem => (
                            <ConvertingRow
                                key={problem.path}
                                problem={problem}
                                state={states[problem.path] ?? { status: "waiting", fraction: null }}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
                        {grouped.map(({ group, rows }) => (
                            <section key={group} className="space-y-1.5">
                                <h3 className="text-xs font-medium text-fg">{t(GROUP_LABEL[group])}</h3>
                                {group !== "refused" && (
                                    <p className="text-2xs leading-relaxed text-fg-muted">
                                        {t(GROUP_HINT[group])}
                                    </p>
                                )}
                                <ul className="space-y-1">
                                    {rows.map(problem => (
                                        <li
                                            key={problem.path}
                                            className="rounded-md border border-edge bg-fill-subtle px-2.5 py-1.5"
                                            data-tip={problem.path}
                                        >
                                            <span className="block truncate text-xs text-fg">
                                                {basename(problem.path)}
                                            </span>
                                            <span className="block truncate text-2xs text-fg-subtle">
                                                {problem.target
                                                    ? t("assets.mediaConvert.becomes", {
                                                        ext: mediaConvertTargetExtension(problem.target),
                                                    })
                                                    : t(REFUSAL_LABEL[problem.refusal ?? "notMedia"])}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
}

/**
 * One file while the work runs.
 *
 * The bar's fill comes from the **status**, not from the fraction: ffmpeg's last progress block is
 * emitted before it exits and can be well short of the end, so a finished conversion whose bar was
 * driven by the number alone would sit at three quarters forever. A source with no duration gets no
 * percentage at all rather than a made-up one.
 */
function ConvertingRow({ problem, state }: { problem: MediaImportProblem; state: ConversionState }) {
    const { t } = useTranslation();

    return (
        <div className="rounded-md border border-edge bg-fill-subtle px-2.5 py-1.5" data-tip={problem.path}>
            <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-xs text-fg">{basename(problem.path)}</span>
                <span className="shrink-0 text-2xs text-fg-subtle">
                    {state.status === "converting"
                        ? (state.fraction === null ? "" : `${Math.round(state.fraction * 100)}%`)
                        : t(STATE_LABEL[state.status])}
                </span>
            </div>
            <div className="mt-1">
                {state.status === "converting" ? (
                    state.fraction === null
                        ? <ProgressIndeterminate size="sm" />
                        : <Progress value={state.fraction} max={1} size="sm" animated={false} />
                ) : (
                    <Progress
                        value={state.status === "done" ? 1 : 0}
                        max={1}
                        size="sm"
                        variant={state.status === "done" ? "success" : state.status === "failed" ? "error" : "default"}
                        animated={false}
                    />
                )}
            </div>
        </div>
    );
}
