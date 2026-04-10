import type { ReactNode } from "react";

type Props = {
    header: ReactNode;
    memberTree: ReactNode;
    canvas: ReactNode;
    inspector: ReactNode;
    diagnostics: ReactNode;
};

export function BlueprintEditorLayout({ header, memberTree, canvas, inspector, diagnostics }: Props) {
    return (
        <div className="flex h-full min-h-0 flex-col bg-[#0f1115] text-sm text-gray-200">
            <header className="flex shrink-0 items-center border-b border-white/10 px-3 py-2">
                <div className="min-w-0 flex-1">{header}</div>
            </header>
            <div className="flex min-h-0 flex-1">
                <aside className="flex w-52 shrink-0 flex-col border-r border-white/10 bg-[#0b0d12]">
                    <div className="min-h-0 flex-1 overflow-y-auto p-2">{memberTree}</div>
                </aside>
                <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#0f1115]">{canvas}</main>
                <aside className="flex w-60 shrink-0 flex-col border-l border-white/10 bg-[#0b0d12] p-2">
                    <p className="mb-1.5 shrink-0 text-[10px] uppercase tracking-wide text-gray-500">Details</p>
                    <div className="min-h-0 flex-1 overflow-y-auto">{inspector}</div>
                </aside>
            </div>
            {diagnostics}
        </div>
    );
}
