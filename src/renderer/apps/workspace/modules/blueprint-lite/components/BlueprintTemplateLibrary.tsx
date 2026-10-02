/**
 * The blueprint template library: every template that suits one blueprint, shelved by category.
 *
 * It opens from the tile beside the blank layer on a blueprint with no layers, and from the layer
 * panel once there are some - a library reachable only from an empty blueprint would be gone the
 * moment it had been used once. Only templates that compile for this blueprint are listed, so a
 * shelf is never padded with templates the blueprint cannot take; a shelf with none is not shown.
 *
 * Laid out as the interface template store is: a card per template that opens a detail view, and an
 * Add on both. The detail view draws the graph the template builds for this blueprint and lists what
 * is left to choose, which is what decides between two templates that sound alike.
 */

import { useMemo, useState } from "react";
import { ChevronLeft, LayoutTemplate } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { Button, EmptyState, Modal, SearchInput } from "@/lib/components/elements";
import { resolveBlueprintNodeEditorCatalogEntryForNode } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import {
    BLUEPRINT_TEMPLATE_CATEGORIES,
    blueprintTemplateText,
    type BlueprintLayerTemplate,
    type BlueprintTemplateCategory,
} from "../templates/blueprintLayerTemplates";
import type { BuiltBlueprintLayerTemplate } from "../templates/buildBlueprintLayerTemplate";
import { resolveBlueprintLabel, resolveBlueprintNodeTitle } from "../blueprintNodeI18n";
import { BlueprintTemplatePreview } from "./BlueprintTemplatePreview";

type Props = {
    isOpen: boolean;
    onClose: () => void;
    /** The templates that suit this blueprint, already narrowed and in library order. */
    templates: readonly BlueprintLayerTemplate[];
    /** The graph a template builds for this blueprint, for the preview and the list of choices. */
    build: (template: BlueprintLayerTemplate) => BuiltBlueprintLayerTemplate | null;
    onAdd: (template: BlueprintLayerTemplate) => void;
    /** Set while the blueprint may not be written, and says why; browsing stays open. */
    addDisabledReason?: string;
};

type Shelf = "all" | BlueprintTemplateCategory;

export function BlueprintTemplateLibrary({ isOpen, onClose, templates, build, onAdd, addDisabledReason }: Props) {
    const { t, locale } = useTranslation();
    const [shelf, setShelf] = useState<Shelf>("all");
    const [query, setQuery] = useState("");
    const [detailId, setDetailId] = useState<string | null>(null);

    const shelves = useMemo(
        () => BLUEPRINT_TEMPLATE_CATEGORIES
            .map(category => ({
                ...category,
                count: templates.filter(template => template.category === category.id).length,
            }))
            .filter(category => category.count > 0),
        [templates],
    );

    const shown = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return templates.filter(template => {
            if (shelf !== "all" && template.category !== shelf) {
                return false;
            }
            if (!needle) {
                return true;
            }
            const text = blueprintTemplateText(template, locale);
            // English is searched as well, so a term from the documentation finds the template
            // whatever language the editor is in.
            return [text.title, text.description, template.text.en.title, t(`blueprint.templateLibrary.category.${template.category}`)]
                .join(" ")
                .toLowerCase()
                .includes(needle);
        });
    }, [locale, query, shelf, t, templates]);

    const detail = detailId ? templates.find(template => template.id === detailId) ?? null : null;

    const close = () => {
        setDetailId(null);
        onClose();
    };

    const add = (template: BlueprintLayerTemplate) => {
        if (addDisabledReason) {
            return;
        }
        onAdd(template);
        setDetailId(null);
        // The layer opens behind the library; leaving the library over it hides what was just made.
        onClose();
    };

    return (
        <Modal isOpen={isOpen} onClose={close} title={t("blueprint.templateLibrary.title")} size="xl">
            <div className="flex h-[34rem] min-h-0 flex-col">
                {detail ? (
                    <TemplateDetail
                        template={detail}
                        built={build(detail)}
                        addDisabledReason={addDisabledReason}
                        onAdd={() => add(detail)}
                        onBack={() => setDetailId(null)}
                    />
                ) : (
                    <>
                        <SearchInput
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            placeholder={t("blueprint.templateLibrary.search")}
                            size="sm"
                            fullWidth
                        />
                        <div className="mt-3 flex min-h-0 flex-1 gap-4">
                            <nav aria-label={t("blueprint.templateLibrary.categoriesLabel")} className="w-40 shrink-0 overflow-y-auto">
                                <ul className="flex flex-col gap-0.5">
                                    <ShelfButton
                                        icon={<LayoutTemplate className="h-4 w-4" aria-hidden />}
                                        label={t("blueprint.templateLibrary.all")}
                                        count={templates.length}
                                        active={shelf === "all"}
                                        onClick={() => setShelf("all")}
                                    />
                                    {shelves.map(category => {
                                        const Icon = category.icon;
                                        return (
                                            <ShelfButton
                                                key={category.id}
                                                icon={<Icon className="h-4 w-4" aria-hidden />}
                                                label={t(`blueprint.templateLibrary.category.${category.id}`)}
                                                count={category.count}
                                                active={shelf === category.id}
                                                onClick={() => setShelf(category.id)}
                                            />
                                        );
                                    })}
                                </ul>
                            </nav>
                            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                                {shown.length === 0 ? (
                                    <EmptyState
                                        icon={<LayoutTemplate className="h-6 w-6" />}
                                        title={templates.length === 0
                                            ? t("blueprint.templateLibrary.empty")
                                            : t("blueprint.templateLibrary.emptyFiltered")}
                                    />
                                ) : (
                                    <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
                                        {shown.map(template => (
                                            <li key={template.id}>
                                                <TemplateCard
                                                    template={template}
                                                    addDisabledReason={addDisabledReason}
                                                    onOpen={() => setDetailId(template.id)}
                                                    onAdd={() => add(template)}
                                                />
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </Modal>
    );
}

function ShelfButton(props: { icon: React.ReactNode; label: string; count: number; active: boolean; onClick: () => void }) {
    return (
        <li>
            <button
                type="button"
                onClick={props.onClick}
                aria-current={props.active ? "true" : undefined}
                className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors duration-150",
                    "focus-visible:bg-fill",
                    props.active ? "bg-primary/15 text-fg" : "text-fg-muted hover:bg-fill",
                )}
            >
                <span className={props.active ? "text-primary" : "text-fg-subtle"}>{props.icon}</span>
                <span className="min-w-0 flex-1 truncate">{props.label}</span>
                <span className="tabular-nums text-2xs text-fg-subtle">{props.count}</span>
            </button>
        </li>
    );
}

function TemplateCard(props: {
    template: BlueprintLayerTemplate;
    addDisabledReason?: string;
    onOpen: () => void;
    onAdd: () => void;
}) {
    const { t, locale } = useTranslation();
    const text = blueprintTemplateText(props.template, locale);
    const Icon = props.template.icon;
    return (
        <div className="flex h-full flex-col overflow-hidden rounded-md border border-edge bg-surface-raised">
            <button
                type="button"
                onClick={props.onOpen}
                data-tip={t("blueprint.templateLibrary.openDetail")}
                className="group flex min-w-0 flex-1 flex-col items-start gap-1.5 p-3 text-left transition-colors duration-150 hover:bg-fill-subtle focus-visible:bg-fill-subtle"
            >
                <span className="flex items-center gap-2">
                    <span className="text-fg-muted transition-colors duration-150 group-hover:text-primary">
                        <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="text-2xs text-fg-subtle">
                        {t(`blueprint.templateLibrary.category.${props.template.category}`)}
                    </span>
                </span>
                <span className="text-sm font-medium text-fg">{text.title}</span>
                <span className="line-clamp-2 text-xs leading-relaxed text-fg-muted">{text.description}</span>
            </button>
            <div className="p-3 pt-0">
                <Button
                    variant="secondary"
                    size="sm"
                    fullWidth
                    disabled={Boolean(props.addDisabledReason)}
                    data-tip={props.addDisabledReason}
                    onClick={props.onAdd}
                >
                    {t("blueprint.templateLibrary.add")}
                </Button>
            </div>
        </div>
    );
}

function TemplateDetail(props: {
    template: BlueprintLayerTemplate;
    built: BuiltBlueprintLayerTemplate | null;
    addDisabledReason?: string;
    onAdd: () => void;
    onBack: () => void;
}) {
    const { t, locale } = useTranslation();
    const text = blueprintTemplateText(props.template, locale);
    const Icon = props.template.icon;
    // What is left to choose, as the node card and inspector name it: "Go Page · Page".
    const choices = useMemo(() => {
        const nodes = props.built?.ir.nodes ?? {};
        return (props.built?.pending ?? []).flatMap(({ nodeId, keys }) => {
            const node = nodes[nodeId];
            if (!node) {
                return [];
            }
            const catalog = resolveBlueprintNodeEditorCatalogEntryForNode(node.type, node.params);
            const title = resolveBlueprintNodeTitle(catalog.displayName, t);
            return keys.map(key => {
                const label = catalog.inspectorParams?.find(param => param.key === key)?.label
                    ?? catalog.pins.find(pin => pin.id === key)?.label
                    ?? key;
                return `${title} · ${resolveBlueprintLabel(label, t)}`;
            });
        });
    }, [props.built, t]);

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex items-center">
                <Button variant="ghost" size="sm" onClick={props.onBack}>
                    <ChevronLeft className="h-4 w-4" />
                    {t("blueprint.templateLibrary.back")}
                </Button>
            </div>
            <div className="flex shrink-0 flex-col gap-4 md:flex-row">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-fg-muted">
                        <Icon className="h-4 w-4" aria-hidden />
                        <span className="text-2xs text-fg-subtle">
                            {t(`blueprint.templateLibrary.category.${props.template.category}`)}
                        </span>
                    </div>
                    <div className="text-base font-medium text-fg">{text.title}</div>
                    <p className="text-xs leading-relaxed text-fg-muted">{text.description}</p>
                </div>
                <div className="flex min-w-0 flex-col gap-1.5 md:w-64 md:shrink-0">
                    {choices.length === 0 ? (
                        <p className="text-xs text-fg-muted">{t("blueprint.templateLibrary.choicesNone")}</p>
                    ) : (
                        <>
                            <div className="text-2xs font-medium text-fg-subtle">{t("blueprint.templateLibrary.choicesHeading")}</div>
                            <ul className="flex flex-col gap-1 text-xs text-fg-muted">
                                {choices.map((choice, index) => (
                                    <li key={`${choice}:${index}`} className="flex items-center gap-2">
                                        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                        {choice}
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>
            </div>
            {/* The graph takes whatever height is left and the dialog's whole width: it runs left to
                right, and beside the text it was drawn too small to read. */}
            <div className="min-h-[12rem] flex-1 overflow-hidden rounded-md border border-edge bg-surface-canvas">
                {props.built ? (
                    <BlueprintTemplatePreview ir={props.built.ir} pendingNodeIds={props.built.pendingNodeIds} />
                ) : null}
            </div>
            <div className="shrink-0 border-t border-edge pt-3">
                <Button
                    variant="primary"
                    size="sm"
                    fullWidth
                    disabled={Boolean(props.addDisabledReason)}
                    data-tip={props.addDisabledReason}
                    onClick={props.onAdd}
                >
                    {t("blueprint.templateLibrary.add")}
                </Button>
            </div>
        </div>
    );
}
