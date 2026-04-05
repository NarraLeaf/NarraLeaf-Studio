import type { ReactNode } from "react";
import { Workflow } from "lucide-react";

type Props = {
    header: ReactNode;
    memberTree: ReactNode;
    canvas: ReactNode;
    palette: ReactNode;
    inspector: ReactNode;
    diagnostics: ReactNode;
};

export function BlueprintEditorLayout({ header, memberTree, canvas, palette, inspector, diagnostics }: Props) {
    return (
        <div className="flex h-full min-h-0 flex-col bg-[#0d0f11] text-sm text-gray-200">
            <div className="flex shrink-0 items-start gap-3 border-b border-white/10 px-4 py-3">
                <Workflow className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400/90" />
                <div className="min-w-0 flex-1">{header}</div>
            </div>
            <div className="flex min-h-0 flex-1">
                <aside className="w-56 shrink-0 overflow-auto border-r border-white/10 bg-[#111315] p-3">
                    {memberTree}
                </aside>
                <main className="flex min-w-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1">{canvas}</div>
                    <div className="shrink-0 border-t border-white/10 bg-[#111315] px-3 py-2">{palette}</div>
                </main>
                <aside className="w-64 shrink-0 overflow-auto border-l border-white/10 bg-[#111315] p-3">
                    <p className="mb-2 text-[10px] uppercase tracking-wide text-gray-500">Inspector</p>
                    {inspector}
                </aside>
            </div>
            {diagnostics}
        </div>
    );
}
