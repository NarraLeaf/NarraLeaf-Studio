import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { ownerRefToIndexKey } from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import type { Blueprint } from "@shared/types/blueprint/document";

type Props = {
    blueprint: Blueprint;
    localBp: LocalBlueprintService;
    /** After creating a sibling or switching active, reopen tab for the chosen blueprint id. */
    onReopenRevision?: (blueprintId: string) => void;
};

/**
 * Lists private blueprint revisions for the same owner slot and supports active switch + new sibling.
 */
export function BlueprintPrivateRevisionBar({ blueprint, localBp, onReopenRevision }: Props) {
    if (blueprint.owner.kind === "sharedAsset") {
        return (
            <p className="text-2xs text-fg-subtle">One revision per shared asset.</p>
        );
    }

    const ownerKey = ownerRefToIndexKey(blueprint.owner);
    const doc = localBp.getBlueprintDocument();
    const rec = doc.ownerRecords[ownerKey];
    const ids = rec?.privateBlueprintIds ?? [];
    const allowTypeScriptRevision = blueprint.owner.kind !== "widgetValue";

    return (
        <div className="space-y-2 text-2xs text-fg-muted">
            <p className="text-2xs tracking-wide text-fg-subtle">Revisions</p>
            <ul className="space-y-1">
                {ids.map(id => {
                    const b = doc.blueprints[id];
                    const active = rec?.activeBlueprintId === id;
                    return (
                        <li key={id} className="flex items-center gap-2">
                            <button
                                type="button"
                                className={`truncate text-left font-mono text-2xs ${active ? "text-cyan-300" : "text-fg-muted hover:text-fg"}`}
                                onClick={() => {
                                    if (!active) {
                                        localBp.setActivePrivateBlueprintForOwnerKey(ownerKey, id);
                                        onReopenRevision?.(id);
                                    }
                                }}
                            >
                                {b?.name ?? id} {active ? "· active" : ""}
                            </button>
                        </li>
                    );
                })}
            </ul>
            <div className="flex flex-wrap gap-2 pt-1">
                {allowTypeScriptRevision ? (
                    <button
                        type="button"
                        className="rounded border border-edge bg-fill-subtle px-2 py-1 text-2xs text-fg hover:bg-fill"
                        onClick={() => {
                            const newId = localBp.createSiblingPrivateBlueprintForOwnerKey(ownerKey, "typescript");
                            onReopenRevision?.(newId);
                        }}
                    >
                        New TypeScript revision
                    </button>
                ) : null}
                <button
                    type="button"
                    className="rounded border border-edge bg-fill-subtle px-2 py-1 text-2xs text-fg hover:bg-fill"
                    onClick={() => {
                        const newId = localBp.createSiblingPrivateBlueprintForOwnerKey(ownerKey, "visual");
                        onReopenRevision?.(newId);
                    }}
                >
                    New Visual revision
                </button>
            </div>
        </div>
    );
}
