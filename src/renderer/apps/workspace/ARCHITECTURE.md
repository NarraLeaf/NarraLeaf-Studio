# Workspace 架构文档

## 系统概览

Workspace 窗口是一个完全模块化、高度解耦的工作区系统，采用插件化架构设计，支持动态扩展。

## 核心设计原则

### 1. 完全解耦
- 每个组件独立工作，不直接依赖其他组件
- 通过 Context API 和 Registry 系统进行通信
- 易于测试和维护

### 2. 高度可扩展
- 插件化的面板系统
- 动态注册/注销机制
- 支持运行时扩展

### 3. 类型安全
- 完整的 TypeScript 类型定义
- 编译时类型检查
- 良好的 IDE 支持

### 4. 性能优化
- React hooks 和 memoization
- 按需渲染
- 懒加载支持

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     WorkSpaceApp                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              WorkspaceProvider                         │  │
│  │  - 初始化 Workspace Context                           │  │
│  │  - 初始化所有 Services                                │  │
│  │  - 提供 workspace, context, 状态                      │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │          RegistryProvider                        │  │  │
│  │  │  - 管理面板注册                                  │  │  │
│  │  │  - 管理操作注册                                  │  │  │
│  │  │  - 管理编辑器标签页                              │  │  │
│  │  │  ┌───────────────────────────────────────────┐  │  │  │
│  │  │  │      WorkspaceLayout                       │  │  │  │
│  │  │  │  - 渲染布局结构                            │  │  │  │
│  │  │  │  - 管理边栏显示/隐藏                        │  │  │  │
│  │  │  │  - 管理活动面板                            │  │  │  │
│  │  │  └───────────────────────────────────────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. Context System (`context/`)

#### WorkspaceContext
负责初始化和管理 workspace 实例及其服务。

**职责:**
- 创建 Workspace Context
- 初始化所有注册的 Services
- 激活/销毁 Services
- 提供全局访问接口

**状态管理:**
```typescript
interface WorkspaceContextValue {
    workspace: Workspace | null;      // Workspace 实例
    context: WorkspaceCtx | null;     // Workspace 上下文
    isInitialized: boolean;            // 初始化状态
    error: Error | null;               // 错误信息
}
```

**使用方式:**
```tsx
import { useWorkspace } from "./context";

function MyComponent() {
    const { workspace, context, isInitialized, error } = useWorkspace();
    
    // 访问服务
    const fs = context?.services.get<FileSystemService>(Services.FileSystem);
}
```

### 2. Registry System (`registry/`)

#### Registry
管理所有可扩展的内容：面板、操作、编辑器。

**核心类型:**

```typescript
// 面板定义
interface PanelDefinition {
    id: string;                    // 唯一标识
    title: string;                 // 显示标题
    icon: ReactNode;               // 图标
    position: PanelPosition;       // 位置（左/右/底）
    component: FC;                 // 面板组件
    defaultVisible?: boolean;      // 默认可见性
    order?: number;                // 排序顺序
}

// 操作定义
interface ActionDefinition {
    id: string;                    // 唯一标识
    label: string;                 // 显示标签
    icon: ReactNode;               // 图标
    tooltip?: string;              // 提示文本
    onClick: () => void;           // 点击处理
    order?: number;                // 排序顺序
    disabled?: boolean;            // 禁用状态
    visible?: boolean;             // 可见性
}

// 编辑器标签页定义
interface EditorTabDefinition {
    id: string;                    // 唯一标识
    title: string;                 // 标题
    icon?: ReactNode;              // 图标
    component: FC<{ tabId: string }>; // 编辑器组件
    closable?: boolean;            // 可关闭
    modified?: boolean;            // 修改状态
}
```

**API:**
```typescript
// 面板管理
registerPanel(panel: PanelDefinition): void
unregisterPanel(id: string): void
getPanelsByPosition(position: PanelPosition): PanelDefinition[]

// 操作管理
registerAction(action: ActionDefinition): void
unregisterAction(id: string): void

// 编辑器管理
openEditorTab(tab: EditorTabDefinition, groupId?: string): void
closeEditorTab(tabId: string, groupId?: string): void
setActiveEditorTab(tabId: string, groupId: string): void

// 面板可见性
togglePanelVisibility(panelId: string): void
setPanelVisibility(panelId: string, visible: boolean): void
```

### 3. Layout System (`components/layout/`)

#### WorkspaceLayout
主布局容器，协调所有子组件。

**布局结构:**
```
┌─────────────────────────────────────────────┐
│              TitleBar                        │
├──┬─────┬───────────────────────────┬─────┬──┤
│LS│     │ ActionBar   ControlBar   │     │RS│
│  │  L  ├──────────────────────────┤  R  │  │
│  │  e  │                           │  i  │  │
│  │  f  │    MainEditorArea        │  g  │  │
│  │  t  │    (Tabs + Content)      │  h  │  │
│  │     ├──────────────────────────┤  t  │  │
│  │  S  │    BottomPanel           │     │  │
│  │  i  │    (Optional)            │  S  │  │
│  │  d  │                           │  i  │  │
│  │  e  │                           │  d  │  │
│  │  b  │                           │  e  │  │
│  │  a  │                           │  b  │  │
│  │  r  │                           │  a  │  │
│  │     │                           │  r  │  │
├──┴─────┴───────────────────────────┴─────┴──┤
│BP                                            │
└──────────────────────────────────────────────┘

LS = LeftSidebarSelector
RS = RightSidebarSelector
BP = BottomPanelSelector
```

**组件职责:**

- **Selectors**: 显示图标按钮，切换和选择面板
- **Sidebars**: 容器组件，显示选中的面板内容
- **ActionBar**: 左上角动态操作按钮
- **ControlBar**: 右上角控制按钮（边栏切换、设置）
- **MainEditorArea**: 主编辑区，支持标签页和分屏
- **EditorGroup**: 标签页组，管理多个编辑器标签

#### 交互流程

**打开面板:**
```
用户点击 Selector 中的图标
  ↓
Selector 调用 onSelectPanel(panelId)
  ↓
WorkspaceLayout 更新 activePanelId
  ↓
Sidebar 根据 panelId 渲染对应面板组件
```

**打开编辑器:**
```
组件调用 registry.openEditorTab(tab)
  ↓
Registry 更新 editorLayout 状态
  ↓
MainEditorArea 检测到更新
  ↓
EditorGroup 渲染新标签页
```

### 4. Services (`lib/workspace/services/`)

#### 服务架构

**基类: Service**
```typescript
abstract class Service<T> extends Singleton<T> {
    // 初始化方法，支持依赖注入
    protected abstract init(
        ctx: WorkspaceContext,
        depend: (services: Service[]) => Promise<void>
    ): Promise<void> | void;
    
    // 激活和销毁钩子
    activate(ctx: WorkspaceContext): Promise<void> | void;
    dispose(ctx: WorkspaceContext): Promise<void> | void;
}
```

**已实现的服务:**

1. **FileSystemService**
   - 文件和目录操作
   - 支持读写、创建、删除、移动、复制
   - 基于 IPC 通信

2. **ProjectService**
   - 项目配置管理
   - 依赖 FileSystemService
   - 读取和维护 project.json

**服务使用:**
```typescript
const { context } = useWorkspace();
const fs = context.services.get<FileSystemService>(Services.FileSystem);

const result = await fs.read(path, "utf-8");
if (result.ok) {
    console.log(result.data);
}
```

## 扩展点

### 1. 注册新面板

```typescript
// hooks/useMyPanel.tsx
export function useMyPanel() {
    const { registerPanel, unregisterPanel } = useRegistry();
    
    useEffect(() => {
        registerPanel({
            id: "my-panel",
            title: "My Panel",
            icon: <Icon />,
            position: PanelPosition.Left,
            component: MyPanelComponent,
            order: 10,
        });
        
        return () => unregisterPanel("my-panel");
    }, []);
}

// 在 WorkspaceContent 中使用
useMyPanel();
```

### 2. 注册新操作

```typescript
export function useMyAction() {
    const { registerAction, unregisterAction } = useRegistry();
    
    useEffect(() => {
        registerAction({
            id: "my-action",
            label: "My Action",
            icon: <Icon />,
            onClick: handleClick,
            order: 0,
        });
        
        return () => unregisterAction("my-action");
    }, []);
}
```

### 3. 创建新编辑器

```typescript
function MyEditor({ tabId }: { tabId: string }) {
    // 编辑器实现
    return <div>Editor content</div>;
}

// 在某个组件中打开
const { openEditorTab } = useRegistry();

openEditorTab({
    id: "unique-id",
    title: "My File",
    component: MyEditor,
});
```

### 4. 添加新服务

```typescript
// services/MyService.ts
export class MyService extends Service<MyService> 
    implements IMyService {
    
    protected async init(
        ctx: WorkspaceContext,
        depend: (services: Service[]) => Promise<void>
    ) {
        // 声明依赖
        const fs = ctx.services.get<FileSystemService>(Services.FileSystem);
        await depend([fs]);
        
        // 初始化逻辑
    }
    
    // 服务方法
    async myMethod() {
        // 实现
    }
}

// services/serviceRegistry.ts
export class ServiceRegistry {
    private services = {
        // ...
        [Services.MyService]: MyService.getInstance(),
    };
}
```

## 数据流

### 单向数据流

```
User Action
    ↓
Registry/Context API
    ↓
State Update
    ↓
Component Re-render
```

### 示例：打开编辑器标签页

```
1. 用户点击 Assets 面板中的文件
   ↓
2. AssetsPanel 调用 registry.openEditorTab()
   ↓
3. Registry 更新 editorLayout 状态
   ↓
4. MainEditorArea 订阅状态变化，重新渲染
   ↓
5. EditorGroup 显示新标签页和内容
```

## 性能优化

### 1. 组件 Memoization
```typescript
// 使用 useMemo 缓存计算结果
const filteredPanels = useMemo(
    () => panels.filter(p => p.position === position),
    [panels, position]
);

// 使用 useCallback 缓存函数
const handleClick = useCallback(() => {
    // ...
}, [dependencies]);
```

### 2. 条件渲染
```typescript
// 只渲染可见的组件
{leftSidebarVisible && activeLeftPanelId && (
    <LeftSidebar panelId={activeLeftPanelId} />
)}
```

### 3. 懒加载
```typescript
// 动态导入大型组件
const HeavyEditor = lazy(() => import('./HeavyEditor'));
```

## 未来扩展

### 1. 分屏支持
实现 `EditorSplit` 类型的布局：

```typescript
interface EditorSplit {
    direction: "horizontal" | "vertical";
    ratio: number;
    first: EditorSplit | EditorGroup;
    second: EditorSplit | EditorGroup;
}
```

### 2. 拖拽功能
- 拖拽调整边栏宽度
- 拖拽调整分屏比例
- 拖拽排序标签页

### 3. 布局持久化
```typescript
interface LayoutState {
    leftSidebarVisible: boolean;
    rightSidebarVisible: boolean;
    bottomPanelVisible: boolean;
    activeLeftPanelId: string | null;
    editorLayout: EditorLayout;
    // ...
}

// 保存到 localStorage 或 IPC
saveLayout(state: LayoutState): void
loadLayout(): LayoutState | null
```

### 4. 键盘快捷键
```typescript
interface KeyBinding {
    key: string;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    action: () => void;
}

// 注册快捷键
registerKeyBinding(binding: KeyBinding): void
```

### 5. 命令面板
类似 VSCode 的命令面板（Ctrl+Shift+P）：

```typescript
interface Command {
    id: string;
    label: string;
    category: string;
    execute: () => void;
}

registerCommand(command: Command): void
```

## 最佳实践

### 1. 组件设计
- 保持组件单一职责
- 使用组合而非继承
- 提取可复用的逻辑到 hooks

### 2. 状态管理
- 将状态提升到最近的公共祖先
- 避免过度嵌套的状态
- 使用 Context API 传递深层数据

### 3. 性能
- 使用 React.memo 优化纯组件
- 避免在渲染中创建新对象/函数
- 合理使用 useMemo 和 useCallback

### 4. 类型安全
- 为所有 props 定义接口
- 避免使用 any 类型
- 利用泛型提高代码复用

### 5. 错误处理
- 使用 Result 类型处理异步操作
- 提供友好的错误信息
- 添加错误边界组件

## 总结

Workspace 系统是一个高度模块化、可扩展的工作区实现，通过清晰的架构和良好的设计模式，为开发者提供了强大而灵活的开发环境。

**关键特性:**
- ✅ 完全解耦的组件架构
- ✅ 插件化的扩展系统
- ✅ 类型安全的 API
- ✅ 高性能的渲染优化
- ✅ 友好的开发者体验

**扩展性:**
- ✅ 易于添加新面板
- ✅ 易于添加新操作
- ✅ 易于添加新编辑器
- ✅ 易于添加新服务
- ✅ 支持运行时动态扩展

