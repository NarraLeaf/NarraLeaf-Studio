/**
 * "View this line's history": the distinct versions one story row went through, across the scene's
 * content snapshots and (on request) the last few version-control revisions, each drawn as a diff
 * against the line as it is now, with one-click restore.
 *
 * Restore is one undo step on the scene's own stack (`commitSceneReplacement`) and is preceded by a
 * manual snapshot, so it can never cost the author the line they had.
 *
 * Comments in English per convention.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { StoryBlock, StoryBlockId, StoryId, StoryScene, StorySceneId } from "@shared/types/story";
import type { Character } from "@/lib/workspace/services/character/Character";
import { useTranslation } from "@/lib/i18n";
import { Button, Checkbox, Modal } from "@/lib/components/elements";
import { useWorkspace } from "@/apps/workspace/context";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import {
    ROW_HISTORY_REVISION_LIMIT,
    type SceneHistoryService,
} from "@/lib/workspace/services/story/sceneHistory/SceneHistoryService";
import type { RowVersion } from "@/lib/workspace/services/story/sceneHistory/sceneHistoryModel";
import { formatHistoryTime, historyRowText, TextDiffView } from "./sceneHistoryView";

export type StoryRowHistoryTarget = { storyId: StoryId; sceneId: StorySceneId; blockId: StoryBlockId };

export function StoryRowHistoryModal(props: {
    target: StoryRowHistoryTarget | null;
    onClose: () => void;
    characters: Character[];
    scene: StoryScene | undefined;
    scenes: Record<StorySceneId, StoryScene> | undefined;
    /** The editor's own line for a row, so a version reads exactly the way the row does. */
    readLine?: (block: StoryBlock) => string | null;
}) {
    const { target, onClose, characters, scene, scenes, readLine } = props;
    const { t, locale } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const freeze = useFreezeGuard();
    const history = useMemo(
        () => (context && isInitialized ? context.services.get<SceneHistoryService>(Services.SceneHistory) : null),
        [context, isInitialized],
    );
    const [includeRevisions, setIncludeRevisions] = useState(false);
    const [state, setState] = useState<{ versions: RowVersion[]; revisionsFailed: boolean } | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!target) {
            setState(null);
            setIncludeRevisions(false);
        }
    }, [target]);

    useEffect(() => {
        if (!history || !target) return;
        let alive = true;
        setState(null);
        void history.rowHistory(target.storyId, target.sceneId, target.blockId, { includeRevisions }).then(result => {
            if (alive) setState(result);
        });
        return () => {
            alive = false;
        };
    }, [history, target, includeRevisions]);

    const current = target ? scene?.blocks[target.blockId] ?? null : null;
    const text = useCallback(
        (block: StoryBlock | null) => (block ? historyRowText(block, characters, scene, scenes, readLine) : ""),
        [characters, scene, scenes, readLine],
    );
    const currentText = text(current);

    const restore = useCallback(async (version: RowVersion) => {
        if (!history || !target || !version.block) return;
        setBusy(true);
        try {
            const ok = await history.restoreRowVersion(target.storyId, target.sceneId, version.block);
            const ui = context?.services.get<UIService>(Services.UI);
            if (ok) {
                onClose();
            } else {
                ui?.showNotification(t("sceneHistory.rowGone"), "warning");
            }
        } finally {
            setBusy(false);
        }
    }, [history, target, context, onClose, t]);

    const sourceLabel = (version: RowVersion): string => {
        if (version.source.kind === "revision") {
            const name = t("sceneHistory.revision", { number: version.source.number });
            return version.source.message ? `${name} ${version.source.message}` : name;
        }
        const entry = version.source.entry;
        return entry.label ?? t(entry.kind === "auto" ? "sceneHistory.kindAuto" : "sceneHistory.kindManual");
    };

    return (
        <Modal
            isOpen={target !== null}
            onClose={onClose}
            title={t("sceneHistory.rowTitle")}
            size="lg"
            helpTopic="sceneHistory"
            footer={<Button size="sm" variant="secondary" onClick={onClose}>{t("sceneHistory.close")}</Button>}
        >
            <div className="flex flex-col gap-3" data-story-row-history>
                <div className="rounded-md border border-edge bg-surface-raised px-3 py-2">
                    <div className="text-2xs text-fg-subtle">{t("sceneHistory.current")}</div>
                    <div className="mt-0.5 whitespace-pre-wrap break-words text-sm text-fg">
                        {current ? currentText : <span className="text-fg-subtle">{t("sceneHistory.rowDeleted")}</span>}
                    </div>
                </div>
                <Checkbox checked={includeRevisions} onCheckedChange={setIncludeRevisions} className="text-xs text-fg-muted">
                    {t("sceneHistory.includeRevisions", { count: ROW_HISTORY_REVISION_LIMIT })}
                </Checkbox>
                {state === null ? (
                    <div className="text-xs text-fg-subtle">{t("sceneHistory.loading")}</div>
                ) : (
                    <>
                        {state.revisionsFailed ? <div className="text-xs text-warning">{t("sceneHistory.revisionsFailed")}</div> : null}
                        {state.versions.length === 0 ? (
                            <div className="text-xs text-fg-subtle">{t("sceneHistory.noVersions")}</div>
                        ) : (
                            <ul className="flex max-h-[50vh] flex-col overflow-y-auto rounded-md border border-edge">
                                {state.versions.map((version, index) => (
                                    <li key={index} className="flex items-start gap-3 border-b border-edge/60 px-3 py-2 last:border-b-0" data-story-row-version={version.source.kind}>
                                        <div className="min-w-0 flex-1">
                                            <div className="text-2xs text-fg-subtle">
                                                {version.at ? formatHistoryTime(version.at, locale) : null}
                                                <span className="ml-2">{sourceLabel(version)}</span>
                                            </div>
                                            <div className="mt-0.5 text-sm text-fg">
                                                {version.block ? (
                                                    <TextDiffView before={text(version.block)} after={currentText} />
                                                ) : (
                                                    <span className="text-fg-subtle">{t("sceneHistory.absent")}</span>
                                                )}
                                            </div>
                                        </div>
                                        {version.block && current ? (
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                className="shrink-0"
                                                onClick={() => void restore(version)}
                                                {...freeze.writes(busy, t("sceneHistory.rowRestore"))}
                                            >
                                                {t("sceneHistory.rowRestore")}
                                            </Button>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                )}
            </div>
        </Modal>
    );
}
