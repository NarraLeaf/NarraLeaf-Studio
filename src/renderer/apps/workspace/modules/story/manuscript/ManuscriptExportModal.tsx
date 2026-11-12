import { useMemo, useState } from "react";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { Checkbox } from "@/lib/components/elements/Checkbox";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { Select } from "@/lib/components/elements/Select";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import type { StorySceneId } from "@shared/types/story";
import type { ManuscriptSpeaker } from "@/lib/story/manuscript/manuscriptModel";

export type ManuscriptExportFormat = "pdf" | "docx";

export type ManuscriptExportChoice = {
    format: ManuscriptExportFormat;
    sceneIds: StorySceneId[];
    /** Empty means every speaker. */
    speakerKeys: string[];
    contextLines: number;
    includeIds: boolean;
    includeDirections: boolean;
    includeBranches: boolean;
};

const FORMATS: readonly ManuscriptExportFormat[] = ["pdf", "docx"];
const CONTEXT_OPTIONS = [0, 1, 2, 3];

const SEGMENT_BASE = "min-h-7 flex-1 rounded-md border px-3 text-xs transition-colors";
const SEGMENT_ON = "border-primary/60 bg-primary/15 text-fg";
const SEGMENT_OFF = "border-edge text-fg-muted hover:bg-fill hover:text-fg";

/**
 * The readable-script export: which scenes, whose lines, what else goes on the page, and the format.
 *
 * Scenes and speakers are both member lists, so both are checkboxes. A speaker filter is what turns
 * the script into an actor's copy; the context control appears only then, because without a filter
 * every line is already on the page.
 */
export function ManuscriptExportModal(props: {
    scenes: { id: StorySceneId; name: string }[];
    /** Preselected scenes; every scene when null. */
    initialSceneIds: StorySceneId[] | null;
    /** Speakers of the selected scenes, by line count. */
    speakersFor: (sceneIds: StorySceneId[]) => ManuscriptSpeaker[];
    busy: boolean;
    onClose: () => void;
    onExport: (choice: ManuscriptExportChoice) => void;
}) {
    const { t, tn } = useTranslation();
    const [format, setFormat] = useState<ManuscriptExportFormat>("pdf");
    const [sceneIds, setSceneIds] = useState<StorySceneId[]>(() => props.initialSceneIds ?? props.scenes.map(scene => scene.id));
    const [speakerKeys, setSpeakerKeys] = useState<string[]>([]);
    const [contextLines, setContextLines] = useState(1);
    const [includeIds, setIncludeIds] = useState(false);
    const [includeDirections, setIncludeDirections] = useState(true);
    const [includeBranches, setIncludeBranches] = useState(true);

    // In document order whatever order they were ticked in.
    const orderedSceneIds = useMemo(
        () => props.scenes.map(scene => scene.id).filter(id => sceneIds.includes(id)),
        [props.scenes, sceneIds],
    );
    const { speakersFor } = props;
    const speakers = useMemo(() => speakersFor(orderedSceneIds), [orderedSceneIds, speakersFor]);
    const visibleSpeakerKeys = speakerKeys.filter(key => speakers.some(speaker => speaker.key === key));
    const toggle = <T,>(list: T[], value: T, on: boolean) => (on ? [...list, value] : list.filter(item => item !== value));

    const noScenes = orderedSceneIds.length === 0;

    return (
        <Modal
            isOpen
            onClose={props.onClose}
            title={t("manuscript.exportTitle")}
            helpTopic="storyManuscript"
            size="lg"
            closeOnOverlayClick={!props.busy}
            footer={
                <div className="flex w-full items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-2xs text-fg-subtle">
                        {noScenes ? t("manuscript.noScenes") : tn("manuscript.sceneCount", orderedSceneIds.length)}
                    </span>
                    <button
                        type="button"
                        className={dialogFooterButtonClass({ variant: "secondary", disabled: props.busy })}
                        onClick={props.onClose}
                        disabled={props.busy}
                    >
                        {t("common.cancel")}
                    </button>
                    <button
                        type="button"
                        className={dialogFooterButtonClass({ variant: "primary", disabled: props.busy || noScenes })}
                        disabled={props.busy || noScenes}
                        data-manuscript-export
                        onClick={() => props.onExport({
                            format,
                            sceneIds: orderedSceneIds,
                            speakerKeys: visibleSpeakerKeys,
                            contextLines,
                            includeIds,
                            includeDirections,
                            includeBranches,
                        })}
                    >
                        {t("manuscript.exportAction")}
                    </button>
                </div>
            }
        >
            <div className="flex flex-col gap-4">
                <div>
                    <FieldLabel as="span">{t("manuscript.format.label")}</FieldLabel>
                    <div className="flex gap-1.5">
                        {FORMATS.map(candidate => (
                            <button
                                key={candidate}
                                type="button"
                                aria-pressed={format === candidate}
                                data-manuscript-format={candidate}
                                className={cn(SEGMENT_BASE, format === candidate ? SEGMENT_ON : SEGMENT_OFF)}
                                onClick={() => setFormat(candidate)}
                            >
                                {t(`manuscript.format.${candidate}`)}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="flex min-w-0 flex-col">
                        <div className="flex items-baseline justify-between">
                            <FieldLabel as="span">{t("manuscript.scenes.label")}</FieldLabel>
                            <button
                                type="button"
                                className="mb-1 text-2xs text-fg-subtle hover:text-fg"
                                onClick={() => setSceneIds(sceneIds.length === props.scenes.length ? [] : props.scenes.map(scene => scene.id))}
                            >
                                {sceneIds.length === props.scenes.length ? t("manuscript.scenes.selectNone") : t("manuscript.scenes.selectAll")}
                            </button>
                        </div>
                        <div className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto rounded-md border border-edge bg-surface-sunken p-1.5">
                            {props.scenes.map(scene => (
                                <Checkbox
                                    key={scene.id}
                                    className="rounded-md px-1.5 py-1 hover:bg-fill"
                                    checked={sceneIds.includes(scene.id)}
                                    onCheckedChange={checked => setSceneIds(current => toggle(current, scene.id, checked))}
                                >
                                    <span className="truncate text-fg">{scene.name}</span>
                                </Checkbox>
                            ))}
                        </div>
                    </div>
                    <div className="flex min-w-0 flex-col">
                        <FieldLabel as="span">{t("manuscript.speakers.label")}</FieldLabel>
                        <div className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto rounded-md border border-edge bg-surface-sunken p-1.5">
                            <Checkbox
                                className="rounded-md px-1.5 py-1 hover:bg-fill"
                                checked={visibleSpeakerKeys.length === 0}
                                onCheckedChange={() => setSpeakerKeys([])}
                            >
                                <span className="text-fg">{t("manuscript.speakers.all")}</span>
                            </Checkbox>
                            {speakers.map(speaker => (
                                <Checkbox
                                    key={speaker.key}
                                    className="rounded-md px-1.5 py-1 hover:bg-fill"
                                    checked={visibleSpeakerKeys.includes(speaker.key)}
                                    onCheckedChange={checked => setSpeakerKeys(current => toggle(current, speaker.key, checked))}
                                >
                                    <span className="min-w-0 flex-1 truncate text-fg">{speaker.name}</span>
                                    <span className="shrink-0 text-2xs text-fg-subtle">{tn("manuscript.speakers.lineCount", speaker.count)}</span>
                                </Checkbox>
                            ))}
                        </div>
                    </div>
                </div>

                {visibleSpeakerKeys.length > 0 ? (
                    <div className="flex w-[220px] flex-col">
                        <FieldLabel as="span">{t("manuscript.context.label")}</FieldLabel>
                        <Select
                            size="sm"
                            fullWidth
                            portalMenu
                            ariaLabel={t("manuscript.context.label")}
                            options={CONTEXT_OPTIONS.map(count => ({
                                value: String(count),
                                label: count === 0 ? t("manuscript.context.none") : tn("manuscript.context.lines", count),
                            }))}
                            value={String(contextLines)}
                            onChange={value => setContextLines(Number(value))}
                        />
                    </div>
                ) : null}

                <div className="flex flex-col">
                    <FieldLabel as="span">{t("manuscript.include.label")}</FieldLabel>
                    <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                        <Checkbox checked={includeIds} onCheckedChange={setIncludeIds}>{t("manuscript.include.ids")}</Checkbox>
                        <Checkbox checked={includeDirections} onCheckedChange={setIncludeDirections}>{t("manuscript.include.directions")}</Checkbox>
                        <Checkbox checked={includeBranches} onCheckedChange={setIncludeBranches}>{t("manuscript.include.branches")}</Checkbox>
                    </div>
                </div>
            </div>
        </Modal>
    );
}
