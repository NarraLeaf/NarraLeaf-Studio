import type { BlueprintFrontendKind } from "@shared/types/blueprint/document";

const LABEL: Record<BlueprintFrontendKind, string> = {
    visual: "Visual",
    typescript: "TypeScript",
};

export function BlueprintFrontendBadge({ kind }: { kind: BlueprintFrontendKind }) {
    const isTs = kind === "typescript";
    return (
        <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                isTs ? "bg-amber-500/15 text-amber-200/90" : "bg-cyan-500/15 text-cyan-200/90"
            }`}
        >
            {LABEL[kind]}
        </span>
    );
}
