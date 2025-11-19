import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/lib/components/elements";
import { Button } from "@/lib/components/elements";
import { Select } from "@/lib/components/elements";
import { Input, InputGroup } from "@/lib/components/elements";

const tabSizeOptions = [
    { value: "2", label: "2 spaces" },
    { value: "4", label: "4 spaces" },
    { value: "8", label: "8 spaces" },
    { value: "tab", label: "Tab" },
];

const lineEndingOptions = [
    { value: "lf", label: "LF (Unix)" },
    { value: "crlf", label: "CRLF (Windows)" },
    { value: "cr", label: "CR (Mac)" },
];

const encodingOptions = [
    { value: "utf8", label: "UTF-8" },
    { value: "utf16le", label: "UTF-16 LE" },
    { value: "utf16be", label: "UTF-16 BE" },
    { value: "ascii", label: "ASCII" },
];

/**
 * Editor settings tab with code editing preferences
 */
export function SettingsEditorTab() {
    return (
        <div className="p-6 space-y-6">
            <div className="space-y-2">
                <h1 className="text-xl font-semibold text-gray-200">Editor Settings</h1>
                <p className="text-sm text-gray-400">
                    Configure code editor behavior, formatting, and features.
                </p>
            </div>

            <div className="grid gap-6">
                {/* General Editor Settings */}
                <Card>
                    <CardHeader>
                        <CardTitle>General</CardTitle>
                        <CardDescription>
                            Basic editor configuration and behavior.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <InputGroup label="Tab Size">
                                <Select
                                    options={tabSizeOptions}
                                    value="4"
                                    placeholder="Select tab size..."
                                />
                            </InputGroup>
                            <InputGroup label="Line Ending">
                                <Select
                                    options={lineEndingOptions}
                                    value="lf"
                                    placeholder="Select line ending..."
                                />
                            </InputGroup>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <InputGroup label="Default Encoding">
                                <Select
                                    options={encodingOptions}
                                    value="utf8"
                                    placeholder="Select encoding..."
                                />
                            </InputGroup>
                            <InputGroup label="Word Wrap">
                                <Select
                                    options={[
                                        { value: "off", label: "Off" },
                                        { value: "on", label: "On" },
                                        { value: "wordWrapColumn", label: "Word Wrap Column" },
                                        { value: "bounded", label: "Bounded" },
                                    ]}
                                    value="on"
                                    placeholder="Select word wrap..."
                                />
                            </InputGroup>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Auto save
                                </label>
                                <p className="text-xs text-gray-400">
                                    Automatically save files as you type
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-white/20 bg-white/5"
                                defaultChecked
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Format on save
                                </label>
                                <p className="text-xs text-gray-400">
                                    Automatically format files when saved
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-white/20 bg-white/5"
                                defaultChecked
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Appearance */}
                <Card>
                    <CardHeader>
                        <CardTitle>Appearance</CardTitle>
                        <CardDescription>
                            Configure editor visual appearance.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <InputGroup label="Font Size">
                                <Input
                                    type="number"
                                    defaultValue="14"
                                    min="8"
                                    max="24"
                                />
                            </InputGroup>
                            <InputGroup label="Line Height">
                                <Input
                                    type="number"
                                    defaultValue="1.5"
                                    min="1"
                                    max="3"
                                    step="0.1"
                                />
                            </InputGroup>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Show line numbers
                                </label>
                                <p className="text-xs text-gray-400">
                                    Display line numbers in the editor
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-white/20 bg-white/5"
                                defaultChecked
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Show minimap
                                </label>
                                <p className="text-xs text-gray-400">
                                    Display code minimap on the side
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-white/20 bg-white/5"
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Highlight current line
                                </label>
                                <p className="text-xs text-gray-400">
                                    Highlight the line where the cursor is
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-white/20 bg-white/5"
                                defaultChecked
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Render whitespace
                                </label>
                                <p className="text-xs text-gray-400">
                                    Show spaces, tabs, and line endings
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-white/20 bg-white/5"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Behavior */}
                <Card>
                    <CardHeader>
                        <CardTitle>Behavior</CardTitle>
                        <CardDescription>
                            Configure editor behavior and interactions.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Multi-cursor modifier
                                </label>
                                <p className="text-xs text-gray-400">
                                    Key to hold for multiple cursors
                                </p>
                            </div>
                            <Select
                                options={[
                                    { value: "ctrlCmd", label: "Ctrl/Cmd" },
                                    { value: "alt", label: "Alt" },
                                ]}
                                value="alt"
                                className="w-32"
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Cursor blinking
                                </label>
                                <p className="text-xs text-gray-400">
                                    Cursor blinking animation style
                                </p>
                            </div>
                            <Select
                                options={[
                                    { value: "blink", label: "Blink" },
                                    { value: "smooth", label: "Smooth" },
                                    { value: "phase", label: "Phase" },
                                    { value: "expand", label: "Expand" },
                                    { value: "solid", label: "Solid" },
                                ]}
                                value="blink"
                                className="w-32"
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Smooth scrolling
                                </label>
                                <p className="text-xs text-gray-400">
                                    Enable smooth scrolling in editor
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-white/20 bg-white/5"
                                defaultChecked
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Mouse wheel zoom
                                </label>
                                <p className="text-xs text-gray-400">
                                    Zoom with mouse wheel when holding Ctrl
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-white/20 bg-white/5"
                                defaultChecked
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Drag and drop
                                </label>
                                <p className="text-xs text-gray-400">
                                    Enable drag and drop in editor
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-white/20 bg-white/5"
                                defaultChecked
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Accessibility */}
                <Card>
                    <CardHeader>
                        <CardTitle>Accessibility</CardTitle>
                        <CardDescription>
                            Configure accessibility features.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Screen reader support
                                </label>
                                <p className="text-xs text-gray-400">
                                    Optimize for screen readers
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-white/20 bg-white/5"
                                defaultChecked
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    High contrast
                                </label>
                                <p className="text-xs text-gray-400">
                                    Increase contrast for better visibility
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-white/20 bg-white/5"
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Large cursor
                                </label>
                                <p className="text-xs text-gray-400">
                                    Use a larger cursor for better visibility
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-white/20 bg-white/5"
                            />
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
