import React from "react";
import { Sparkles, FolderOpen, Book, Settings } from "lucide-react";

interface WelcomeEditorProps {
    tabId: string;
}

/**
 * Welcome editor component
 * Displays a welcome screen with quick actions and getting started guide
 */
export function WelcomeEditor({ tabId }: WelcomeEditorProps) {
    return (
        <div className="h-full overflow-auto bg-[#0f1115]">
            <div className="max-w-4xl mx-auto py-12 px-6">
                {/* Header */}
                <div className="text-center mb-12">
                    <div className="flex items-center justify-center gap-3 mb-4">
                        <Sparkles className="w-12 h-12 text-blue-400" />
                        <h1 className="text-4xl font-bold text-white">NarraLeaf Studio</h1>
                    </div>
                    <p className="text-lg text-gray-400">
                        All-in-one IDE for NarraLeaf Projects.
                    </p>
                </div>

                {/* Getting Started */}
                <div className="bg-[#0b0d12] rounded-lg p-6 border border-white/10">
                    <h2 className="text-xl font-semibold text-white mb-4">Getting Started</h2>
                    <div className="space-y-4">
                        <GettingStartedStep
                            number={1}
                            title="Explore the Workspace"
                            description="The left sidebar contains the asset manager and other panels. The right side can add property inspectors and other tools."
                        />
                        <GettingStartedStep
                            number={2}
                            title="Manage Assets"
                            description="Import images, audio, video, etc. into the Assets panel."
                        />
                        <GettingStartedStep
                            number={3}
                            title="Create Story"
                            description="Create game scenes and dialogs using the story editor. Supports node-based editing and preview."
                        />
                        <GettingStartedStep
                            number={4}
                            title="Test Run"
                            description="Click the run button to preview the game effect, and debug and modify as needed."
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

interface GettingStartedStepProps {
    number: number;
    title: string;
    description: string;
}

function GettingStartedStep({ number, title, description }: GettingStartedStepProps) {
    return (
        <div className="flex gap-4">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-semibold text-sm">
                {number}
            </div>
            <div>
                <h3 className="text-base font-medium text-white mb-1">{title}</h3>
                <p className="text-sm text-gray-400">{description}</p>
            </div>
        </div>
    );
}
