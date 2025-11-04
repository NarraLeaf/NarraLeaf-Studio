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
                        <h1 className="text-4xl font-bold text-white">欢迎使用 NarraLeaf Studio</h1>
                    </div>
                    <p className="text-lg text-gray-400">
                        一体化的视觉小说游戏制作 IDE
                    </p>
                </div>

                {/* Quick Actions */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
                    <QuickActionCard
                        icon={<FolderOpen className="w-6 h-6" />}
                        title="打开资源"
                        description="从资源面板浏览和管理项目文件"
                        color="blue"
                    />
                    <QuickActionCard
                        icon={<Book className="w-6 h-6" />}
                        title="编辑剧情"
                        description="使用节点化编辑器创建游戏剧情"
                        color="purple"
                    />
                    <QuickActionCard
                        icon={<Settings className="w-6 h-6" />}
                        title="项目设置"
                        description="配置项目元数据和构建选项"
                        color="green"
                    />
                </div>

                {/* Getting Started */}
                <div className="bg-[#0b0d12] rounded-lg p-6 border border-white/10">
                    <h2 className="text-xl font-semibold text-white mb-4">快速开始</h2>
                    <div className="space-y-4">
                        <GettingStartedStep
                            number={1}
                            title="探索工作区"
                            description="左侧边栏包含资源管理器和其他面板。右侧可以添加属性检查器等工具。"
                        />
                        <GettingStartedStep
                            number={2}
                            title="管理资源"
                            description="在 Assets 面板中导入图片、音频、视频等游戏资源。"
                        />
                        <GettingStartedStep
                            number={3}
                            title="创建剧情"
                            description="使用剧情编辑器创建游戏场景和对话。支持节点化编辑和预览。"
                        />
                        <GettingStartedStep
                            number={4}
                            title="测试运行"
                            description="点击运行按钮预览游戏效果，随时调试和修改。"
                        />
                    </div>
                </div>

                {/* Features */}
                <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FeatureCard
                        title="模块化架构"
                        description="完全解耦的组件设计，支持插件扩展和自定义面板。"
                    />
                    <FeatureCard
                        title="灵活布局"
                        description="自由调整边栏和编辑区布局，支持分屏和多标签页。"
                    />
                    <FeatureCard
                        title="资源管理"
                        description="基于 GUID 的资源系统，支持元数据管理和版本控制。"
                    />
                    <FeatureCard
                        title="实时预览"
                        description="边写边看，实时预览游戏效果，快速迭代开发。"
                    />
                </div>
            </div>
        </div>
    );
}

interface QuickActionCardProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    color: "blue" | "purple" | "green";
}

function QuickActionCard({ icon, title, description, color }: QuickActionCardProps) {
    const colorClasses = {
        blue: "text-blue-400 border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10",
        purple: "text-purple-400 border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10",
        green: "text-green-400 border-green-500/30 bg-green-500/5 hover:bg-green-500/10",
    };

    return (
        <div
            className={`
                p-6 rounded-lg border transition-colors cursor-default
                ${colorClasses[color]}
            `}
        >
            <div className="mb-3">{icon}</div>
            <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
            <p className="text-sm text-gray-400">{description}</p>
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

interface FeatureCardProps {
    title: string;
    description: string;
}

function FeatureCard({ title, description }: FeatureCardProps) {
    return (
        <div className="p-4 rounded-lg bg-[#0b0d12] border border-white/10">
            <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
            <p className="text-sm text-gray-400">{description}</p>
        </div>
    );
}

