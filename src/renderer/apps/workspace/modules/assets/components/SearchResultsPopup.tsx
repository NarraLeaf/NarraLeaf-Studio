import React, { useMemo, useLayoutEffect, useState } from "react";
import ReactDOM from "react-dom";
import { useTranslation } from "@/lib/i18n";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import {
    Image, Music, Video, FileJson, Workflow, Type, File,
    Folder
} from "lucide-react";

interface SearchResult {
    id: string;
    name: string;
    type: AssetType;
    isGroup: boolean;
    groupPath?: string[]; // Path to parent groups
    matchReason: 'name' | 'tag' | 'description';
    matchText: string;
}

interface SearchResultsPopupProps {
    results: SearchResult[];
    visible: boolean;
    onResultClick: (result: SearchResult) => void;
    onClose: () => void;
    searchQuery: string;
    anchorRef?: React.RefObject<HTMLElement | null>;
    className?: string;
}

// Asset type icons mapping
const ASSET_TYPE_ICONS = {
    [AssetType.Image]: Image,
    [AssetType.Audio]: Music,
    [AssetType.Video]: Video,
    [AssetType.JSON]: FileJson,
    [AssetType.Blueprint]: Workflow,
    [AssetType.Font]: Type,
    [AssetType.Other]: File,
};

/**
 * Search results popup component
 */
export function SearchResultsPopup({
    results,
    visible,
    onResultClick,
    onClose,
    searchQuery,
    anchorRef,
    className = ""
}: SearchResultsPopupProps) {
    const { t, tn } = useTranslation();
    const handleResultClick = (result: SearchResult) => {
        onResultClick(result);
        onClose();
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    if (!visible) {
        return null;
    }

    // Calculate anchor position
    const [anchorStyle, setAnchorStyle] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

    useLayoutEffect(() => {
        if (anchorRef?.current) {
            const rect = anchorRef.current.getBoundingClientRect();
            setAnchorStyle({
                top: rect.bottom + 4,
                left: rect.left,
                width: rect.width,
            });
        }
    }, [anchorRef, visible, searchQuery]);

    const popup = (
        <div
            className={`
                fixed z-50 bg-surface-overlay border border-edge-strong rounded-md shadow-xl
                max-w-sm w-full max-h-80 overflow-y-auto
                ${className}
            `}
            style={{
                top: anchorStyle.top,
                left: anchorStyle.left,
                width: anchorStyle.width,
            }}
        >
                {/* Header */}
                <div className="px-3 py-2 border-b border-edge">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-fg-muted">
                            {tn("assets.search.resultCount", results.length)}
                        </span>
                        <button
                            onClick={onClose}
                            className="text-fg-muted hover:text-fg-muted transition-colors text-sm"
                        >
                            ✕
                        </button>
                    </div>
                    <div className="text-xs text-fg-subtle mt-0.5">
                        "{searchQuery}"
                    </div>
                </div>

                {/* Results */}
                <div className="py-1">
                    {results.length > 0 ? (
                        results.map((result, index) => (
                            <SearchResultItem
                                key={`${result.type}-${result.id}`}
                                result={result}
                                onClick={() => handleResultClick(result)}
                            />
                        ))
                    ) : (
                        <div className="px-3 py-4 text-center text-fg-subtle text-sm">
                            {t("assets.search.noResults")}
                        </div>
                    )}
                </div>
            </div>
    );

    // Render popup to body to avoid overflow/ clipping issues
    return ReactDOM.createPortal(popup, document.body);
}

interface SearchResultItemProps {
    result: SearchResult;
    onClick: () => void;
}

function SearchResultItem({ result, onClick }: SearchResultItemProps) {
    const { t } = useTranslation();
    const Icon = result.isGroup ? Folder : ASSET_TYPE_ICONS[result.type];

    return (
        <button
            onClick={onClick}
            className="w-full px-4 py-2 hover:bg-fill-subtle transition-colors text-left"
        >
            <div className="flex items-center gap-3">
                <Icon className="w-4 h-4 text-fg-muted flex-shrink-0" />
                <div className="flex-1 min-w-0">
                    <div className="text-sm text-fg-muted truncate">
                        {result.name}
                    </div>
                    {result.groupPath && result.groupPath.length > 0 && (
                        <div className="text-xs text-fg-subtle truncate">
                            {result.groupPath.join(" / ")}
                        </div>
                    )}
                    <div className="text-xs text-fg-subtle">
                        {result.matchReason === 'name' && t("common.name")}
                        {result.matchReason === 'tag' && t("assets.search.matchTag", { tag: result.matchText })}
                        {result.matchReason === 'description' && t("common.description")}
                    </div>
                </div>
            </div>
        </button>
    );
}
