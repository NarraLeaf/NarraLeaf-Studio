import type { Blueprint } from "@shared/types/blueprint/document";

export function listBlueprintsForDevTools(blueprints: Record<string, Blueprint>): Blueprint[] {
    return Object.values(blueprints)
        .filter(shouldShowBlueprintInDevTools)
        .sort((a, b) => a.name.localeCompare(b.name));
}

function shouldShowBlueprintInDevTools(bp: Blueprint): boolean {
    if (bp.owner.kind === "sharedAsset" || bp.frontend === "typescript" || bp.program.kind === "scriptModule") {
        return true;
    }

    return (
        hasRecordEntries(bp.members?.variables) ||
        hasRecordEntries(bp.members?.fields) ||
        hasRecordEntries(bp.members?.functions) ||
        hasRecordEntries(bp.bindings) ||
        hasRecordEntries(bp.program.graphs.events) ||
        hasRecordEntries(bp.program.graphs.functions) ||
        hasRecordEntries(bp.program.graphs.macros)
    );
}

function hasRecordEntries(value: Record<string, unknown> | undefined): boolean {
    return Boolean(value && Object.keys(value).length > 0);
}
