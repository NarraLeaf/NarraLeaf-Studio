import { useRef, useState } from "react";
import { ColorPickerTrigger } from "./ColorPickerField";
import type { ColorValue } from "../types";
import { colorValueToCss, parseColorValue } from "../utils/colorUtils";
import { addRecentColor, useRecentColors } from "./recentColors";

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

function Swatch(props: { color: string; active?: boolean; onPick: (color: string) => void }) {
    return (
        <button
            type="button"
            className={`h-5 w-5 rounded border transition-transform hover:scale-110 ${
                props.active ? "border-white ring-2 ring-white/80 ring-offset-1 ring-offset-[#16191e]" : "border-edge-strong"
            }`}
            style={{ backgroundColor: props.color }}
            title={props.color}
            onClick={() => props.onPick(props.color)}
        />
    );
}

/** Case-insensitive normalized hex key for comparing colors from mixed sources. */
function colorKey(color: string): string {
    return parseColorValue(color, { hex: color, alpha: 1 }).hex.toLowerCase();
}

export function ProjectPalette(props: {
    value?: string;
    /** `commit` is true for a discrete swatch pick, false for continuous custom-picker changes. */
    onPick: (color: string, commit: boolean) => void;
    className?: string;
}) {
    const recent = useRecentColors();
    // Keep the custom picker's preview on the color the author is building, seeded from the
    // currently-active color so re-opening the palette starts where they left off.
    const [current, setCurrent] = useState(() => parseColorValue(props.value ?? "#ffffff", { hex: "#ffffff", alpha: 1 }).hex);
    const colorValue: ColorValue = { hex: current, alpha: 1 };
    const activeKey = colorKey(props.value ?? current);
    // The last color the custom picker produced, recorded to Recent only when the picker commits.
    const pendingCustomRef = useRef<string | null>(null);

    const pickSwatch = (color: string) => {
        setCurrent(parseColorValue(color, { hex: color, alpha: 1 }).hex);
        props.onPick(color, true);
    };

    return (
        <div className={props.className}>
            {PROJECT_PALETTE_SECTIONS.map(section => (
                <div key={section.label} className="mb-2">
                    <div className="mb-1 text-2xs font-medium tracking-wide text-fg-subtle">{section.label}</div>
                    <div className="flex flex-wrap gap-1">
                        {section.colors.map(color => (
                            <Swatch key={color} color={color} active={colorKey(color) === activeKey} onPick={pickSwatch} />
                        ))}
                    </div>
                </div>
            ))}
            <div className="mb-2">
                <div className="mb-1 text-2xs font-medium tracking-wide text-fg-subtle">Recent</div>
                {recent.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                        {recent.map(color => (
                            <Swatch key={color} color={color} active={colorKey(color) === activeKey} onPick={pickSwatch} />
                        ))}
                    </div>
                ) : (
                    <div className="text-2xs text-fg-subtle">No recent colors yet</div>
                )}
            </div>
            <div className="mt-2 flex items-center gap-2 border-t border-edge pt-2">
                <span className="text-2xs font-medium tracking-wide text-fg-subtle">Custom</span>
                <ColorPickerTrigger
                    value={colorValue}
                    displayMode="icon-hex"
                    allowOpacity={false}
                    onChange={next => {
                        const css = colorValueToCss({ hex: next.hex, alpha: 1 });
                        setCurrent(next.hex);
                        pendingCustomRef.current = css;
                        props.onPick(css, false);
                    }}
                    onCommit={() => {
                        if (pendingCustomRef.current) {
                            addRecentColor(pendingCustomRef.current);
                            pendingCustomRef.current = null;
                        }
                    }}
                />
            </div>
        </div>
    );
}
