# Workspace Window

可扩展的、模块化的工作区窗口，提供类似 VSCode/IDEA 的编辑体验。

## 架构概览

### 核心系统

1. **Context System** (`context/`)
   - `WorkspaceProvider`: 提供 workspace 上下文和服务
   - `useWorkspace`: 访问 workspace 的 hook

2. **Registry System** (`registry/`)
   - `RegistryProvider`: 管理面板、操作和编辑器的注册
   - `useRegistry`: 访问注册表的 hook
   - 支持动态注册/注销扩展

3. **Layout System** (`components/layout/`)
   - `WorkspaceLayout`: 主布局容器
   - 边栏组件: `LeftSidebar`, `RightSidebar`, `BottomPanel`
   - 选择器组件: `LeftSidebarSelector`, `RightSidebarSelector`, `BottomPanelSelector`
   - 编辑区: `MainEditorArea`, `EditorGroup`
   - 控制栏: `ActionBar`, `ControlBar`

## 扩展指南

### 注册新面板

面板可以放置在左边栏、右边栏或底栏。

```tsx
import { useEffect } from "react";
import { useRegistry, PanelPosition } from "@/apps/workspace/registry";
import { MyPanelIcon } from "lucide-react";

function MyPanel() {
    return <div>My Panel Content</div>;
}

export function useMyPanel() {
    const { registerPanel, unregisterPanel } = useRegistry();

    useEffect(() => {
        registerPanel({
            id: "my-panel",
            title: "My Panel",
            icon: <MyPanelIcon className="w-4 h-4" />,
            position: PanelPosition.Left, // or Right, Bottom
            component: MyPanel,
            defaultVisible: false,
            order: 10,
        });

        return () => unregisterPanel("my-panel");
    }, [registerPanel, unregisterPanel]);
}
```

### 注册新操作

操作显示在顶部左侧的操作栏中。

```tsx
import { useEffect } from "react";
import { useRegistry } from "@/apps/workspace/registry";
import { Play } from "lucide-react";

export function useRunAction() {
    const { registerAction, unregisterAction } = useRegistry();

    useEffect(() => {
        registerAction({
            id: "run",
            label: "Run",
            icon: <Play className="w-4 h-4" />,
            tooltip: "Run the game",
            onClick: () => {
                console.log("Running...");
            },
            order: 0,
        });

        return () => unregisterAction("run");
    }, [registerAction, unregisterAction]);
}
```

### 打开编辑器标签页

编辑器在主编辑区的标签页中显示。

```tsx
import { useRegistry } from "@/apps/workspace/registry";
import { FileCode } from "lucide-react";

function MyEditor({ tabId }: { tabId: string }) {
    return <div>Editor for {tabId}</div>;
}

// In your component:
function MyComponent() {
    const { openEditorTab } = useRegistry();

    const handleOpenFile = (fileId: string) => {
        openEditorTab({
            id: fileId,
            title: "My File",
            icon: <FileCode className="w-4 h-4" />,
            component: MyEditor,
            closable: true,
            modified: false,
        });
    };

    return <button onClick={() => handleOpenFile("file-1")}>Open File</button>;
}
```

### 使用服务

通过 workspace context 访问已注册的服务。

```tsx
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";

function MyComponent() {
    const { context } = useWorkspace();

    const readFile = async (path: string) => {
        const fs = context!.services.get<FileSystemService>(Services.FileSystem);
        const result = await fs.read(path, "utf-8");
        
        if (result.ok) {
            console.log(result.data);
        } else {
            console.error(result.error);
        }
    };

    return <div>...</div>;
}
```

## 布局说明

```
┌─────────────────────────────────────────────────────────┐
│                      Title Bar                           │
├─┬─────┬──────────────────────────────────────────┬─────┬─┤
│L│     │  Action Bar          Control Bar         │     │R│
│e│  L  ├──────────────────────────────────────────┤  R  │i│
│f│  e  │                                           │  i  │g│
│t│  f  │                                           │  g  │h│
│ │  t  │         Main Editor Area                 │  h  │t│
│S│     │         (Tabs + Split View)              │  t  │ │
│e│  S  │                                           │     │S│
│l│  i  ├──────────────────────────────────────────┤  S  │e│
│e│  d  │                                           │  i  │l│
│c│  e  │         Bottom Panel                     │  d  │e│
│t│  b  │         (Optional)                       │  e  │c│
│o│  a  │                                           │  b  │t│
│r│  r  │                                           │  a  │o│
│ │     │                                           │  r  │r│
├─┴─────┴──────────────────────────────────────────┴─────┴─┤
│B                                                           │
│o  Bottom Selector                                         │
│t                                                           │
└───────────────────────────────────────────────────────────┘
```

## 设计原则

1. **完全解耦**: 每个组件独立工作，通过 Context 和 Registry 通信
2. **高度可扩展**: 插件化设计，支持动态注册/注销扩展
3. **类型安全**: 完整的 TypeScript 类型定义
4. **性能优化**: 使用 React hooks 和 memoization 避免不必要的重渲染
5. **用户体验**: 参考 VSCode/IDEA 的成熟设计模式

## 文件结构

```
workspace/
├── context/              # Context providers
│   ├── WorkspaceContext.tsx
│   └── index.ts
├── registry/            # Extension registry
│   ├── Registry.tsx
│   ├── types.ts
│   └── index.ts
├── components/          # UI components
│   └── layout/
│       ├── WorkspaceLayout.tsx
│       ├── LeftSidebar.tsx
│       ├── RightSidebar.tsx
│       ├── BottomPanel.tsx
│       ├── *Selector.tsx
│       ├── MainEditorArea.tsx
│       ├── EditorGroup.tsx
│       ├── ActionBar.tsx
│       ├── ControlBar.tsx
│       └── index.ts
├── panels/              # Built-in panels
│   ├── AssetsPanel.tsx
│   └── index.ts
├── editors/             # Built-in editors
│   ├── WelcomeEditor.tsx
│   └── index.ts
├── hooks/               # Custom hooks
│   ├── useDefaultPanels.tsx
│   ├── useDefaultEditors.tsx
│   └── index.ts
├── WorkSpaceApp.tsx     # Main app component
├── index.tsx            # Entry point
└── README.md            # This file
```

## 下一步

1. **添加更多面板**
   - Scene Hierarchy (场景层级)
   - Properties/Inspector (属性检查器)
   - Console/Output (控制台输出)
   - Timeline (时间轴)

2. **实现分屏功能**
   - 支持水平/垂直分割
   - 拖拽调整比例
   - 多组编辑器同时显示

3. **资源管理增强**
   - 基于 GUID 的资源系统
   - 元数据管理
   - 拖拽导入
   - 预览功能

4. **编辑器增强**
   - 代码编辑器 (Monaco Editor)
   - 剧情编辑器 (节点图)
   - 场景编辑器
   - 配置编辑器

5. **布局持久化**
   - 保存用户的布局配置
   - 支持多工作区布局
   - 快速切换预设布局

