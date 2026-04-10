import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";

export type BlueprintFlowNodeData = {
    catalog: BlueprintNodeEditorCatalogEntry;
};

const EXEC_HANDLE_CLASS = "!h-2 !w-2 !border border-white/30 !bg-cyan-500";
const DATA_HANDLE_CLASS = "!h-2 !w-2 !border border-amber-200/35 !bg-amber-500";

export function BlueprintFlowNode({ data, selected }: NodeProps) {
    const { catalog } = data as BlueprintFlowNodeData;
    const execIns = catalog.pins.filter(p => p.kind === "input" && p.semantic === "exec");
    const execOuts = catalog.pins.filter(p => p.kind === "output" && p.semantic === "exec");
    const dataIns = catalog.pins.filter(p => p.kind === "input" && p.semantic === "data");
    const dataOuts = catalog.pins.filter(p => p.kind === "output" && p.semantic === "data");

    const isEventHead = catalog.role === "eventHead";

    return (
        <div
            className={`rounded-md border bg-[#1a1d21] px-2 py-2 min-w-[168px] text-xs shadow-md ${
                selected ? "border-cyan-400/80 ring-1 ring-cyan-500/40" : "border-white/15"
            } ${isEventHead ? "border-l-2 border-l-cyan-400/70" : ""}`}
        >
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">{catalog.category}</div>
            <div className="font-medium text-gray-100 leading-tight">{catalog.displayName}</div>
            <div className="relative mt-1 min-h-[28px]">
                {execIns.map((pin, idx) => (
                    <Handle
                        key={`e-in-${pin.id}`}
                        type="target"
                        position={Position.Left}
                        id={pin.id}
                        className={EXEC_HANDLE_CLASS}
                        title={pin.label ?? pin.id}
                        style={{
                            top: `${execIns.length === 1 ? 50 : ((idx + 1) / (execIns.length + 1)) * 100}%`,
                        }}
                    />
                ))}
                {execOuts.map((pin, idx) => (
                    <Handle
                        key={`e-out-${pin.id}`}
                        type="source"
                        position={Position.Right}
                        id={pin.id}
                        className={EXEC_HANDLE_CLASS}
                        title={pin.label ?? pin.id}
                        style={{
                            top: `${execOuts.length === 1 ? 50 : ((idx + 1) / (execOuts.length + 1)) * 100}%`,
                        }}
                    />
                ))}
            </div>
            {dataIns.length > 0 || dataOuts.length > 0 ? (
                <div className="relative mt-1 min-h-[20px] border-t border-white/5 pt-1">
                    {dataIns.map((pin, idx) => (
                        <Handle
                            key={`d-in-${pin.id}`}
                            type="target"
                            position={Position.Left}
                            id={pin.id}
                            className={DATA_HANDLE_CLASS}
                            title={pin.label ?? pin.id}
                            style={{ top: 6 + idx * 18 }}
                        />
                    ))}
                    {dataOuts.map((pin, idx) => (
                        <Handle
                            key={`d-out-${pin.id}`}
                            type="source"
                            position={Position.Right}
                            id={pin.id}
                            className={DATA_HANDLE_CLASS}
                            title={pin.label ?? pin.id}
                            style={{ top: 6 + idx * 18 }}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    );
}
