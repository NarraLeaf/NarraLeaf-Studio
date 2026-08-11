/**
 * Project → App → Build variants: the editions the same project can be shipped as.
 *
 * Sits directly under the identity fields it varies, because every value a variant can state is one
 * of those fields: the release tag's row shows them read-only, and each variant below shows the same
 * three with whatever it says differently.
 *
 * **Inheritance is legible from the field itself.** A key the variant does not state is an empty
 * input showing the inherited value as its placeholder; a key it does state holds real text and
 * grows a Restore beside it. So "is this mine or the project's" is answerable without reading a
 * word, and Restore is exactly as reachable as the key it restores. What a variant *is* belongs to
 * the `appTags` help topic, not to a paragraph on this page.
 *
 * Built on `Accordion` like the audio buses beside it: a list of N of the same thing, one row each,
 * nothing expanded until the author asks.
 *
 * Deleting a variant does not rewrite what pointed at it - those references resolve to release from
 * then on - which is what the count beside Delete and the confirmation say before the author commits.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { HelpTrigger } from "@/lib/help";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { Button, Input } from "@/lib/components/elements";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import {
    APP_TAG_OVERRIDE_KEYS,
    countAppTagReferences,
    resolveAppTagIdentity,
    type AppTagBaseIdentity,
    type AppTagOverrideKey,
    type ProjectAppTag,
} from "@shared/types/appTag";
import { useWorkspace } from "../../../context";
import { SettingsGroup } from "../components/SettingsGroup";
import type { ProjectSectionProps } from "./types";

/**
 * Same clamp the audio list needs, and for the same reason: `Accordion` owns the header's flex chain,
 * so a long variant name would otherwise push the sub-page into horizontal scroll from inside a
 * component this file cannot reach.
 */
const HEADER_WIDTH_CLAMP = "min-w-0 [&>button]:min-w-0 [&>button>span]:min-w-0";

export function ProjectAppTagsSection({ config, uiService }: ProjectSectionProps) {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const freeze = useFreezeGuard();

    const tagService = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return context.services.get<AppTagService>(Services.AppTags);
    }, [context, isInitialized]);

    const [tags, setTags] = useState<ProjectAppTag[]>([]);
    const [references, setReferences] = useState<Record<string, number>>({});
    /** Collapsed by default. A variant the author just created is the exception - they made it to name it. */
    const [openIds, setOpenIds] = useState<string[]>([]);

    useEffect(() => {
        if (!tagService) {
            setTags([]);
            return;
        }
        setTags(tagService.listTags());
        return tagService.onTagsChanged(setTags);
    }, [tagService]);

    /**
     * The project's own identity - what a variant that states nothing resolves to.
     *
     * Read from the config this page is already showing rather than from the service, so an edit to
     * the name field above is reflected in every variant's placeholder in the same render.
     */
    const base = useMemo<AppTagBaseIdentity>(() => ({
        displayName: config.name?.trim() ?? "",
        identifier: config.identifier?.trim() ?? "",
        version: config.metadata?.version?.trim() ?? "",
    }), [config.identifier, config.metadata?.version, config.name]);

    // Recomputed when the id set changes rather than on every keystroke: renaming a variant or
    // editing one of its overrides cannot change how many things point at it, and re-reading every
    // story document per character typed would be a scan per frame.
    // JSON rather than a delimiter join: an id is only trimmed, not restricted, so any separator
    // could in principle appear inside one and split a single tag into two.
    const tagIdKey = JSON.stringify(tags.map(tag => tag.id));
    useEffect(() => {
        if (!context || !isInitialized) {
            return;
        }
        let active = true;
        void (async () => {
            const counts = await countReferences(context, JSON.parse(tagIdKey) as string[]);
            if (active) {
                setReferences(counts);
            }
        })();
        return () => { active = false; };
    }, [context, isInitialized, tagIdKey]);

    // Filtered rather than pruned in an effect: a deleted variant's id would otherwise sit in the
    // open set and re-open a later tag that happened to be handed the same id.
    const openItems = useMemo(() => {
        const known = new Set(tags.map(tag => tag.id));
        return openIds.filter(id => known.has(id));
    }, [openIds, tags]);

    const addTag = useCallback(() => {
        const created = tagService?.createTag({ name: t("project.appTags.newTagName") });
        if (created) {
            setOpenIds(prev => [...prev, created.id]);
        }
    }, [t, tagService]);

    const removeTag = useCallback(async (tag: ProjectAppTag) => {
        if (!tagService) {
            return;
        }
        const uses = references[tag.id] ?? 0;
        const confirmed = await uiService?.showDestructiveConfirm(
            t("project.appTags.deleteConfirm", { name: tag.name }),
            tn("project.appTags.deleteDetail", uses),
            t("project.appTags.delete"),
        );
        if (confirmed) {
            tagService.deleteTag(tag.id);
        }
    }, [references, t, tagService, tn, uiService]);

    return (
        <SettingsGroup
            title={t("project.group.appTags")}
            helpTopic="appTags"
            trailing={(
                <>
                    <HelpTrigger topic="appTags" />
                    <Button
                        size="sm"
                        onClick={addTag}
                        {...freeze.writes(!tagService)}
                        className="shrink-0"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        {t("project.appTags.add")}
                    </Button>
                </>
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
                    {tags.map(tag => (
                        <TagItem
                            key={tag.id}
                            tag={tag}
                            base={base}
                            service={tagService}
                            uses={references[tag.id] ?? 0}
                            onDelete={() => void removeTag(tag)}
                        />
                    ))}
                </Accordion>
            </div>
        </SettingsGroup>
    );
}

/**
 * One variant: its name on the collapsed row, its three keys behind the disclosure.
 *
 * The release tag renders the same three keys read-only. It is not a variant - it is what the
 * variants are read against - so it has no name field, no Restore and no Delete, and the values it
 * shows are the fields higher up this same page.
 */
function TagItem({
    tag,
    base,
    service,
    uses,
    onDelete,
}: {
    tag: ProjectAppTag;
    base: AppTagBaseIdentity;
    service: AppTagService | null;
    uses: number;
    onDelete: () => void;
}) {
    const { t, tn } = useTranslation();
    const freeze = useFreezeGuard();
    const frozen = freeze.writes(!service);

    const identity = useMemo(() => resolveAppTagIdentity(tag, base), [base, tag]);
    const displayName = tag.builtin ? t("project.appTags.releaseName") : tag.name;

    return (
        <AccordionItem
            id={tag.id}
            className="min-w-0"
            headerClassName={HEADER_WIDTH_CLAMP}
            contentClassName="min-w-0"
            headerProps={{
                // The row's handle: verification, and anything that later has to find a variant on
                // screen, reads this rather than matching a translated label.
                "data-app-tag": tag.id,
            }}
            title={
                <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-fg">{displayName}</span>
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
                {tag.builtin ? null : (
                    <Field label={t("project.appTags.nameTitle")}>
                        <CommittedInput
                            value={tag.name}
                            disabled={frozen.disabled}
                            label={t("project.appTags.nameTitle")}
                            handle={`${tag.id}:name`}
                            onCommit={name => service?.renameTag(tag.id, name)}
                        />
                    </Field>
                )}

                {APP_TAG_OVERRIDE_KEYS.map(key => (
                    <OverrideField
                        key={key}
                        tagId={tag.id}
                        overrideKey={key}
                        label={t(`project.appTags.fields.${key}`)}
                        inherited={base[key]}
                        stated={tag.overrides[key]}
                        readOnly={tag.builtin === true}
                        value={identity[key].value}
                        disabled={frozen.disabled}
                        service={service}
                    />
                ))}

                {tag.builtin ? null : (
                    <div className="flex min-w-0 items-center justify-between gap-2 border-t border-edge pt-2">
                        <span className="min-w-0 truncate text-2xs text-fg-subtle">
                            {tn("project.appTags.usedBy", uses)}
                        </span>
                        <span className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1">
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={onDelete}
                                {...freeze.writes(!service)}
                                className="px-1.5 hover:text-danger"
                                data-app-tag-delete={tag.id}
                            >
                                {t("project.appTags.delete")}
                            </Button>
                        </span>
                    </div>
                )}
            </div>
        </AccordionItem>
    );
}

/**
 * One key of one variant.
 *
 * The input holds the variant's own value when it has one and is empty when it does not, with the
 * inherited value as the placeholder - so the field says which of the two it is showing without a
 * second control saying it. Restore appears only where there is something to restore, which makes it
 * the marker as well as the action.
 */
function OverrideField({
    tagId,
    overrideKey,
    label,
    inherited,
    stated,
    readOnly,
    value,
    disabled,
    service,
}: {
    tagId: string;
    overrideKey: AppTagOverrideKey;
    label: string;
    inherited: string;
    stated: string | undefined;
    readOnly: boolean;
    value: string;
    disabled: boolean;
    service: AppTagService | null;
}) {
    const { t } = useTranslation();

    if (readOnly) {
        return (
            <Field label={label}>
                <div
                    className="min-h-7 min-w-0 truncate rounded-md border border-edge bg-surface-raised px-2 py-1 text-xs text-fg-muted"
                    data-app-tag-value={`${tagId}:${overrideKey}`}
                >
                    {value}
                </div>
            </Field>
        );
    }

    return (
        <Field
            label={label}
            trailing={stated === undefined ? null : (
                <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => service?.clearOverride(tagId, overrideKey)}
                    className="px-1.5"
                    data-app-tag-restore={`${tagId}:${overrideKey}`}
                >
                    {t("project.appTags.restore")}
                </Button>
            )}
        >
            <CommittedInput
                value={stated ?? ""}
                placeholder={inherited}
                disabled={disabled}
                label={label}
                handle={`${tagId}:${overrideKey}`}
                allowEmpty
                onCommit={next => service?.setOverride(tagId, overrideKey, next)}
            />
        </Field>
    );
}

/**
 * A labelled field inside a variant.
 *
 * A `div` rather than a `label`, for the reason the audio list documents: wrapping a control whose
 * trigger is a button in a `label` makes the click that operates it fire twice.
 */
function Field({
    label,
    trailing,
    children,
}: {
    label: string;
    trailing?: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="grid min-w-0 gap-1 [&>*]:min-w-0">
            <div className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-2xs font-medium text-fg-muted">{label}</span>
                {trailing}
            </div>
            {children}
        </div>
    );
}

/**
 * Committed on blur or Enter rather than per keystroke.
 *
 * Not a convenience: the service trims what it is given and treats blank as "clear this key", so a
 * per-keystroke commit would delete the override the moment the author selected the text to retype
 * it, and would eat the space they typed in the middle of a name.
 *
 * `allowEmpty` separates the two things a blank field can mean. On an override it is the author
 * saying "inherit this again" and the service is told. On the name it is a value the service refuses,
 * and telling it would leave the field showing a blank the model never accepted - so the field puts
 * the stored name back instead.
 */
function CommittedInput({
    value,
    placeholder,
    disabled,
    label,
    handle,
    allowEmpty = false,
    onCommit,
}: {
    value: string;
    placeholder?: string;
    disabled: boolean;
    label: string;
    /** `<tagId>:name` or `<tagId>:<override key>` - what verification finds this field by. */
    handle: string;
    allowEmpty?: boolean;
    onCommit: (value: string) => void;
}) {
    const [draft, setDraft] = useState(value);

    useEffect(() => {
        setDraft(value);
    }, [value]);

    const commit = useCallback(() => {
        const next = draft.trim();
        if (next !== value && (allowEmpty || next)) {
            onCommit(next);
        } else {
            setDraft(value);
        }
    }, [allowEmpty, draft, onCommit, value]);

    return (
        <Input
            size="sm"
            value={draft}
            placeholder={placeholder}
            disabled={disabled}
            aria-label={label}
            className="w-full min-w-0"
            data-app-tag-field={handle}
            onChange={event => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                } else if (event.key === "Escape") {
                    setDraft(value);
                    event.currentTarget.blur();
                }
            }}
        />
    );
}

/**
 * How many stored references each variant has, read from the documents that can hold one.
 *
 * Reads the in-memory documents rather than the files, so the count reflects unsaved edits - the same
 * reason `ReferenceService` is renderer-side. A story that has never been opened is loaded here;
 * failures are skipped rather than propagated, because an unreadable story is already reported
 * elsewhere and must not leave this surface without a number.
 */
async function countReferences(
    context: WorkspaceContext,
    tagIds: readonly string[],
): Promise<Record<string, number>> {
    const roots: unknown[] = [];
    try {
        const storyService = context.services.get<StoryService>(Services.Story);
        for (const entry of storyService.listStories()) {
            const document = await storyService.loadStory(entry.id).catch(() => null);
            if (document) {
                roots.push(document);
            }
        }
    } catch {
        // The story library is not loaded in every context this panel can mount in.
    }
    // Each in its own guard: a document service that has not loaded contributes nothing rather than
    // costing the surface the counts the others could have provided.
    try {
        roots.push(context.services.get<UIGraphService>(Services.UIGraph).getDocument());
    } catch { /* not loaded */ }
    try {
        roots.push(context.services.get<UIDocumentService>(Services.UIDocument).getDocument());
    } catch { /* not loaded */ }

    return countAppTagReferences(roots, tagIds);
}
