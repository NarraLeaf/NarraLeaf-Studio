/**
 * Project → App → DLC: the content the project ships beside a build rather than inside one.
 *
 * Under the variants, because a DLC states which of them it loads into and the picker offers exactly
 * that list. It is not one of them: a build is exactly one variant, and has any number of DLC
 * installed beside it.
 *
 * Three fields, and the id is the one that matters. It is the filename the player ends up with, so
 * it is shown, it is stated under the name as the file it produces, and changing it asks first -
 * copies already delivered keep the old name.
 *
 * Built on `Accordion` like the variants above it: a list of N of the same thing, one row each,
 * nothing expanded until the author asks.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { Button, Input, Select, type SelectOption } from "@/lib/components/elements";
import { Services } from "@/lib/workspace/services/services";
import type { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import type { DlcService } from "@/lib/workspace/services/dlc/DlcService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { ProjectAppTag } from "@shared/types/appTag";
import type { ProjectDlc } from "@shared/types/dlc";
import { dlcArtifactFileName } from "@shared/utils/dlcDelivery";
import { useWorkspace } from "../../../context";
import {
    ConfigClaimMark,
    DLC_CLAIMS,
    dlcDocumentFreezeScope,
    useConfigClaim,
    useConfigClaimHold,
} from "../configLiveSession";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

/**
 * Same clamp the variants above need, and for the same reason: `Accordion` owns the header's flex
 * chain, so a long name would otherwise push the sub-page into horizontal scroll from inside a
 * component this file cannot reach.
 */
const HEADER_WIDTH_CLAMP = "min-w-0 [&>button]:min-w-0 [&>button>span]:min-w-0";

export function ProjectDlcSection({ uiService }: ProjectSectionProps) {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    // Scoped, so a live session leaves this list live: every gesture on it is an operation the
    // session carries. The scope is the file `DlcService` writes, and it is the same predicate the
    // write boundary asks - see `configLiveSession`.
    const freeze = useFreezeGuard(dlcDocumentFreezeScope());

    const services = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return {
            dlc: context.services.get<DlcService>(Services.Dlc),
            appTags: context.services.get<AppTagService>(Services.AppTags),
            story: context.services.get<StoryService>(Services.Story),
        };
    }, [context, isInitialized]);

    const [dlcs, setDlcs] = useState<ProjectDlc[]>([]);
    const [variants, setVariants] = useState<ProjectAppTag[]>([]);
    /** Collapsed by default. One the author just created is the exception - they made it to name it. */
    const [openIds, setOpenIds] = useState<string[]>([]);

    useEffect(() => {
        if (!services) {
            setDlcs([]);
            return;
        }
        setDlcs(services.dlc.list());
        return services.dlc.onDlcChanged(setDlcs);
    }, [services]);

    useEffect(() => {
        if (!services) {
            setVariants([]);
            return;
        }
        setVariants(services.appTags.listTags());
        return services.appTags.onTagsChanged(setVariants);
    }, [services]);

    const variantOptions = useMemo<SelectOption[]>(
        () => variants.map(tag => ({ value: tag.id, label: tag.name })),
        [variants],
    );

    /**
     * How many stories each DLC carries - the number the delete confirmation is about.
     *
     * Read off the library index, which the story service already holds: a story states which DLC it
     * belongs to on its index entry, so this is a walk of a list the panel has rather than a read of
     * every document.
     */
    const storyCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const story of services?.story.listStories() ?? []) {
            if (story.dlcId) {
                counts[story.dlcId] = (counts[story.dlcId] ?? 0) + 1;
            }
        }
        return counts;
    }, [services, dlcs]);

    // Filtered rather than pruned in an effect: a deleted id would otherwise sit in the open set and
    // re-open a later DLC that happened to be given the same id.
    const openItems = useMemo(() => {
        const known = new Set(dlcs.map(dlc => dlc.id));
        return openIds.filter(id => known.has(id));
    }, [dlcs, openIds]);

    const addDlc = useCallback(() => {
        // The same name every time on purpose - the service numbers it, so pressing Add twice gives
        // two DLC an author can tell apart rather than two rows reading "New DLC".
        const created = services?.dlc.create({ name: t("project.dlc.newDlcName") });
        if (created) {
            setOpenIds(prev => [...prev, created.id]);
        }
    }, [services, t]);

    const removeDlc = useCallback(async (dlc: ProjectDlc) => {
        if (!services) {
            return;
        }
        const confirmed = await uiService?.showDestructiveConfirm(
            t("project.dlc.deleteConfirm", { name: dlc.name }),
            // The honest consequence: nothing marked for this DLC is rewritten, so those stories are
            // carried by the base build from now on.
            tn("project.dlc.deleteDetail", storyCounts[dlc.id] ?? 0),
            t("project.dlc.delete"),
        );
        if (confirmed) {
            services.dlc.delete(dlc.id);
        }
    }, [services, storyCounts, t, tn, uiService]);

    return (
        <SettingsGroup
            title={t("project.group.dlc")}
            trailing={(
                <Button
                    size="sm"
                    onClick={addDlc}
                    {...freeze.writes(!services)}
                    className="shrink-0"
                >
                    <Plus className="h-3.5 w-3.5" />
                    {t("project.dlc.add")}
                </Button>
            )}
        >
            {/* The top rule is the list's own edge: every row carries a bottom hairline, so without
                it the list is bounded below and open above. */}
            <div className="min-w-0 border-t border-edge">
                <Accordion
                    className="min-w-0"
                    multiple
                    openItems={openItems}
                    onOpenChange={setOpenIds}
                >
                    {dlcs.map(dlc => (
                        <DlcItem
                            key={dlc.id}
                            dlc={dlc}
                            service={services?.dlc ?? null}
                            uiService={uiService}
                            variantOptions={variantOptions}
                            onDelete={() => void removeDlc(dlc)}
                        />
                    ))}
                </Accordion>
            </div>
        </SettingsGroup>
    );
}

/** One DLC: its name on the collapsed row, its three fields behind the disclosure. */
function DlcItem({
    dlc,
    service,
    uiService,
    variantOptions,
    onDelete,
}: {
    dlc: ProjectDlc;
    service: DlcService | null;
    uiService: ProjectSectionProps["uiService"];
    variantOptions: readonly SelectOption[];
    onDelete: () => void;
}) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard(dlcDocumentFreezeScope());
    const frozen = freeze.writes(!service);
    /**
     * The field somebody is inside, which is what a claim is held for.
     *
     * One piece of state for the row rather than one per box: the caret is in at most one of
     * them, and what a claim says is that somebody is inside this DLC rather than which of its
     * fields they are in.
     */
    const [focused, setFocused] = useState(false);
    useConfigClaimHold(DLC_CLAIMS, focused ? dlc.id : null);
    const heldBy = useConfigClaim(DLC_CLAIMS, dlc.id);
    // Read-only rather than disabled, with the character panel and the translation table: a row
    // somebody else is inside is still one this author is here to read.
    const readOnly = heldBy !== null;
    const claimed = {
        readOnly,
        "data-tip": heldBy === null ? undefined : t("project.live.entryClaimed", { name: heldBy }),
    };

    return (
        <AccordionItem
            id={dlc.id}
            className="min-w-0"
            headerClassName={HEADER_WIDTH_CLAMP}
            contentClassName="min-w-0"
            headerProps={{
                // The row's handle: verification, and anything that later has to find a DLC on
                // screen, reads this rather than matching a translated label.
                "data-dlc": dlc.id,
            }}
            title={
                <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-fg">{dlc.name}</span>
                    {heldBy === null ? null : <ConfigClaimMark account={heldBy} />}
                </span>
            }
        >
            {/*
              * `Accordion` listens for Enter/Space on `window` to toggle the focused row and only
              * exempts real input elements, so the two keys are stopped here for everything else in
              * the body. Scoped to those two, so application keybindings still reach the window.
              */}
            <div
                className="grid gap-2.5 bg-fill-subtle px-3 py-2.5 [&>*]:min-w-0"
                onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.stopPropagation();
                    }
                }}
            >
                <Field label={t("project.dlc.nameTitle")}>
                    <CommittedInput
                        value={dlc.name}
                        disabled={frozen.disabled}
                        label={t("project.dlc.nameTitle")}
                        handle={`${dlc.id}:name`}
                        onCommit={name => service?.rename(dlc.id, name)}
                        onFocusChange={setFocused}
                        {...claimed}
                    />
                </Field>

                <Field label={t("project.dlc.idTitle")}>
                    <IdInput
                        dlc={dlc}
                        service={service}
                        uiService={uiService}
                        disabled={frozen.disabled}
                        onFocusChange={setFocused}
                        {...claimed}
                    />
                    {/* Under the id rather than under the name: it is what the id produces, and an
                        author reading it is checking the id they just typed. */}
                    <span className="text-2xs text-fg-subtle">
                        {t("project.dlc.idFile", { file: dlcArtifactFileName(dlc.id) })}
                    </span>
                </Field>

                <Field label={t("project.dlc.attachTitle")}>
                    <Select
                        options={[...variantOptions]}
                        value={dlc.attachTo}
                        onChange={value => service?.setAttachTo(dlc.id, String(value))}
                        disabled={frozen.disabled || readOnly}
                        ariaLabel={t("project.dlc.attachTitle")}
                    />
                </Field>

                <div className="flex justify-end">
                    <Button
                        size="sm"
                        variant="danger"
                        onClick={onDelete}
                        {...frozen}
                        disabled={frozen.disabled || readOnly}
                    >
                        {t("project.dlc.delete")}
                    </Button>
                </div>
            </div>
        </AccordionItem>
    );
}

/**
 * The id, which is the filename.
 *
 * Confirms before it changes, and only when it would really change: this is the one field on the
 * page whose old value is already in players' hands, and the service cannot ask - it has no surface.
 * The field puts the stored id back whenever the author declines, so a refused change never leaves a
 * value on screen the project does not have.
 */
function IdInput({
    dlc,
    service,
    uiService,
    disabled,
    readOnly,
    onFocusChange,
    "data-tip": tip,
}: {
    dlc: ProjectDlc;
    service: DlcService | null;
    uiService: ProjectSectionProps["uiService"];
    disabled: boolean;
    /** True while somebody else is inside this row. See `configLiveSession`. */
    readOnly?: boolean;
    onFocusChange?: (focused: boolean) => void;
    "data-tip"?: string;
}) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(dlc.id);

    useEffect(() => {
        setDraft(dlc.id);
    }, [dlc.id]);

    const commit = useCallback(async () => {
        const next = draft.trim();
        if (!next || next === dlc.id || !service) {
            setDraft(dlc.id);
            return;
        }
        const confirmed = await uiService?.showDestructiveConfirm(
            t("project.dlc.idChangeConfirm", { id: next }),
            t("project.dlc.idChangeDetail"),
            t("project.dlc.idChangeAction"),
        );
        // Read the id back rather than assuming: what was typed may have been folded into something
        // a filesystem carries, or numbered around one already taken.
        setDraft(confirmed ? service.changeId(dlc.id, next) : dlc.id);
    }, [dlc.id, draft, service, t, uiService]);

    return (
        <Input
            size="sm"
            value={draft}
            disabled={disabled}
            readOnly={readOnly}
            data-tip={tip}
            aria-label={t("project.dlc.idTitle")}
            className="w-full min-w-0"
            data-dlc-field={`${dlc.id}:id`}
            onChange={event => setDraft(event.target.value)}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => {
                onFocusChange?.(false);
                void commit();
            }}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                }
            }}
        />
    );
}

function Field({
    label,
    children,
}: {
    label: string;
    children: React.ReactNode;
}) {
    return (
        <div className="grid min-w-0 gap-1 [&>*]:min-w-0">
            <span className="min-w-0 truncate text-2xs font-medium text-fg-muted">{label}</span>
            {children}
        </div>
    );
}

/**
 * Committed on blur or Enter rather than per keystroke.
 *
 * Not a convenience: the service trims what it is given and refuses blank, so a per-keystroke commit
 * would eat the space typed in the middle of a name and would fight the author the moment they
 * selected the text to retype it.
 */
function CommittedInput({
    value,
    disabled,
    label,
    handle,
    onCommit,
    readOnly,
    onFocusChange,
    "data-tip": tip,
}: {
    value: string;
    disabled: boolean;
    label: string;
    /** `<dlcId>:name` - what verification finds this field by. */
    handle: string;
    onCommit: (value: string) => void;
    /** True while somebody else is inside this row. See `configLiveSession`. */
    readOnly?: boolean;
    onFocusChange?: (focused: boolean) => void;
    "data-tip"?: string;
}) {
    const [draft, setDraft] = useState(value);

    useEffect(() => {
        setDraft(value);
    }, [value]);

    const commit = useCallback(() => {
        const next = draft.trim();
        if (next && next !== value) {
            onCommit(next);
        } else {
            setDraft(value);
        }
    }, [draft, onCommit, value]);

    return (
        <Input
            size="sm"
            value={draft}
            disabled={disabled}
            readOnly={readOnly}
            data-tip={tip}
            aria-label={label}
            className="w-full min-w-0"
            data-dlc-field={handle}
            onChange={event => setDraft(event.target.value)}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => {
                onFocusChange?.(false);
                commit();
            }}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                }
            }}
        />
    );
}
