import { useState, useEffect, useMemo } from 'react';
import { X, Wand2, AlertCircle, Check } from 'lucide-react';
import { MagicTagTemplate, MagicTagPreview } from '@/lib/workspace/services/core/MagicTagManager';
import { Asset } from '@/lib/workspace/services/assets/types';

export interface MagicTagDialogProps {
    visible: boolean;
    assets: Asset[];
    template: MagicTagTemplate | null;
    onClose: () => void;
    onApply: (categoryMapping: Record<number, string>) => Promise<void>;
}

export function MagicTagDialog({ visible, assets, template, onClose, onApply }: MagicTagDialogProps) {
    const [categoryMapping, setCategoryMapping] = useState<Record<number, string>>({});
    const [selectedDelimiters, setSelectedDelimiters] = useState<string[]>([]);
    const [preview, setPreview] = useState<MagicTagPreview[]>([]);
    const [applying, setApplying] = useState(false);

    // Initialize selected delimiters when template changes
    useEffect(() => {
        if (template?.mode === 'auto' && template.delimiters && template.delimiters.length > 0) {
            // Auto-select the most frequent delimiter
            setSelectedDelimiters([template.delimiters[0].char]);
        }
    }, [template]);

    // Update preview when category mapping changes
    useEffect(() => {
        if (!template) return;
        
        // For regex mode, use template as-is
        // For auto mode, we need to regenerate segments with selected delimiters
        // But for now, we'll use the template's existing segments
        setPreview(generatePreview(template, categoryMapping));
    }, [template, categoryMapping]);

    const generatePreview = (tmpl: MagicTagTemplate, mapping: Record<number, string>): MagicTagPreview[] => {
        const previews: MagicTagPreview[] = [];

        for (let i = 0; i < tmpl.filenames.length; i++) {
            const filename = tmpl.filenames[i];
            const segments = tmpl.fileSegments[i];
            const tags: string[] = [];

            // Generate tags based on category mapping
            for (const [indexStr, category] of Object.entries(mapping)) {
                const index = parseInt(indexStr, 10);
                if (index >= 0 && index < segments.length) {
                    const value = segments[index].trim();
                    if (value && category.trim()) {
                        tags.push(`${category.trim()}:${value}`);
                    }
                }
            }

            previews.push({ filename, tags });
        }

        return previews;
    };

    const handleCategoryChange = (index: number, value: string) => {
        setCategoryMapping(prev => {
            const newMapping = { ...prev };
            if (value.trim()) {
                newMapping[index] = value;
            } else {
                delete newMapping[index];
            }
            return newMapping;
        });
    };

    const handleApply = async () => {
        setApplying(true);
        try {
            await onApply(categoryMapping);
            onClose();
        } finally {
            setApplying(false);
        }
    };

    const totalTagsToAdd = useMemo(() => {
        return preview.reduce((sum, p) => sum + p.tags.length, 0);
    }, [preview]);

    if (!visible || !template) return null;

    return (
        <div className="nl-window-content-layer z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Dialog */}
            <div
                className="relative bg-[#1e1e1e] border border-white/10 rounded-lg shadow-2xl w-[90vw] max-w-4xl max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                    <div className="flex items-center gap-2">
                        <Wand2 className="w-5 h-5 text-primary" />
                        <h2 className="text-lg font-semibold">Create Tags</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 rounded hover:bg-white/10 transition-colors"
                        aria-label="Close"
                    >
                        <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="px-6 py-6 overflow-y-auto space-y-6" style={{ maxHeight: 'calc(90vh - 140px)' }}>
                    {/* Delimiter Selection (Auto mode only) */}
                    {template.mode === 'auto' && template.delimiters && template.delimiters.length > 0 && (
                        <div className="space-y-3">
                            <label className="text-sm font-medium text-gray-300">Detected Delimiters</label>
                            <div className="flex flex-wrap gap-2">
                                {template.delimiters.map((delim) => (
                                    <button
                                        key={delim.char}
                                        onClick={() => {
                                            setSelectedDelimiters(prev =>
                                                prev.includes(delim.char)
                                                    ? prev.filter(d => d !== delim.char)
                                                    : [...prev, delim.char]
                                            );
                                        }}
                                        className={`px-3 py-1.5 rounded text-sm transition-colors ${
                                            selectedDelimiters.includes(delim.char)
                                                ? 'bg-primary text-white'
                                                : 'bg-white/10 text-gray-300 hover:bg-white/20'
                                        }`}
                                    >
                                        <span className="font-mono">{delim.char === ' ' ? '␣' : delim.char}</span>
                                        <span className="ml-2 text-xs opacity-70">
                                            {Math.round(delim.frequency * 100)}%
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Pattern Description */}
                    {template.mode === 'regex' && template.regex && (
                        <div className="space-y-3">
                            <label className="text-sm font-medium text-gray-300">Regular Expression Pattern</label>
                            <div className="bg-white/10 rounded p-3 font-mono text-sm text-gray-300">
                                {template.regex.pattern}
                            </div>
                            <p className="text-xs text-gray-400">
                                Capture Groups: {template.regex.captureGroups.join(', ')}
                            </p>
                        </div>
                    )}

                    {/* Segment Input Bubbles */}
                    <div className="space-y-4">
                        <label className="text-sm font-medium text-gray-300">Tag Category Mapping</label>
                        <div className="bg-white/10 rounded-lg p-4 space-y-4">
                            {/* Example display */}
                            <div className="pb-4 border-b border-white/10">
                                <div className="text-xs text-gray-400 mb-3">Example Filename: {template.example}</div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {template.exampleSegments.map((segment, index) => (
                                        <div key={index} className="flex items-center gap-1">
                                            {index > 0 && (
                                                <span className="text-gray-500 text-sm">
                                                    {template.mode === 'auto' && selectedDelimiters.length > 0
                                                        ? selectedDelimiters[0]
                                                        : '_'}
                                                </span>
                                            )}
                                            <div className="bg-white/15 rounded-full px-3 py-1.5 text-sm border border-white/20">
                                                {segment}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Category input fields */}
                            <div className="space-y-4">
                                {template.exampleSegments.map((segment, index) => (
                                    <div key={index} className="flex items-center gap-4">
                                        <div className="flex items-center gap-3 flex-1">
                                            <span className="text-sm text-gray-400 w-12 text-center font-mono">{index}</span>
                                            <div className="bg-white/15 rounded px-3 py-1.5 text-sm min-w-[100px] text-center border border-white/20">
                                                {segment}
                                            </div>
                                            <span className="text-gray-400 text-lg">→</span>
                                            <input
                                                type="text"
                                                placeholder="Tag Category (e.g.: char, emo)"
                                                value={categoryMapping[index] || ''}
                                                onChange={(e) => handleCategoryChange(index, e.target.value)}
                                                className="flex-1 bg-white/10 border border-white/20 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-primary transition-colors"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Preview Section */}
                    {Object.keys(categoryMapping).length > 0 && (
                        <div className="space-y-3">
                            <label className="text-sm font-medium text-gray-300">Preview</label>
                            <div className="bg-white/10 rounded-lg p-4 max-h-64 overflow-y-auto space-y-3">
                                {preview.slice(0, 10).map((item, idx) => (
                                    <div key={idx} className="text-sm">
                                        <div className="text-gray-400 mb-2 font-mono text-xs">{item.filename}</div>
                                        <div className="flex flex-wrap gap-2 ml-2">
                                            {item.tags.length > 0 ? (
                                                item.tags.map((tag, tagIdx) => (
                                                    <span
                                                        key={tagIdx}
                                                        className="bg-primary/20 text-primary px-2 py-0.5 rounded text-xs border border-primary/30"
                                                    >
                                                        {tag}
                                                    </span>
                                                ))
                                            ) : (
                                                <span className="text-gray-500 text-xs italic">No tags</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {preview.length > 10 && (
                                    <div className="text-xs text-gray-500 italic pt-2 border-t border-white/10">
                                        ... and {preview.length - 10} more files
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-400">
                                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                <span>Will add a total of {totalTagsToAdd} tags to {preview.length} files</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/10 bg-[#252525]">
                    <button
                        onClick={onClose}
                        disabled={applying}
                        className={`
                            px-4 py-2 text-sm rounded transition-colors
                            ${applying
                                ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                                : "bg-white/5 hover:bg-white/10 text-gray-300"
                            }
                        `}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleApply}
                        disabled={applying || Object.keys(categoryMapping).length === 0}
                        className={`
                            px-4 py-2 text-sm rounded transition-colors
                            ${applying || Object.keys(categoryMapping).length === 0
                                ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                                : "bg-primary hover:bg-primary/80 text-white font-medium"
                            }
                        `}
                    >
                        {applying ? (
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                <span>Applying...</span>
                            </div>
                        ) : (
                            <div className="flex items-center gap-2">
                                <Check className="w-4 h-4" />
                                <span>Apply Tags</span>
                            </div>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
