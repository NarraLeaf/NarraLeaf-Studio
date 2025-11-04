import React, { useEffect, useState } from "react";
import { File, Folder, RefreshCw, AlertCircle } from "lucide-react";
import { useWorkspace } from "../context";
import { Services } from "@/lib/workspace/services/services";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { FileStat } from "@shared/utils/fs";

/**
 * Assets panel component
 * Displays assets from the assets/ directory
 * Currently shows a flat list, but designed for future extensibility
 * to support hash-based asset management with metadata
 */
export function AssetsPanel() {
    const { context, isInitialized } = useWorkspace();
    const [assets, setAssets] = useState<FileStat[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

    const loadAssets = async () => {
        if (!context) return;

        setLoading(true);
        setError(null);

        try {
            const fs = context.services.get<FileSystemService>(Services.FileSystem);
            const assetsPath = context.project.resolve("assets");

            // Check if assets directory exists
            const existsResult = await fs.isDirExists(assetsPath);
            if (!existsResult.ok) {
                throw new Error(existsResult.error.message);
            }

            if (!existsResult.data) {
                // Create assets directory if it doesn't exist
                const createResult = await fs.createDir(assetsPath);
                if (!createResult.ok) {
                    throw new Error(createResult.error.message);
                }
                setAssets([]);
                return;
            }

            // List files in assets directory
            const listResult = await fs.list(assetsPath);
            if (!listResult.ok) {
                throw new Error(listResult.error.message);
            }

            setAssets(listResult.data);
        } catch (err) {
            console.error("Failed to load assets:", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isInitialized) {
            loadAssets();
        }
    }, [isInitialized]);

    const handleAssetClick = (asset: FileStat) => {
        setSelectedAsset(asset.name);
        // TODO: Open asset in appropriate editor or viewer
        console.log("Asset clicked:", asset);
    };

    const handleRefresh = () => {
        loadAssets();
    };

    // Loading state
    if (loading && assets.length === 0) {
        return (
            <div className="p-4">
                <div className="flex items-center gap-2 text-gray-400">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Loading assets...</span>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="p-4">
                <div className="flex items-start gap-2 text-red-400 bg-red-500/10 rounded-md p-3">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <p className="text-sm font-medium">Failed to load assets</p>
                        <p className="text-xs mt-1 text-red-300">{error}</p>
                        <button
                            onClick={handleRefresh}
                            className="mt-2 text-xs text-red-300 hover:text-red-200 underline cursor-default"
                        >
                            Try again
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Empty state
    if (assets.length === 0) {
        return (
            <div className="p-4">
                <div className="text-center text-gray-500 py-8">
                    <Folder className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">No assets found</p>
                    <p className="text-xs mt-1">Add files to the assets/ directory</p>
                    <button
                        onClick={handleRefresh}
                        className="mt-4 text-xs text-gray-400 hover:text-gray-300 underline cursor-default"
                    >
                        Refresh
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                <span className="text-xs text-gray-400">{assets.length} items</span>
                <button
                    onClick={handleRefresh}
                    disabled={loading}
                    className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-default disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Refresh"
                    aria-label="Refresh assets"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
            </div>

            {/* Asset List */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-2 space-y-1">
                    {assets.map((asset) => {
                        const isSelected = selectedAsset === asset.name;
                        const Icon = asset.isDirectory ? Folder : File;

                        return (
                            <div
                                key={asset.name}
                                onClick={() => handleAssetClick(asset)}
                                className={`
                                    flex items-center gap-2 px-2 py-1.5 rounded cursor-default transition-colors
                                    ${
                                        isSelected
                                            ? "bg-blue-500/20 text-white"
                                            : "text-gray-300 hover:bg-white/10 hover:text-white"
                                    }
                                `}
                            >
                                <Icon
                                    className={`w-4 h-4 flex-shrink-0 ${
                                        asset.isDirectory ? "text-blue-400" : "text-gray-400"
                                    }`}
                                />
                                <span className="text-sm truncate flex-1">{asset.name}</span>
                                {asset.size !== undefined && !asset.isDirectory && (
                                    <span className="text-xs text-gray-500 flex-shrink-0">
                                        {formatFileSize(asset.size)}
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

