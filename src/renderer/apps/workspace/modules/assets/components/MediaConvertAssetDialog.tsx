import React, { useCallback, useMemo, useRef, useState } from "react";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements";
import { Progress, ProgressIndeterminate } from "@/lib/components/elements/Progress";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import type { MediaSupportService } from "@/lib/workspace/services/media/MediaSupportService";
import type { MediaAssetSupportRecord } from "@/lib/workspace/services/media/mediaAssetSupport";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { mediaConvertTargetExtension } from "@shared/types/mediaConvert";
import {
    MEDIA_CONVERT_POLL_MS,
    runMediaConversion,
    type MediaConvertBridge,
} from "../state/runMediaConversion";

/**
 * Converting one asset that is already in the library.
 *
 * The import dialog's counterpart, and deliberately **not** a second copy of it: the transcoding
 * loop is the same `runMediaConversion`, the same `MediaConvertManager` behind it, and the swap at
 * the end is `AssetsService.replaceAssetContent`, which every other "point this asset at different
 * bytes" path already goes through. What is different is only what happens either side of the
 * conversion. An import produces a new asset from a file the author is holding; this replaces the
 * bytes of one that already exists, keeping its id - so every story row, widget and blueprint pin
 * that referenced it keeps working, with no relinking to do and none possible to get wrong.
 *
 * `replaceAssetContent` also renames the record: an `intro.avi` that becomes WebM ends up called
 * `intro.webm`, because the extension is what the packer writes into the shipped filename and the
 * iOS shell picks its MIME type from.
 *
 * There is no asset history, so this cannot be undone. The single primary button and the sentence
 * above it are what say so; a warning paragraph would say it worse.
 */

type Phase = "idle" | "converting" | "replacing" | "failed" | "stopped" | "unavailable";

export function MediaConvertAssetDialog({
    asset,
    record,
    onClose,
    onConverted,
}: {
    asset: Asset;
    /** Always a `convertible` record: the caller does not open this for anything else. */
    record: MediaAssetSupportRecord;
    onClose: () => void;
    onConverted: () => void;
}) {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    // Re-checked at the moment of the write as well as on the button: this dialog is a
    // conversation, and a working-tree re-read can begin while it is on screen.
    const freeze = useFreezeGuard();
    const frozenRef = useRef(freeze.frozen);
    frozenRef.current = freeze.frozen;

    const [phase, setPhase] = useState<Phase>("idle");
    const [fraction, setFraction] = useState<number | null>(null);
    const runRef = useRef<{ stopped: boolean; jobId: string | null }>({ stopped: false, jobId: null });

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

    const convert = useCallback(async () => {
        if (!context || !record.target || phase !== "idle" || frozenRef.current) {
            return;
        }
        setPhase("converting");
        setFraction(null);
        runRef.current = { stopped: false, jobId: null };

        // One scratch directory per run, under `.nlstudio/`, which is the only tree this window may
        // write to and is neither versioned nor packaged. The converted file keeps the author's own
        // stem so the asset stays called `intro` rather than a hex string.
        const scratchId = crypto.randomUUID();
        const runDirectory = context.project.resolve(ProjectNameConvention.MediaConvertScratchDir(scratchId));
        const stem = asset.name.replace(/\.[^.]+$/, "") || asset.id;
        const targetPath = context.project.resolve(
            ProjectNameConvention.MediaConvertScratchDir(scratchId),
            `${stem}.${mediaConvertTargetExtension(record.target)}`,
        );
        // The content shard is addressed by the asset id. Composing this path from `hash` - the
        // field one reaches for when thinking about bytes - names a file that does not exist.
        const sourcePath = context.project.resolve(ProjectNameConvention.AssetsDataShard(asset.id));

        const cleanUp = async () => {
            await getInterface().fs.deleteDir(runDirectory).catch(() => undefined);
        };

        const created = await getInterface().fs.createDir(runDirectory);
        if (!created.success || !created.data.ok) {
            setPhase("failed");
            return;
        }

        const outcome = await runMediaConversion(
            { sourcePath, targetPath, target: record.target, durationUs: record.durationUs },
            bridge,
            {
                onStarted: jobId => { runRef.current.jobId = jobId; },
                onProgress: setFraction,
                wait: () => new Promise(resolve => setTimeout(resolve, MEDIA_CONVERT_POLL_MS)),
            },
        );
        runRef.current.jobId = null;

        if (outcome.status !== "done") {
            await cleanUp();
            setPhase(outcome.status === "stopped" ? "stopped" : outcome.status);
            return;
        }

        if (frozenRef.current) {
            // Converted bytes with nowhere to go. Better to throw them away than to write into a
            // project that has been closed for writing under us.
            await cleanUp();
            setPhase("stopped");
            return;
        }

        setPhase("replacing");
        const assets = context.services.get<AssetsService>(Services.Assets);
        const replaced = await assets.replaceAssetContent(asset, outcome.outputPath);
        await cleanUp();
        if (!replaced.success) {
            setPhase("failed");
            return;
        }

        // The mark comes off now rather than whenever something else happens to scan.
        try {
            await context.services.get<MediaSupportService>(Services.MediaSupport).refresh(asset.id);
        } catch {
            // A refresh that could not run leaves a stale mark until the next scan, which is a
            // cosmetic problem; the bytes are already correct.
        }
        onConverted();
    }, [asset, bridge, context, onConverted, phase, record]);

    const stop = useCallback(() => {
        runRef.current.stopped = true;
        const jobId = runRef.current.jobId;
        if (jobId) {
            void getInterface().mediaConvert.cancel(jobId);
        }
    }, []);

    const busy = phase === "converting" || phase === "replacing";
    const extension = record.target ? mediaConvertTargetExtension(record.target) : "";

    return (
        <Modal
            isOpen
            onClose={busy ? stop : onClose}
            title={t("assets.support.convertTitle")}
            helpTopic="mediaConversion"
            closeOnOverlayClick={false}
            showCloseButton={!busy}
            footer={
                <div className="flex justify-end gap-2">
                    {busy ? (
                        <button
                            className={dialogFooterButtonClass({ variant: "secondary", disabled: phase === "replacing" })}
                            disabled={phase === "replacing"}
                            onClick={stop}
                        >
                            {t("assets.mediaConvert.stopAction")}
                        </button>
                    ) : (
                        <>
                            <button
                                className={dialogFooterButtonClass({ variant: "primary", disabled: freeze.frozen })}
                                {...freeze.writes()}
                                onClick={() => void convert()}
                            >
                                {t("assets.support.convertAction")}
                            </button>
                            <button className={dialogFooterButtonClass({ variant: "secondary" })} onClick={onClose}>
                                {t("common.cancel")}
                            </button>
                        </>
                    )}
                </div>
            }
        >
            <div className="space-y-3 py-1">
                <p className="text-xs text-fg-muted">{t("assets.support.convertIntro")}</p>
                <div className="rounded-md border border-edge bg-fill-subtle px-2.5 py-1.5">
                    <span className="block truncate text-xs text-fg" data-tip={asset.name}>{asset.name}</span>
                    <span className="block truncate text-2xs text-fg-subtle">
                        {t("assets.mediaConvert.becomes", { ext: extension })}
                    </span>
                </div>
                <p className="text-2xs leading-relaxed text-fg-muted">
                    {record.lossy
                        ? t("assets.mediaConvert.group.lossyHint")
                        : t("assets.mediaConvert.group.losslessHint")}
                </p>
                {phase !== "idle" && (
                    <div className="space-y-1">
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="text-2xs text-fg-subtle">
                                {phase === "converting"
                                    ? (fraction === null ? "" : `${Math.round(fraction * 100)}%`)
                                    : phase === "replacing"
                                        ? t("assets.support.replacing")
                                        : t(STATE_LABEL[phase])}
                            </span>
                        </div>
                        {phase === "converting" && fraction === null ? (
                            <ProgressIndeterminate size="sm" />
                        ) : phase === "converting" ? (
                            <Progress value={fraction ?? 0} max={1} size="sm" animated={false} />
                        ) : phase === "replacing" ? (
                            <ProgressIndeterminate size="sm" />
                        ) : (
                            <Progress value={0} max={1} size="sm" variant="error" animated={false} />
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}

/** The three ways this can end without a converted file. Shared with the import dialog's wording. */
const STATE_LABEL = {
    failed: "assets.mediaConvert.state.failed",
    stopped: "assets.mediaConvert.state.stopped",
    unavailable: "assets.mediaConvert.state.unavailable",
} as const;
