import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Boxes, LayoutTemplate, Mic, Users } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { ReferenceService } from "@/lib/workspace/services/references/ReferenceService";
import type { AssetReference, ReferenceSiteKind } from "@/lib/workspace/services/references/referenceModel";
import { useWorkspace } from "../../../context";
import { useRegistry } from "../../../registry";
import { jumpToSearchTarget } from "../../search/searchJump";

const KIND_ICON: Record<ReferenceSiteKind, typeof BookOpen> = {
    story: BookOpen,
    blueprint: Boxes,
    uiElement: LayoutTemplate,
    voice: Mic,
    character: Users,
};

/** Fixed presentation order — narrative first, then logic, then supporting material. */
const KIND_ORDER: readonly ReferenceSiteKind[] = ["story", "blueprint", "uiElement", "character", "voice"];

/**
 * "Where is this asset used?" — the reverse-lookup readout in the asset properties panel.
 *
 * Mounted as a `custom` field on every asset property schema, so this is the one surface that
 * answers the question before a delete rather than after. Results carry the same `SearchJumpTarget`
 * global search uses, so a row jumps straight to the block or blueprint node holding the reference;
 * sites that have no deep link yet (voice takes, character variants) render as plain rows.
 */
export function AssetReferencesSection({ assetId }: { assetId: string }) {
    const { t, tn } = useTranslation();
    const { context } = useWorkspace();
    const { openEditorTab, setPanelVisibility } = useRegistry();
    const [references, setReferences] = useState<AssetReference[]>([]);
    const [building, setBuilding] = useState(true);

    const referenceService = context ? context.services.get<ReferenceService>(Services.Reference) : null;

    useEffect(() => {
        if (!referenceService) {
            return;
        }
        let mounted = true;
        const refresh = () => {
            if (mounted) {
                setReferences(referenceService.getReferences(assetId));
            }
        };
        referenceService
            .ensureReady()
            .then(() => {
                if (mounted) {
                    setBuilding(false);
                    refresh();
                }
            })
            .catch(() => {
                if (mounted) {
                    setBuilding(false);
                }
            });
        // Keep the list live: editing a scene while its properties panel is open should not leave a
        // stale "not referenced" reading behind.
        const unsubscribe = referenceService.onIndexChanged(refresh);
        return () => {
            mounted = false;
            unsubscribe();
        };
    }, [referenceService, assetId]);

    const grouped = useMemo(() => {
        return KIND_ORDER.map(kind => ({
            kind,
            items: references.filter(reference => reference.kind === kind),
        })).filter(group => group.items.length > 0);
    }, [references]);

    const handleJump = useCallback(
        (reference: AssetReference) => {
            if (!reference.target) {
                return;
            }
            jumpToSearchTarget(reference.target, { openEditorTab, setPanelVisibility, context });
        },
        [openEditorTab, setPanelVisibility, context],
    );

    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-fg-muted">
                    {t("properties.references.label")}
                </label>
                {!building && references.length > 0 && (
                    <span className="text-xs text-fg-subtle">
                        {tn("properties.references.count", references.length)}
                    </span>
                )}
            </div>

            {building ? (
                <p className="text-xs text-fg-subtle">{t("properties.references.building")}</p>
            ) : references.length === 0 ? (
                <p className="text-xs text-fg-subtle">{t("properties.references.none")}</p>
            ) : (
                <div className="space-y-2">
                    {grouped.map(group => {
                        const Icon = KIND_ICON[group.kind];
                        return (
                            <div key={group.kind}>
                                <div className="flex items-center gap-1.5 text-xs text-fg-subtle mb-1">
                                    <Icon className="w-3 h-3" />
                                    <span>{t(`properties.references.kind.${group.kind}`)}</span>
                                </div>
                                <ul className="space-y-0.5">
                                    {group.items.map(reference => {
                                        const clickable = Boolean(reference.target);
                                        return (
                                            <li key={reference.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleJump(reference)}
                                                    disabled={!clickable}
                                                    title={reference.field}
                                                    className={`w-full text-left px-2 py-1 rounded text-xs transition-colors cursor-default ${
                                                        clickable
                                                            ? "hover:bg-surface-raised text-fg-muted"
                                                            : "text-fg-subtle"
                                                    }`}
                                                >
                                                    <span className="flex items-baseline gap-1.5">
                                                        <span className="truncate">{reference.label}</span>
                                                        {reference.dormant && (
                                                            <span
                                                                className="shrink-0 px-1 rounded bg-surface-raised text-fg-subtle"
                                                                title={t("properties.references.dormantHint")}
                                                            >
                                                                {t("properties.references.dormant")}
                                                            </span>
                                                        )}
                                                    </span>
                                                    {reference.detail && (
                                                        <span className="block truncate text-fg-subtle">
                                                            {reference.detail}
                                                        </span>
                                                    )}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
