/**
 * The Page Overview's card in the interface panel: a drawing of what the overview shows - a page,
 * its controls, and the lines from them to where they lead - at the size of a page preview beside
 * it. Drawn rather than rendered from the project, so it costs nothing and reads the same whatever
 * the project holds; the pages themselves are the cards next to it.
 */
export function PageOverviewThumbnail() {
    return (
        <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-sm bg-surface-canvas">
            <svg viewBox="0 0 120 68" className="h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                <g className="text-fg-subtle" stroke="currentColor" fill="none" strokeWidth={0.8}>
                    <rect x={8} y={14} width={32} height={40} rx={2} />
                    <rect x={90} y={14} width={22} height={14} rx={1.5} />
                    <rect x={90} y={40} width={22} height={14} rx={1.5} />
                    <path d="M40 24 C46 24 46 20 52 20" strokeDasharray="1 1.5" />
                    <path d="M40 34 C46 34 46 34 52 34" strokeDasharray="1 1.5" />
                    <path d="M40 44 C46 44 46 48 52 48" strokeDasharray="1 1.5" />
                </g>
                <g className="text-fg-muted" fill="currentColor" opacity={0.45}>
                    <rect x={12} y={18} width={24} height={14} rx={1} />
                    <rect x={52} y={16} width={26} height={8} rx={1.5} />
                    <rect x={52} y={30} width={26} height={8} rx={1.5} />
                    <rect x={52} y={44} width={26} height={8} rx={1.5} />
                </g>
                <g className="text-primary" stroke="currentColor" fill="none" strokeWidth={1}>
                    <path d="M78 20 C84 20 84 21 90 21" />
                    <path d="M78 34 C84 34 84 47 90 47" />
                    <path d="M78 48 C84 48 84 47 90 47" />
                </g>
            </svg>
        </div>
    );
}
