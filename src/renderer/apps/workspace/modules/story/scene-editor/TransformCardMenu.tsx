import { useCallback, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import type { StoryTransformRef } from "@shared/types/story";
import {
    findTransformPresetByName,
    normalizeTransformPresetName,
    TRANSFORM_PRESET_NAME_MAX,
    type ProjectTransformPreset,
} from "@shared/types/transformPreset";
import { useTranslation } from "@/lib/i18n";
import {
    ContextMenu,
    dialogFooterButtonClass,
    IconButton,
    Input,
    Modal,
    ModalBody,
    type ContextMenuDef,
} from "@/lib/components/elements";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { statedTransformChannels } from "./transformChannels";
import type { TFunc } from "./inspectorFieldKit";
import { useTransformPresets } from "./useTransformPresets";

/**
 * The transform card's overflow menu, and the two dialogs behind it.
 *
 * Sits at the right edge of the row the `Add` picker starts, which is the one place on the card that
 * is about the transform as a whole rather than about one channel of it. What it holds is what an
 * author does to the whole bag: keep it under a name, or empty it.
 *
 * **Saving writes another document**, so those rows are switched off by any freeze at all - the same
 * answer `BeyondStoryDocumentClamp` gives the motion picker one card up. Clearing the channels is an
 * ordinary story-document edit and stays live in a session, which is why the rows are gated one by
 * one rather than the trigger being gated for all of them.
 */
export function TransformCardMenu(props: {
    value: StoryTransformRef | undefined;
    onChange: (value: StoryTransformRef) => void;
}) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const { presets, service } = useTransformPresets();
    // A wrapper rather than the button itself: `IconButton` is a plain component and forwards no
    // ref, and the menu only needs a box to open under.
    const triggerRef = useRef<HTMLSpanElement | null>(null);
    const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
    const [dialog, setDialog] = useState<"none" | "save" | "manage">("none");

    const ref: StoryTransformRef = props.value ?? { mode: "props" };
    const stated = useMemo(() => statedTransformChannels(ref), [ref]);

    const clearChannels = useCallback(() => {
        props.onChange(stated.reduce<StoryTransformRef>((current, channel) => channel.remove(current), ref));
    }, [props, ref, stated]);

    const openMenu = () => {
        const box = triggerRef.current?.getBoundingClientRect();
        if (box) {
            setMenuAt({ x: box.left, y: box.bottom + 4 });
        }
    };

    // Nothing stated is nothing to keep and nothing to empty - the two rows say so rather than
    // writing a preset that seeds no channel.
    const emptyRow = { disabled: stated.length === 0, tooltip: stated.length === 0 ? t("storyInspector.transformCard.noChannels") : undefined };
    const items: ContextMenuDef = [
        {
            id: "save-preset",
            label: t("storyInspector.transformCard.savePreset"),
            ...merge(freeze.menuRow(!service || emptyRow.disabled), emptyRow.tooltip),
            onClick: () => setDialog("save"),
        },
        {
            id: "clear-channels",
            label: t("storyInspector.transformCard.clearChannels"),
            disabled: emptyRow.disabled,
            tooltip: emptyRow.tooltip,
            onClick: clearChannels,
        },
        { id: "sep", separator: true },
        {
            id: "manage-presets",
            label: t("storyInspector.transformCard.managePresets"),
            ...freeze.menuRow(!service),
            onClick: () => setDialog("manage"),
        },
    ];

    return (
        <>
            <span ref={triggerRef} className="inline-flex">
                <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={t("storyInspector.transformCard.menu")}
                    data-tip={t("storyInspector.transformCard.menu")}
                    aria-expanded={menuAt !== null}
                    onClick={() => (menuAt ? setMenuAt(null) : openMenu())}
                >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                </IconButton>
            </span>
            {menuAt ? <ContextMenu items={items} position={menuAt} onClose={() => setMenuAt(null)} /> : null}
            {dialog === "save" ? (
                <SavePresetDialog
                    transform={ref}
                    presets={presets}
                    onSave={(name, transform) => service?.savePreset(name, transform)}
                    onClose={() => setDialog("none")}
                />
            ) : null}
            {dialog === "manage" ? (
                <ManagePresetsDialog
                    presets={presets}
                    onRename={(id, name) => service?.renamePreset(id, name) ?? false}
                    onRemove={id => service?.removePreset(id)}
                    onClose={() => setDialog("none")}
                />
            ) : null}
        </>
    );
}

/**
 * Name this transform and keep it.
 *
 * A name the project already holds replaces that preset rather than being refused, and the button
 * says so: an author saving the same name twice has adjusted the preset, and a list holding the
 * older one under the name they just typed is not what they asked for.
 */
function SavePresetDialog(props: {
    transform: StoryTransformRef;
    presets: readonly ProjectTransformPreset[];
    onSave: (name: string, transform: StoryTransformRef) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const [name, setName] = useState("");
    const normalized = normalizeTransformPresetName(name);
    const replacing = normalized ? findTransformPresetByName(props.presets, normalized) : null;

    const submit = () => {
        if (!normalized) {
            return;
        }
        props.onSave(normalized, props.transform);
        props.onClose();
    };

    return (
        <Modal isOpen onClose={props.onClose} title={t("storyInspector.transformCard.saveTitle")} size="sm"
            footer={
                <div className="flex justify-end gap-2">
                    <button
                        className={dialogFooterButtonClass({ variant: "primary", disabled: !normalized })}
                        disabled={!normalized}
                        onClick={submit}
                    >
                        {replacing ? t("storyInspector.transformCard.replace") : t("common.save")}
                    </button>
                    <button className={dialogFooterButtonClass({ variant: "secondary" })} onClick={props.onClose}>
                        {t("common.cancel")}
                    </button>
                </div>
            }
        >
            <ModalBody>
                <label className="flex flex-col gap-1.5">
                    <span className="text-2xs text-fg-muted">{t("storyInspector.transformCard.nameLabel")}</span>
                    <Input
                        size="sm"
                        autoFocus
                        value={name}
                        maxLength={TRANSFORM_PRESET_NAME_MAX}
                        placeholder={t("storyInspector.transformCard.namePlaceholder")}
                        onChange={event => setName(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === "Enter") {
                                submit();
                            }
                        }}
                    />
                </label>
                <p className="mt-2 text-2xs text-fg-subtle">{channelSummary(props.transform, t)}</p>
            </ModalBody>
        </Modal>
    );
}

/**
 * The project's presets, renamed and deleted in place.
 *
 * A plain delete with no confirmation and no usage count, because there is nothing to count: a row
 * written from a preset carries its own copy of the channels, so nothing on any stage moves when one
 * goes. Renaming commits when the field is left rather than per keystroke - a half-typed name is a
 * name, and one that collides has to be refused with the field still holding what was typed.
 */
function ManagePresetsDialog(props: {
    presets: readonly ProjectTransformPreset[];
    onRename: (id: string, name: string) => boolean;
    onRemove: (id: string) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [rejected, setRejected] = useState<string | null>(null);

    const commit = (preset: ProjectTransformPreset) => {
        const draft = drafts[preset.id];
        if (draft === undefined || draft === preset.name) {
            return;
        }
        if (props.onRename(preset.id, draft)) {
            setRejected(null);
        } else {
            setRejected(preset.id);
            return;
        }
        setDrafts(current => {
            const next = { ...current };
            delete next[preset.id];
            return next;
        });
    };

    return (
        <Modal isOpen onClose={props.onClose} title={t("storyInspector.transformCard.manageTitle")} size="md">
            <ModalBody>
                {props.presets.length === 0 ? (
                    <p className="py-4 text-center text-xs text-fg-subtle">{t("storyInspector.transformCard.empty")}</p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {props.presets.map(preset => (
                            <div key={preset.id} className="flex flex-col gap-1">
                                <div className="flex items-center gap-1.5">
                                    <Input
                                        size="sm"
                                        className="flex-1"
                                        value={drafts[preset.id] ?? preset.name}
                                        maxLength={TRANSFORM_PRESET_NAME_MAX}
                                        aria-label={t("storyInspector.transformCard.rename")}
                                        readOnly={freeze.frozen}
                                        data-tip={freeze.frozen ? freeze.reason : undefined}
                                        onChange={event => {
                                            const value = event.target.value;
                                            setDrafts(current => ({ ...current, [preset.id]: value }));
                                        }}
                                        onBlur={() => commit(preset)}
                                        onKeyDown={event => {
                                            if (event.key === "Enter") {
                                                event.currentTarget.blur();
                                            }
                                        }}
                                    />
                                    <IconButton
                                        size="sm"
                                        variant="ghost"
                                        aria-label={t("storyInspector.transformCard.delete")}
                                        {...freeze.writes(false, t("storyInspector.transformCard.delete"))}
                                        onClick={() => props.onRemove(preset.id)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                                    </IconButton>
                                </div>
                                <p className="pl-1 text-2xs text-fg-subtle">
                                    {rejected === preset.id
                                        ? t("storyInspector.transformCard.nameTaken")
                                        : channelSummary(preset.transform, t)}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </ModalBody>
        </Modal>
    );
}

/** The channels a transform states, in the words the card calls them by. */
function channelSummary(transform: StoryTransformRef | undefined, t: TFunc): string {
    return statedTransformChannels(transform ?? { mode: "props" }).map(channel => channel.label(t)).join(", ");
}

/** A menu row's frozen state, keeping the caller's own tooltip when the freeze has nothing to say. */
function merge(row: { disabled: boolean; tooltip: string | undefined }, ownTooltip: string | undefined) {
    return { disabled: row.disabled, tooltip: row.tooltip ?? ownTooltip };
}
