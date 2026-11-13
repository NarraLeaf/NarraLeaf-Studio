import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, PencilLine } from "lucide-react";
import type { TranslationKey } from "@shared/i18n/catalog";
import { Modal, dialogFooterButtonClass } from "@/lib/components/elements/Modal";
import { Input } from "@/lib/components/elements/Input";
import { Checkbox } from "@/lib/components/elements/Checkbox";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { applyRenamePlan } from "@/lib/workspace/services/refactor/applyRename";
import {
    countSelected,
    validateRenameName,
    type RenameEdit,
    type ReferenceSite,
} from "@/lib/workspace/services/refactor/renameModel";
import {
    planResolvedRename,
    resolveRenameRequest,
    type ResolvedRename,
} from "@/lib/workspace/services/refactor/resolveRename";
import { syncEditorTabTitle } from "@/lib/workspace/services/ui/editorTabTitle";
import { getStorySceneEditorTabId } from "../story/scene-editor/storySceneEditorTabId";
import { syncCharacterEditorTabTitle } from "../characters/state/useCharacterFocus";
import { requestRename, useRenameRequests, type RenameRequest } from "./renameRequests";
import { referenceSiteDetail, referenceSiteGroupKey, referenceSitePlace } from "./referenceSiteText";

/**
 * The rename refactor's one dialog: a new name, every place it will be written, a box per place, and
 * one button that writes all of them as one undo step.
 *
 * Mounted once in the workspace shell and opened through `requestRename`, so a Variables panel row, a
 * story row's menu, the cast panel and the command palette all reach the same preview.
 */

const TITLE_KEYS: Record<ResolvedRename["subject"]["kind"], TranslationKey> = {
    variable: "refactor.dialog.titleVariable" as TranslationKey,
    label: "refactor.dialog.titleLabel" as TranslationKey,
    scene: "refactor.dialog.titleScene" as TranslationKey,
    character: "refactor.dialog.titleCharacter" as TranslationKey,
};

function groupSites<T extends { site: ReferenceSite }>(items: readonly T[]): { key: string; site: ReferenceSite; items: T[] }[] {
    const groups = new Map<string, { key: string; site: ReferenceSite; items: T[] }>();
    for (const item of items) {
        const key = referenceSiteGroupKey(item.site);
        const group = groups.get(key) ?? { key, site: item.site, items: [] };
        group.items.push(item);
        groups.set(key, group);
    }
    return [...groups.values()];
}

function EditRow(props: { edit: RenameEdit; checked: boolean; onToggle: (checked: boolean) => void }) {
    const { t } = useTranslation();
    const { edit } = props;
    return (
        <div className={cn("flex items-start gap-2 rounded-md px-2 py-1.5", !props.checked && "opacity-60")}>
            <Checkbox
                checked={props.checked}
                disabled={edit.required}
                onCheckedChange={props.onToggle}
                boxClassName="mt-0.5"
                aria-label={referenceSiteDetail(edit.site, t)}
                data-tip={edit.required ? t("refactor.dialog.required" as TranslationKey) : undefined}
            />
            <div className="min-w-0 flex-1">
                <div className="text-2xs text-fg-subtle">
                    {referenceSiteDetail(edit.site, t)}
                    {edit.reformatted ? ` · ${t("refactor.dialog.reformatted" as TranslationKey)}` : ""}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs">
                    <span className="min-w-0 break-all text-fg-muted line-through decoration-fg-subtle">{edit.before}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-fg-subtle" />
                    <span className="min-w-0 break-all text-fg">{edit.after}</span>
                </div>
            </div>
        </div>
    );
}

function SiteRow(props: { site: ReferenceSite }) {
    const { t } = useTranslation();
    return (
        <div className="flex min-w-0 items-baseline gap-2 px-2 py-1 text-xs">
            <span className="shrink-0 text-fg-muted">{referenceSiteDetail(props.site, t)}</span>
            {props.site.excerpt ? <span className="min-w-0 truncate font-mono text-fg-subtle">{props.site.excerpt}</span> : null}
        </div>
    );
}

function GroupHeader(props: { site: ReferenceSite }) {
    const { t } = useTranslation();
    return <div className="px-2 pb-0.5 pt-2 text-xs font-medium text-fg">{referenceSitePlace(props.site, t)}</div>;
}

export function RenamePreviewHost() {
    const { t, tn } = useTranslation();
    const { context } = useWorkspace();
    const [resolved, setResolved] = useState<ResolvedRename | null>(null);
    const [name, setName] = useState("");
    const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
    const [busy, setBusy] = useState(false);

    useRenameRequests(request => {
        if (!context) {
            return;
        }
        void resolveRenameRequest(context, request).then(next => {
            if (!next) {
                return;
            }
            setResolved(next);
            setName(next.subject.name);
            setExcluded(new Set());
        });
    });

    // Palette entry: the scene of the focused scene editor.
    useEffect(() => {
        if (!context) {
            return;
        }
        const commandService = context.services.get<CommandService>(Services.Command);
        return commandService.register({
            id: "story:rename-scene-with-references",
            titleKey: "refactor.command.renameScene" as TranslationKey,
            categoryKey: "workspace.shell.commandPalette.categoryStory" as TranslationKey,
            icon: <PencilLine className="h-4 w-4" />,
            run: () => {
                const active = context.services.get<UIService>(Services.UI).editor.getActive();
                const payload = active?.payload as { storyId?: string; sceneId?: string } | undefined;
                if (active?.id.startsWith("story:scene:") && payload?.storyId && payload.sceneId) {
                    requestRename({ kind: "scene", storyId: payload.storyId, sceneId: payload.sceneId });
                }
            },
        });
    }, [context]);

    const close = useCallback(() => {
        if (!busy) {
            setResolved(null);
        }
    }, [busy]);

    const problem = resolved ? validateRenameName(resolved.subject, name, resolved.taken) : null;
    const plan = useMemo(
        () => (resolved && name.trim() ? planResolvedRename(resolved, name) : null),
        [resolved, name],
    );
    const selected = plan ? countSelected(plan, excluded) : 0;
    const blocked = !plan || problem !== null || plan.failures.length > 0 || selected === 0 || busy;

    const confirm = useCallback(async () => {
        if (!context || !plan || blocked) {
            return;
        }
        setBusy(true);
        try {
            const applied = await applyRenamePlan(context, plan, excluded);
            // Tab strips hold the title a tab was opened under.
            const ui = context.services.get<UIService>(Services.UI);
            if (applied && plan.subject.kind === "scene") {
                syncEditorTabTitle(ui, getStorySceneEditorTabId(plan.subject.storyId, plan.subject.sceneId), plan.newName);
            } else if (applied && plan.subject.kind === "character") {
                syncCharacterEditorTabTitle(ui, plan.subject.characterId, plan.newName);
            }
        } finally {
            setBusy(false);
            setResolved(null);
        }
    }, [context, plan, blocked, excluded]);

    const toggle = useCallback((id: string, checked: boolean) => {
        setExcluded(current => {
            const next = new Set(current);
            if (checked) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    if (!resolved) {
        return null;
    }

    const problemText = problem && problem.code !== "unchanged"
        ? t(`refactor.problem.${problem.code}` as TranslationKey)
        : null;

    return (
        <Modal
            isOpen
            onClose={close}
            title={t(TITLE_KEYS[resolved.subject.kind])}
            size="lg"
            helpTopic={"renameRefactor" as never}
            footer={(
                <>
                    <button type="button" className={dialogFooterButtonClass({ variant: "secondary" })} onClick={close}>
                        {t("common.cancel")}
                    </button>
                    <button
                        type="button"
                        className={dialogFooterButtonClass({ variant: "primary", disabled: blocked })}
                        disabled={blocked}
                        onClick={() => void confirm()}
                    >
                        {t("refactor.dialog.confirm" as TranslationKey)}
                    </button>
                </>
            )}
        >
            <div className="flex flex-col gap-3" data-rename-preview="">
                <div className="flex flex-col gap-1">
                    <FieldLabel>{t("refactor.dialog.newName" as TranslationKey)}</FieldLabel>
                    <Input
                        autoFocus
                        value={name}
                        variant={problemText ? "error" : "default"}
                        onChange={event => setName(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                void confirm();
                            }
                        }}
                        aria-label={t("refactor.dialog.newName" as TranslationKey)}
                        fullWidth
                    />
                    {problemText ? <div className="text-xs text-danger">{problemText}</div> : null}
                </div>

                {plan ? (
                    <>
                        <div className="text-xs text-fg-muted">
                            {tn("refactor.dialog.summary" as never, selected, { count: selected })}
                            {plan.followers.length > 0
                                ? ` · ${tn("refactor.dialog.followers" as never, plan.followers.length, { count: plan.followers.length })}`
                                : ""}
                        </div>

                        {plan.failures.length > 0 ? (
                            <div className="rounded-md border border-danger/40 px-2 py-1.5">
                                <div className="px-2 text-xs text-danger">{t("refactor.dialog.failures" as TranslationKey)}</div>
                                {plan.failures.map(site => <SiteRow key={site.id} site={site} />)}
                            </div>
                        ) : null}

                        <div className="flex max-h-80 flex-col overflow-y-auto rounded-md border border-edge">
                            {groupSites(plan.edits).map(group => (
                                <div key={group.key} className="pb-1">
                                    <GroupHeader site={group.site} />
                                    {group.items.map(edit => (
                                        <EditRow
                                            key={edit.id}
                                            edit={edit}
                                            checked={edit.required || !excluded.has(edit.id)}
                                            onToggle={checked => toggle(edit.id, checked)}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>

                        {plan.followers.length > 0 ? (
                            <details className="text-xs">
                                <summary className="cursor-default select-none text-fg-muted">
                                    {t("refactor.dialog.followersTitle" as TranslationKey)}
                                </summary>
                                <div className="mt-1 flex max-h-48 flex-col overflow-y-auto rounded-md border border-edge-subtle">
                                    {groupSites(plan.followers.map(site => ({ site }))).map(group => (
                                        <div key={group.key} className="pb-1">
                                            <GroupHeader site={group.site} />
                                            {group.items.map(item => <SiteRow key={item.site.id} site={item.site} />)}
                                        </div>
                                    ))}
                                </div>
                            </details>
                        ) : null}
                    </>
                ) : null}
            </div>
        </Modal>
    );
}

export type { RenameRequest };
