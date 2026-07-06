import { ColorPickerTrigger } from "./ColorPickerField";
import type { ColorValue } from "../types";
import { colorValueToCss, parseColorValue } from "../utils/colorUtils";
import { useRecentColors } from "./recentColors";

/**
 * Project Palette — a curated color palette built on top of the project color picker. It offers
 * quick base / common swatches, a session "recent colors" section, and a full custom picker, and is
 * reusable anywhere a color needs to be chosen from a consistent, opinionated set.
 */
export const PROJECT_PALETTE_SECTIONS: { label: string; colors: string[] }[] = [
    {
        label: "Base",
        colors: ["#ffffff", "#e5e7eb", "#9ca3af", "#6b7280", "#374151", "#111827", "#000000", "#40a8c4"],
    },
    {
        label: "Common",
        colors: [
            "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#10b981", "#14b8a6",
            "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e",
        ],
    },
];

function Swatch(props: { color: string; onPick: (color: string, commit: boolean) => void }) {
    return (
        <button
            type="button"
            className="h-5 w-5 rounded border border-white/20 transition-transform hover:scale-110"
            style={{ backgroundColor: props.color }}
            title={props.color}
            onClick={() => props.onPick(props.color, true)}
        />
    );
}

export function ProjectPalette(props: {
    value?: string;
    /** `commit` is true for a discrete swatch pick, false for continuous custom-picker changes. */
    onPick: (color: string, commit: boolean) => void;
    className?: string;
}) {
    const parsed = parseColorValue(props.value ?? "#ffffff", { hex: "#ffffff", alpha: 1 });
    const colorValue: ColorValue = { hex: parsed.hex, alpha: 1 };
    const recent = useRecentColors();
    return (
        <div className={props.className}>
            {PROJECT_PALETTE_SECTIONS.map(section => (
                <div key={section.label} className="mb-2">
                    <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">{section.label}</div>
                    <div className="flex flex-wrap gap-1">
                        {section.colors.map(color => <Swatch key={color} color={color} onPick={props.onPick} />)}
                    </div>
                </div>
            ))}
            <div className="mb-2">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">Recent</div>
                {recent.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                        {recent.map(color => <Swatch key={color} color={color} onPick={props.onPick} />)}
                    </div>
                ) : (
                    <div className="text-[10px] text-slate-600">No recent colors yet</div>
                )}
            </div>
            <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Custom</span>
                <ColorPickerTrigger
                    value={colorValue}
                    displayMode="icon-hex"
                    allowOpacity={false}
                    onChange={next => props.onPick(colorValueToCss({ hex: next.hex, alpha: 1 }), false)}
                />
            </div>
        </div>
    );
}
