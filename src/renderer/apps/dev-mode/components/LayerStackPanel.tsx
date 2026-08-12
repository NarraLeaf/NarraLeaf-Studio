import { type ReactNode } from "react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { EmptyState } from "@/lib/components/elements/EmptyState";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import type { GameAppCompositeView } from "@/lib/ui-editor/runtime/app/GameAppHost";
import { DevModePanelModeToggle, type DevModePanelChrome } from "./DevModePanelChrome";
import {
    buildCompositeStackView,
    type CompositeStackLayerRow,
    type CompositeStackPageRow,
    type CompositeStackQueuedRow,
} from "./layerStackPanelModel";

export type LayerStackPanelProps = {
    /** The composite as the running app assembled it, input ownership included. */
    composite: GameAppCompositeView;
    className?: string;
    /** Dock/float mode toggle + title-bar drag, owned by DevModeContent. */
    chrome?: DevModePanelChrome;
};

/**
 * Everything on screen at once, and who owns input.
 *
 * With more than one surface up, "I clicked it and nothing happened" has no other answer: a modal
 * layer turns everything under it inert, exactly one slot on the whole stack takes the keys, and
 * neither fact is visible in the pixels. So each row states both, and the keyboard owner is marked
 * on the one row that holds it.
 *
 * It also reports the two states that are invisible by construction: a layer the stack holds and
 * the screen does not (its surface is missing from the running project), and a layer queued behind
 * an occupied group, which has a live handle and no frame.
 */
export function LayerStackPanel(props: LayerStackPanelProps): ReactNode {
    const { composite, className, chrome } = props;
    const { t } = useTranslation();
    const view = buildCompositeStackView(composite);
    const offScreenCount = view.layerCount - view.onScreenCount;

    return (
        <div
            className={cn(
                "flex h-full min-h-0 shrink-0 flex-col bg-surface-sunken text-2xs text-fg-muted",
                // See RuntimeIssuesPanel: the left hairline is the seam against the stage, and a
                // floating panel already has a frame of its own.
                !chrome?.floating && "border-l border-edge",
                className,
            )}
        >
            <div
                className={cn(
                    "flex shrink-0 items-center justify-between gap-2 border-b border-edge px-2 py-1.5",
                    chrome?.floating && "cursor-grab select-none active:cursor-grabbing",
                )}
                onPointerDown={chrome?.onTitleBarPointerDown}
            >
                <div className="flex min-w-0 items-baseline gap-2">
                    <span className="text-xs font-medium text-fg">{t("devMode.layers.title")}</span>
                    {view.layerCount > 0 ? (
                        <span className={cn("truncate", offScreenCount > 0 && "text-warning")}>
                            {t("devMode.layers.onScreenCount", {
                                onScreen: view.onScreenCount,
                                total: view.layerCount,
                            })}
                        </span>
                    ) : null}
                </div>
                <DevModePanelModeToggle chrome={chrome} />
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-2">
                {view.rows.length === 0 && view.queued.length === 0 ? (
                    <EmptyState size="sm" description={t("devMode.layers.empty")} />
                ) : (
                    <div className="flex flex-col gap-3">
                        {offScreenCount > 0 ? (
                            <p className="text-warning">{t("devMode.layers.offScreenNote")}</p>
                        ) : null}
                        {view.exitPending ? <p>{t("devMode.layers.exitPending")}</p> : null}
                        {view.rows.length > 0 ? (
                            <section>
                                <FieldLabel as="div">{t("devMode.layers.stack")}</FieldLabel>
                                <ul className="flex flex-col gap-2">
                                    {view.rows.map(row => (
                                        <li key={row.key} className={rowClass}>
                                            {row.kind === "page"
                                                ? <PageRow row={row} />
                                                : <LayerRow row={row} />}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ) : null}
                        {view.queued.length > 0 ? (
                            <section>
                                <FieldLabel as="div">{t("devMode.layers.queued")}</FieldLabel>
                                <ul className="flex flex-col gap-2">
                                    {view.queued.map(row => (
                                        <li key={row.key} className={rowClass}>
                                            <QueuedRow row={row} />
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );
}

/** The frame every row shares: a hairline under it, none under the last. */
const rowClass = "flex flex-col gap-0.5 border-b border-edge-subtle pb-2 last:border-0 last:pb-0";

/** Surface name on the left, the mount counter off the end of the key on the right. */
function RowHeading(props: { label: string; keyTail: string; missing: boolean }): ReactNode {
    return (
        <div className="flex items-baseline justify-between gap-2">
            <span className={cn("min-w-0 truncate text-xs", props.missing ? "text-warning" : "text-fg")}>
                {props.label}
            </span>
            <span className="shrink-0 text-fg-subtle">{props.keyTail}</span>
        </div>
    );
}

/** The facts about a row, read as one line with middots between them. */
function RowFacts(props: { children: ReactNode }): ReactNode {
    return <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">{props.children}</div>;
}

function Separator(): ReactNode {
    return <span aria-hidden className="text-fg-subtle">·</span>;
}

/** Who takes clicks, and the single row that takes the keys. */
function InputFacts(props: { interactive: boolean; keyboardOwner: boolean }): ReactNode {
    const { t } = useTranslation();
    return (
        <RowFacts>
            <span className={props.interactive ? undefined : "text-fg-subtle"}>
                {props.interactive ? t("devMode.layers.takesClicks") : t("devMode.layers.takesNoClicks")}
            </span>
            {props.keyboardOwner ? (
                <>
                    <Separator />
                    <span className="text-primary">{t("devMode.layers.keyboard")}</span>
                </>
            ) : null}
        </RowFacts>
    );
}

function PageRow(props: { row: CompositeStackPageRow }): ReactNode {
    const { row } = props;
    const { t } = useTranslation();
    return (
        <>
            <RowHeading label={row.label} keyTail={row.keyTail} missing={row.surfaceMissing} />
            <RowFacts>
                <span>{t("devMode.layers.page")}</span>
            </RowFacts>
            <InputFacts interactive={row.interactive} keyboardOwner={row.keyboardOwner} />
        </>
    );
}

function LayerRow(props: { row: CompositeStackLayerRow }): ReactNode {
    const { row } = props;
    const { t } = useTranslation();
    return (
        <>
            <RowHeading label={row.label} keyTail={row.keyTail} missing={row.surfaceMissing} />
            <RowFacts>
                {row.modal ? (
                    <>
                        <span>{t("devMode.layers.modal")}</span>
                        <Separator />
                    </>
                ) : null}
                <span>
                    {row.dismissible ? t("devMode.layers.dismissible") : t("devMode.layers.notDismissible")}
                </span>
                {row.group ? (
                    <>
                        <Separator />
                        <span>{t("devMode.layers.group", { group: row.group })}</span>
                    </>
                ) : null}
            </RowFacts>
            {row.onScreen ? null : (
                <div className="text-warning">{t("devMode.layers.offScreen")}</div>
            )}
            <InputFacts interactive={row.interactive} keyboardOwner={row.keyboardOwner} />
            {row.owner ? (
                <div className="truncate text-fg-subtle">
                    {t("devMode.layers.owner", { owner: row.owner })}
                </div>
            ) : null}
        </>
    );
}

function QueuedRow(props: { row: CompositeStackQueuedRow }): ReactNode {
    const { row } = props;
    const { t } = useTranslation();
    return (
        <>
            <RowHeading label={row.label} keyTail={row.keyTail} missing={row.surfaceMissing} />
            <RowFacts>
                {row.modal ? (
                    <>
                        <span>{t("devMode.layers.modal")}</span>
                        <Separator />
                    </>
                ) : null}
                <span>{row.group ? t("devMode.layers.group", { group: row.group }) : t("devMode.layers.queued")}</span>
            </RowFacts>
            {row.owner ? (
                <div className="truncate text-fg-subtle">
                    {t("devMode.layers.owner", { owner: row.owner })}
                </div>
            ) : null}
        </>
    );
}
