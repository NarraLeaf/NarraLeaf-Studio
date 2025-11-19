import React, { useState, useMemo } from "react";
import { Filter, ChevronDown, X, Tag, FileImage } from "lucide-react";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";

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
                    flex items-center gap-2 px-3 py-2 rounded-md border transition-colors
                    ${hasActiveFilters
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-white/20 bg-white/5 hover:bg-white/10'
                    }
                `}
            >
                <Filter className="w-4 h-4" />
                <span className="text-sm">
                    Filters {hasActiveFilters && `(${activeFilters.length})`}
                </span>
                <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>

            {/* Active Filters Summary */}
            {hasActiveFilters && (
                <div className="flex flex-wrap gap-1 mt-2">
                    {getActiveFilterLabels().map((label, index) => (
                        <span
                            key={index}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-primary/20 text-primary rounded"
                        >
                            {label}
                        </span>
                    ))}
                    <button
                        onClick={handleClearAllFilters}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
                    >
                        <X className="w-3 h-3" />
                        Clear
                    </button>
                </div>
            )}

            {/* Filter Options Panel */}
            {isExpanded && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-[#0b0d12] border border-white/20 rounded-lg shadow-xl z-10">
                    <div className="p-3 space-y-3">
                        {filters.map(filter => (
                            <div key={filter.id} className="space-y-2">
                                <div className="flex items-center gap-2 text-sm text-gray-300">
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
                                                    px-2 py-1 text-xs rounded transition-colors
                                                    ${isActive
                                                        ? 'bg-primary text-white'
                                                        : 'bg-white/10 text-gray-300 hover:bg-white/20'
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

/**
 * Predefined filter configurations
 */
export const createDefaultFilters = (): FilterConfig[] => [
    {
        id: 'tags',
        label: 'Tags',
        icon: <Tag className="w-4 h-4" />,
        multiSelect: true,
        options: [], // Will be populated dynamically
    },
    {
        id: 'file-extensions',
        label: 'File Extensions',
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
