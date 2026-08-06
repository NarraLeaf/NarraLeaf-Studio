import React, { useState } from "react";
import { Filter, ChevronDown, X, Tag, FileImage, Shapes, Link2, Scale } from "lucide-react";
import { ASSET_CATEGORY_ORDER, AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import { useTranslation } from "@/lib/i18n";
import type { Translator } from "@shared/i18n";

/** The one thing this factory needs from `useTranslation`: a key in, a string out. */
export type FilterTranslator = Translator["t"];

export interface FilterConfig {
    id: string;
    label: string;
    icon: React.ReactNode;
    options: FilterOption[];
    multiSelect?: boolean;
}

export interface FilterOption {
    id: string;
    label: string;
    value: any;
}

export interface ActiveFilter {
    filterId: string;
    optionId: string;
}

export interface FilterSystemProps {
    filters: FilterConfig[];
    activeFilters: ActiveFilter[];
    onFiltersChange: (filters: ActiveFilter[]) => void;
    onFilterOpen?: () => void;
    className?: string;
}

/**
 * Extensible filter system component
 */
export function FilterSystem({ filters, activeFilters, onFiltersChange, onFilterOpen, className = "" }: FilterSystemProps) {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(false);

    const hasActiveFilters = activeFilters.length > 0;

    const handleFilterToggle = (filterId: string, optionId: string) => {
        const existingFilter = activeFilters.find(f => f.filterId === filterId && f.optionId === optionId);

        if (existingFilter) {
            // Remove filter
            onFiltersChange(activeFilters.filter(f => !(f.filterId === filterId && f.optionId === optionId)));
        } else {
            // Add filter
            const filterConfig = filters.find(f => f.id === filterId);
            if (filterConfig?.multiSelect) {
                // Multi-select: add to existing filters
                onFiltersChange([...activeFilters, { filterId, optionId }]);
            } else {
                // Single-select: replace existing filters for this filter type
                const newFilters = activeFilters.filter(f => f.filterId !== filterId);
                newFilters.push({ filterId, optionId });
                onFiltersChange(newFilters);
            }
        }
    };

    const handleClearAllFilters = () => {
        onFiltersChange([]);
    };

    const getActiveFilterLabels = () => {
        return activeFilters.map(activeFilter => {
            const filter = filters.find(f => f.id === activeFilter.filterId);
            const option = filter?.options.find(o => o.id === activeFilter.optionId);
            return option?.label || activeFilter.optionId;
        });
    };

    return (
        <div className={`relative ${className}`}>
            {/* Filter Toggle Button */}
            <button
                onClick={() => {
                    const newExpanded = !isExpanded;
                    setIsExpanded(newExpanded);
                    if (newExpanded && onFilterOpen) {
                        onFilterOpen();
                    }
                }}
                className={`
                    flex min-h-9 cursor-default items-center gap-2 px-3 py-1 rounded-md border transition-colors
                    ${hasActiveFilters
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-edge-strong bg-fill-subtle hover:bg-fill'
                    }
                `}
            >
                <Filter className="w-4 h-4" />
                <span className="text-sm">
                    {t("assets.filter.label")} {hasActiveFilters && `(${activeFilters.length})`}
                </span>
                <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>

            {/* Active Filters Summary */}
            {hasActiveFilters && (
                <div className="flex flex-wrap gap-1 mt-2">
                    {getActiveFilterLabels().map((label, index) => (
                        <span
                            key={index}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-primary/20 text-primary rounded-md"
                        >
                            {label}
                        </span>
                    ))}
                    <button
                        onClick={handleClearAllFilters}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-danger/20 text-danger rounded-md hover:bg-danger/30 transition-colors"
                    >
                        <X className="w-3 h-3" />
                        {t("common.clear")}
                    </button>
                </div>
            )}

            {/* Filter Options Panel. `left-0 right-0` alone sizes it to the toggle button — about
                110px — which stacked every option on its own line and made five groups taller than
                the panel they filter. A floor width lets the chips sit side by side; a group with
                nothing to offer (no tags in this project) is not printed at all. */}
            {isExpanded && (
                <div className="absolute top-full left-0 right-0 mt-2 min-w-64 bg-surface-overlay border border-edge-strong rounded-lg shadow-xl z-10">
                    <div className="p-3 space-y-3">
                        {filters.filter(filter => filter.options.length > 0).map(filter => (
                            <div key={filter.id} className="space-y-2">
                                <div className="flex items-center gap-2 text-sm text-fg-muted">
                                    {filter.icon}
                                    <span>{filter.label}</span>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {filter.options.map(option => {
                                        const isActive = activeFilters.some(f => f.filterId === filter.id && f.optionId === option.id);
                                        return (
                                            <button
                                                key={option.id}
                                                onClick={() => handleFilterToggle(filter.id, option.id)}
                                                className={`
                                                    px-2 py-1 text-xs rounded-md transition-colors
                                                    ${isActive
                                                        ? 'bg-primary text-on-primary'
                                                        : 'bg-fill text-fg-muted hover:bg-fill-strong'
                                                    }
                                                `}
                                            >
                                                {option.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

/** Byte thresholds behind the size bands. Labels are the numbers themselves — no sentence explains them. */
export const ASSET_SIZE_BANDS = [
    { id: 'lt1mb', label: '< 1 MB', max: 1024 * 1024 },
    { id: '1to10mb', label: '1 - 10 MB', min: 1024 * 1024, max: 10 * 1024 * 1024 },
    { id: 'gt10mb', label: '> 10 MB', min: 10 * 1024 * 1024 },
] as const satisfies readonly { id: string; label: string; min?: number; max?: number }[];

/**
 * Predefined filter configurations.
 *
 * Takes a translator rather than reading one itself: this is a plain factory the filter hook calls
 * inside a memo, and the group headings used to be hard-coded English in a fully localized panel.
 */
export const createDefaultFilters = (t: FilterTranslator): FilterConfig[] => [
    {
        id: 'type',
        label: t('assets.filter.category'),
        icon: <Shapes className="w-4 h-4" />,
        multiSelect: true,
        // The sections the sidebar actually draws. Listing types here would offer "Audio" and
        // "Videos" as separate narrowings of a library that has no such split any more.
        options: ASSET_CATEGORY_ORDER.map(category => ({
            id: category,
            label: t(`assets.categories.${category}` as `assets.categories.${AssetCategory}`),
            value: category,
        })),
    },
    {
        id: 'referenced',
        label: t('assets.filter.usage'),
        icon: <Link2 className="w-4 h-4" />,
        options: [
            { id: 'referenced', label: t('assets.overview.stat.referenced'), value: true },
            { id: 'unreferenced', label: t('assets.overview.stat.unreferenced'), value: false },
        ],
    },
    {
        id: 'size',
        label: t('assets.filter.size'),
        icon: <Scale className="w-4 h-4" />,
        options: ASSET_SIZE_BANDS.map(band => ({ id: band.id, label: band.label, value: band.id })),
    },
    {
        id: 'tags',
        label: t('assets.filter.tags'),
        icon: <Tag className="w-4 h-4" />,
        multiSelect: true,
        options: [], // Will be populated dynamically
    },
    {
        id: 'file-extensions',
        label: t('assets.filter.format'),
        icon: <FileImage className="w-4 h-4" />,
        multiSelect: true,
        options: [
            // Images
            { id: 'png', label: 'PNG', value: '.png' },
            { id: 'jpg', label: 'JPG', value: '.jpg' },
            { id: 'jpeg', label: 'JPEG', value: '.jpeg' },
            { id: 'gif', label: 'GIF', value: '.gif' },
            { id: 'webp', label: 'WebP', value: '.webp' },
            { id: 'svg', label: 'SVG', value: '.svg' },
            { id: 'bmp', label: 'BMP', value: '.bmp' },
            { id: 'tiff', label: 'TIFF', value: '.tiff' },
            { id: 'ico', label: 'ICO', value: '.ico' },
            // Audio
            { id: 'mp3', label: 'MP3', value: '.mp3' },
            { id: 'wav', label: 'WAV', value: '.wav' },
            { id: 'ogg', label: 'OGG', value: '.ogg' },
            { id: 'flac', label: 'FLAC', value: '.flac' },
            { id: 'aac', label: 'AAC', value: '.aac' },
            // Video
            { id: 'mp4', label: 'MP4', value: '.mp4' },
            { id: 'avi', label: 'AVI', value: '.avi' },
            { id: 'mov', label: 'MOV', value: '.mov' },
            { id: 'wmv', label: 'WMV', value: '.wmv' },
            { id: 'flv', label: 'FLV', value: '.flv' },
            { id: 'webm', label: 'WebM', value: '.webm' },
            // Documents/JSON
            { id: 'json', label: 'JSON', value: '.json' },
            { id: 'txt', label: 'TXT', value: '.txt' },
            { id: 'xml', label: 'XML', value: '.xml' },
            // Fonts
            { id: 'ttf', label: 'TTF', value: '.ttf' },
            { id: 'otf', label: 'OTF', value: '.otf' },
            { id: 'woff', label: 'WOFF', value: '.woff' },
            { id: 'woff2', label: 'WOFF2', value: '.woff2' },
            // Other common formats
            { id: 'zip', label: 'ZIP', value: '.zip' },
            { id: 'pdf', label: 'PDF', value: '.pdf' },
        ],
    },
];

/**
 * Utility function to get all unique tags from assets
 */
export const getUniqueTags = (assets: any[]): FilterOption[] => {
    const tagSet = new Set<string>();
    assets.forEach(asset => {
        asset.tags?.forEach((tag: string) => tagSet.add(tag));
    });
    return Array.from(tagSet).map(tag => ({
        id: tag,
        label: tag,
        value: tag,
    }));
};
