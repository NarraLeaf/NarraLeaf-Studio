import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/lib/components/elements";
import { Button } from "@/lib/components/elements";
import { Select } from "@/lib/components/elements";
import { Input, InputGroup } from "@/lib/components/elements";

const fontSizeOptions = [
    { value: "xs", label: "Extra Small (10px)" },
    { value: "sm", label: "Small (12px)" },
    { value: "base", label: "Medium (14px)" },
    { value: "lg", label: "Large (16px)" },
    { value: "xl", label: "Extra Large (18px)" },
];

const fontFamilyOptions = [
    { value: "inter", label: "Inter" },
    { value: "system", label: "System Font" },
    { value: "monospace", label: "Monospace" },
    { value: "serif", label: "Serif" },
];

const accentColorOptions = [
    { value: "blue", label: "Blue" },
    { value: "green", label: "Green" },
    { value: "purple", label: "Purple" },
    { value: "red", label: "Red" },
    { value: "orange", label: "Orange" },
];

/**
 * Appearance settings tab with UI customization options
 */
export function SettingsAppearanceTab() {
    return (
        <div className="p-6 space-y-6">
            <div className="space-y-2">
                <h1 className="text-xl font-semibold text-gray-200">Appearance Settings</h1>
                <p className="text-sm text-gray-400">
                    Customize the look and feel of the application interface.
                </p>
            </div>

            <div className="grid gap-6">
                {/* Theme Settings */}
                <Card>
                    <CardHeader>
                        <CardTitle>Theme</CardTitle>
                        <CardDescription>
                            Configure the overall appearance theme.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-200">
                                    Base Theme
                                </label>
                                <Select
                                    options={[
                                        { value: "dark", label: "Dark" },
                                        { value: "light", label: "Light" },
                                        { value: "auto", label: "Auto (System)" },
                                    ]}
                                    value="dark"
                                    placeholder="Select theme..."
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-200">
                                    Accent Color
                                </label>
                                <Select
                                    options={accentColorOptions}
                                    value="blue"
                                    placeholder="Select accent color..."
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-2">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Compact mode
                                </label>
                                <p className="text-xs text-gray-400">
                                    Use smaller spacing and padding
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-white/20 bg-white/5"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Typography */}
                <Card>
                    <CardHeader>
                        <CardTitle>Typography</CardTitle>
                        <CardDescription>
                            Customize font settings and text appearance.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <InputGroup label="Font Family">
                                <Select
                                    options={fontFamilyOptions}
                                    value="inter"
                                    placeholder="Select font family..."
                                />
                            </InputGroup>
                            <InputGroup label="Font Size">
                                <Select
                                    options={fontSizeOptions}
                                    value="sm"
                                    placeholder="Select font size..."
                                />
                            </InputGroup>
                        </div>

                        <div className="space-y-3">
                            <label className="text-sm font-medium text-gray-200">
                                Font Weight
                            </label>
                            <div className="grid grid-cols-4 gap-2">
                                {[
                                    { value: "300", label: "Light" },
                                    { value: "400", label: "Normal" },
                                    { value: "500", label: "Medium" },
                                    { value: "600", label: "Bold" },
                                ].map((weight) => (
                                    <button
                                        key={weight.value}
                                        className={`
                                            px-3 py-2 text-sm rounded-md transition-colors cursor-default
                                            ${weight.value === "400"
                                                ? "bg-white/10 text-white"
                                                : "text-gray-300 hover:bg-white/10 hover:text-white"
                                            }
                                        `}
                                    >
                                        {weight.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Ligatures
                                </label>
                                <p className="text-xs text-gray-400">
                                    Enable font ligatures for better readability
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

                {/* Interface */}
                <Card>
                    <CardHeader>
                        <CardTitle>Interface</CardTitle>
                        <CardDescription>
                            Configure interface elements and animations.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Show animations
                                </label>
                                <p className="text-xs text-gray-400">
                                    Enable interface animations and transitions
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
                                    Show icons in menus
                                </label>
                                <p className="text-xs text-gray-400">
                                    Display icons alongside menu items
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
                                    Reduce motion
                                </label>
                                <p className="text-xs text-gray-400">
                                    Minimize animations for accessibility
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-white/20 bg-white/5"
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Preview */}
                <Card>
                    <CardHeader>
                        <CardTitle>Preview</CardTitle>
                        <CardDescription>
                            Preview how your settings will look.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            <div className="p-4 bg-white/5 rounded-md border border-white/10">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium">Sample Text</span>
                                        <Button size="sm" variant="ghost">Action</Button>
                                    </div>
                                    <p className="text-sm text-gray-400">
                                        This is how regular text will appear with your current settings.
                                    </p>
                                    <div className="flex gap-2">
                                        <Button size="sm">Primary</Button>
                                        <Button size="sm" variant="secondary">Secondary</Button>
                                    </div>
                                </div>
                            </div>

                            <div className="flex justify-end">
                                <Button>Apply Changes</Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
