import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/lib/components/elements";
import { Button } from "@/lib/components/elements";
import { Input, InputGroup } from "@/lib/components/elements";
import { Select } from "@/lib/components/elements";

const languageOptions = [
    { value: "en", label: "English" },
    { value: "zh", label: "中文" },
    { value: "ja", label: "日本語" },
];

const themeOptions = [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
    { value: "system", label: "System" },
];

/**
 * General settings tab with application preferences
 */
export function SettingsGeneralTab() {
    return (
        <div className="p-6 space-y-6">
            <div className="space-y-2">
                <h1 className="text-xl font-semibold text-gray-200">General Settings</h1>
                <p className="text-sm text-gray-400">
                    Configure general application preferences and behavior.
                </p>
            </div>

            <div className="grid gap-6">
                {/* Application Settings */}
                <Card>
                    <CardHeader>
                        <CardTitle>Application</CardTitle>
                        <CardDescription>
                            Basic application settings and preferences.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <InputGroup label="Application Name">
                            <Input defaultValue="NarraLeaf Studio" disabled />
                        </InputGroup>

                        <InputGroup label="Version">
                            <Input defaultValue="0.0.1" disabled />
                        </InputGroup>

                        <InputGroup label="Language" helper="Select your preferred language">
                            <Select
                                options={languageOptions}
                                value="en"
                                placeholder="Select language..."
                            />
                        </InputGroup>

                        <InputGroup label="Theme" helper="Choose your preferred theme">
                            <Select
                                options={themeOptions}
                                value="dark"
                                placeholder="Select theme..."
                            />
                        </InputGroup>
                    </CardContent>
                </Card>

                {/* Startup Settings */}
                <Card>
                    <CardHeader>
                        <CardTitle>Startup</CardTitle>
                        <CardDescription>
                            Configure how the application starts and behaves on launch.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Start with system
                                </label>
                                <p className="text-xs text-gray-400">
                                    Launch application when your computer starts
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
                                    Show welcome screen
                                </label>
                                <p className="text-xs text-gray-400">
                                    Display welcome screen on first launch
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
                                    Check for updates automatically
                                </label>
                                <p className="text-xs text-gray-400">
                                    Automatically check for application updates
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

                {/* Reset Settings */}
                <Card>
                    <CardHeader>
                        <CardTitle>Reset</CardTitle>
                        <CardDescription>
                            Reset application settings to default values.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <label className="text-sm font-medium text-gray-200">
                                    Reset all settings
                                </label>
                                <p className="text-xs text-gray-400">
                                    This will restore all settings to their default values
                                </p>
                            </div>
                            <Button variant="danger" size="sm">
                                Reset
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
