/**
 * The two halves of component params in the inspector: declaring them on the definition, and
 * supplying them on one placement.
 *
 * They live in one file because they are one contract read from both ends - the declare side's
 * `defaultValue` is what the supply side falls back to, and the supply side's field list is exactly
 * what the declare side wrote. Splitting them would put the two spellings of that list in two
 * places.
 *
 * Comments in English per project convention.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
    getUIComponentLink,
    getUIComponentParams,
    type UIComponentDefinition,
    type UIComponentParam,
    type UIElement,
} from "@shared/types/ui-editor/document";
// SectionCard is missing from the elements barrel, so it comes from its own module.
import { FieldLabel, IconButton, Input } from "@/lib/components/elements";
import { SectionCard } from "@/lib/components/elements/SectionCard";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";

/**
 * A text field that keeps what is typed and commits it when focus leaves - the same bargain the
 * inspector's other text fields make.
 *
 * Not a nicety here: `setComponentParams` trims what it stores, so a per-keystroke write would echo
 * "Save " back as "Save" and the author could never type a space into a param name at all.
 */
function DraftInput({
    value,
    placeholder,
    disabled,
    title,
    onCommit,
}: {
    value: string;
    placeholder?: string;
    disabled?: boolean;
    title?: string;
    onCommit: (next: string) => void;
}) {
    const [draft, setDraft] = useState(value);
    const [editing, setEditing] = useState(false);

    /**
     * An edit elsewhere should land in the field - but not on top of what is being typed into it.
     *
     * `editing` is state rather than a ref so that leaving the field re-runs this: the write is
     * normalised on the way in (names are trimmed), and when the normalised result equals what was
     * already stored, `value` does not change and nothing else would put the field back.
     */
    useEffect(() => {
        if (!editing) {
            setDraft(value);
        }
    }, [editing, value]);

    return (
        <Input
            size="sm"
            fullWidth
            className="min-w-0"
            value={draft}
            placeholder={placeholder}
            disabled={disabled}
            data-tip={title}
            onFocus={() => setEditing(true)}
            onChange={event => setDraft(event.target.value)}
            onBlur={() => {
                setEditing(false);
                if (draft !== value) {
                    onCommit(draft);
                }
            }}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                }
            }}
        />
    );
}

/**
 * A fresh param id.
 *
 * Generated rather than typed because the id is what a blueprint node and every instance value point
 * at: if the author edited it, renaming a param in the inspector would silently unpoint both. The
 * name is the editable half and carries no identity at all.
 */
function nextParamId(existing: UIComponentParam[]): string {
    const taken = new Set(existing.map(param => param.id));
    for (let index = 1; ; index++) {
        const id = `param${index}`;
        if (!taken.has(id)) {
            return id;
        }
    }
}

export function ComponentParamsEditor({
    component,
    documentService,
}: {
    component: UIComponentDefinition;
    documentService: UIDocumentService;
}) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const params = useMemo(() => getUIComponentParams(component), [component]);

    const write = useCallback(
        (next: UIComponentParam[]) => {
            documentService.setComponentParams(component.id, next);
        },
        [component.id, documentService],
    );

    const patchParam = useCallback(
        (id: string, patch: Partial<UIComponentParam>) => {
            write(params.map(param => (param.id === id ? { ...param, ...patch } : param)));
        },
        [params, write],
    );

    return (
        <SectionCard
            title={t("properties.componentParams.title")}
            actions={
                <IconButton
                    size="sm"
                    aria-label={t("properties.componentParams.add")}
                    {...freeze.writes(false, t("properties.componentParams.add"))}
                    onClick={() =>
                        write([
                            ...params,
                            { id: nextParamId(params), name: "", type: "string", defaultValue: "" },
                        ])
                    }
                >
                    <Plus className="h-4 w-4" />
                </IconButton>
            }
            bodyClassName="space-y-2"
        >
            {params.length === 0 ? (
                <p className="text-2xs text-fg-subtle">{t("properties.componentParams.none")}</p>
            ) : (
                params.map(param => (
                    <div key={param.id} className="flex items-center gap-2">
                        <DraftInput
                            value={param.name}
                            placeholder={t("properties.componentParams.namePlaceholder")}
                            {...freeze.writes()}
                            onCommit={next => patchParam(param.id, { name: next })}
                        />
                        <DraftInput
                            value={param.defaultValue}
                            placeholder={t("properties.componentParams.defaultPlaceholder")}
                            {...freeze.writes()}
                            onCommit={next => patchParam(param.id, { defaultValue: next })}
                        />
                        <IconButton
                            size="sm"
                            className="shrink-0"
                            aria-label={t("properties.componentParams.remove")}
                            {...freeze.writes(false, t("properties.componentParams.remove"))}
                            onClick={() => write(params.filter(item => item.id !== param.id))}
                        >
                            <Trash2 className="h-4 w-4" />
                        </IconButton>
                    </div>
                ))
            )}
        </SectionCard>
    );
}

/**
 * The supply half, shown on a selected instance.
 *
 * `updateElementProps` refuses linked instances by design - an instance is the definition, moved -
 * so these values are the one thing about a placement that is not the definition's, and the only
 * thing besides its layout that this inspector can write.
 */
export function LinkedComponentParamsField({
    element,
    documentService,
}: {
    element: UIElement;
    documentService: UIDocumentService;
}) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const link = getUIComponentLink(element);
    const component = link ? documentService.getComponent(link.componentId) : null;
    const params = getUIComponentParams(component);

    if (!link || params.length === 0) {
        return null;
    }

    return (
        <SectionCard title={t("properties.componentParams.title")} bodyClassName="space-y-2">
            {params.map(param => {
                const supplied = link.params?.[param.id];
                return (
                    <div key={param.id}>
                        <FieldLabel as="div">{param.name.trim() || param.id}</FieldLabel>
                        <DraftInput
                            value={supplied ?? ""}
                            // The declared default is the placeholder, not the value: an instance
                            // that has not overridden a param stores nothing, and prefilling the
                            // field would turn opening the inspector into an edit. It is dropped
                            // once the instance HAS stored something, because an override of "" is
                            // a value and the default showing through would say the opposite.
                            placeholder={typeof supplied === "string" ? "" : param.defaultValue}
                            {...freeze.writes()}
                            onCommit={next =>
                                documentService.setComponentInstanceParam(element.id, param.id, next)
                            }
                        />
                    </div>
                );
            })}
        </SectionCard>
    );
}
