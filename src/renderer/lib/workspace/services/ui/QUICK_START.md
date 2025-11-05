# Quick Start Guide

快速上手新的 UI Service 架构。

## 5分钟快速示例

### 1. 创建一个带负载的编辑器

```tsx
// 1. 定义你的负载类型
interface NoteEditorPayload {
    noteId: string;
    title: string;
    content: string;
}

// 2. 创建编辑器组件
import { EditorTabComponentProps } from '@/lib/workspace/services/ui';

function NoteEditor({ tabId, payload }: EditorTabComponentProps<NoteEditorPayload>) {
    const [content, setContent] = useState(payload?.content || '');
    
    if (!payload) return <div>加载中...</div>;
    
    return (
        <div className="p-4">
            <h1>{payload.title}</h1>
            <textarea 
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full h-full"
            />
        </div>
    );
}

// 3. 在某处打开编辑器
import { useWorkspace } from '@/apps/workspace/context';
import { Services } from '@/lib/workspace/services/services';
import { UIService, createEditorTab } from '@/lib/workspace/services/ui';

function MyComponent() {
    const { context } = useWorkspace();
    const uiService = context?.services.get<UIService>(Services.UI);
    
    const openNote = (noteId: string) => {
        const tab = createEditorTab<NoteEditorPayload>({
            id: `note-editor:${noteId}`,
            title: '我的笔记',
            component: NoteEditor,
            payload: {
                noteId,
                title: '我的笔记',
                content: '笔记内容...'
            }
        });
        
        uiService?.editor.open(tab);
    };
    
    return <button onClick={() => openNote('note-1')}>打开笔记</button>;
}
```

### 2. 创建一个带负载的侧边栏

```tsx
// 1. 定义负载类型
interface FileExplorerPayload {
    rootPath: string;
    selectedFile?: string;
}

// 2. 创建面板组件
import { PanelComponentProps } from '@/lib/workspace/services/ui';

function FileExplorer({ panelId, payload }: PanelComponentProps<FileExplorerPayload>) {
    const { context } = useWorkspace();
    const uiService = context?.services.get<UIService>(Services.UI);
    
    const openFile = (filePath: string) => {
        // 在主编辑区打开文件
        const tab = createEditorTab({
            id: `file:${filePath}`,
            title: filePath.split('/').pop() || 'Untitled',
            component: FileEditor,
            payload: { filePath }
        });
        
        uiService?.editor.open(tab);
        
        // 更新面板负载，记住选中的文件
        if (payload) {
            uiService?.panels.updatePayload(panelId, {
                ...payload,
                selectedFile: filePath
            });
        }
    };
    
    return (
        <div>
            <div onClick={() => openFile('/src/main.ts')}>main.ts</div>
            <div onClick={() => openFile('/src/app.ts')}>app.ts</div>
        </div>
    );
}

// 3. 注册面板
import { createPanel, PanelPosition } from '@/lib/workspace/services/ui';

function useFileExplorerPanel() {
    const { context } = useWorkspace();
    const uiService = context?.services.get<UIService>(Services.UI);
    
    useEffect(() => {
        if (!uiService) return;
        
        const panel = createPanel<FileExplorerPayload>({
            id: 'file-explorer',
            title: '文件浏览器',
            icon: <Folder className="w-4 h-4" />,
            position: PanelPosition.Left,
            component: FileExplorer,
            payload: {
                rootPath: '/project',
                selectedFile: undefined
            }
        });
        
        return uiService.panels.register(panel);
    }, [uiService]);
}
```

### 3. 添加快捷键

```tsx
import { createKeybinding, FocusArea } from '@/lib/workspace/services/ui';

function useEditorKeybindings() {
    const { context } = useWorkspace();
    const uiService = context?.services.get<UIService>(Services.UI);
    
    useEffect(() => {
        if (!uiService) return;
        
        // Ctrl+S 保存
        const saveBinding = createKeybinding({
            id: 'editor:save',
            key: 'ctrl+s',
            description: '保存文件',
            handler: async (focusContext) => {
                if (focusContext.targetId) {
                    const payload = uiService.editor.getPayload(focusContext.targetId);
                    console.log('保存文件:', payload);
                    // 保存逻辑...
                    uiService.notifications.success('文件已保存');
                }
            },
            when: (context) => context.area === FocusArea.Editor
        });
        
        return uiService.keybindings.register(saveBinding);
    }, [uiService]);
}
```

### 4. 管理焦点

```tsx
function MyEditor({ tabId, payload }: EditorTabComponentProps) {
    const { context } = useWorkspace();
    const uiService = context?.services.get<UIService>(Services.UI);
    
    // 当编辑器获得焦点时通知系统
    const handleFocus = () => {
        uiService?.focus.setFocus(FocusArea.Editor, tabId);
    };
    
    return (
        <div 
            onFocus={handleFocus}
            tabIndex={0}
            className="h-full"
        >
            {/* 编辑器内容 */}
        </div>
    );
}
```

## 常见场景

### 场景1: 点击侧边栏项目打开编辑器

```tsx
function ProjectTreeItem({ file }: { file: File }) {
    const { context } = useWorkspace();
    const uiService = context?.services.get<UIService>(Services.UI);
    
    const handleClick = () => {
        // 创建编辑器标签页
        const tab = createEditorTab({
            id: `file:${file.path}`,
            title: file.name,
            component: FileEditor,
            payload: {
                filePath: file.path,
                content: file.content
            }
        });
        
        // 打开或聚焦已存在的标签页
        uiService?.editor.openOrUpdate(tab);
    };
    
    return (
        <div onClick={handleClick}>
            {file.name}
        </div>
    );
}
```

### 场景2: 动态更新编辑器内容

```tsx
function FileEditor({ tabId, payload }: EditorTabComponentProps<FilePayload>) {
    const { context } = useWorkspace();
    const uiService = context?.services.get<UIService>(Services.UI);
    const [content, setContent] = useState(payload?.content || '');
    
    const handleChange = (newContent: string) => {
        setContent(newContent);
        
        // 更新负载
        if (payload) {
            uiService?.editor.updatePayload(tabId, {
                ...payload,
                content: newContent
            });
        }
        
        // 标记为已修改
        uiService?.editor.setModified(tabId, true);
    };
    
    const handleSave = async () => {
        await saveFile(payload?.filePath, content);
        uiService?.editor.setModified(tabId, false);
    };
    
    return (
        <div>
            <textarea value={content} onChange={(e) => handleChange(e.target.value)} />
            <button onClick={handleSave}>保存</button>
        </div>
    );
}
```

### 场景3: 根据焦点显示不同的操作栏

```tsx
function DynamicActionBar() {
    const { context } = useWorkspace();
    const uiService = context?.services.get<UIService>(Services.UI);
    const [focusContext, setFocusContext] = useState(uiService?.focus.getFocus());
    
    useEffect(() => {
        if (!uiService) return;
        
        return uiService.focus.onFocusChange((context) => {
            setFocusContext(context);
        });
    }, [uiService]);
    
    // 根据焦点显示不同的操作
    if (focusContext?.area === FocusArea.Editor) {
        return (
            <div>
                <button>保存</button>
                <button>格式化</button>
                <button>查找</button>
            </div>
        );
    }
    
    if (focusContext?.area === FocusArea.LeftPanel) {
        return (
            <div>
                <button>新建文件</button>
                <button>新建文件夹</button>
                <button>刷新</button>
            </div>
        );
    }
    
    return null;
}
```

## 调试技巧

### 1. 查看当前焦点

```tsx
const currentFocus = uiService.focus.getFocus();
console.log('当前焦点:', currentFocus);
```

### 2. 查看所有已注册的快捷键

```tsx
const keybindings = uiService.keybindings.getAll();
console.log('已注册的快捷键:', keybindings);
```

### 3. 查看编辑器负载

```tsx
const payload = uiService.editor.getPayload(tabId);
console.log('编辑器负载:', payload);
```

### 4. 监听所有UI状态变化

```tsx
useEffect(() => {
    const unsubscribe = uiService.getEvents().on('stateChanged', (changes) => {
        console.log('UI状态变化:', changes);
    });
    
    return unsubscribe;
}, [uiService]);
```

## 下一步

- 查看 [USAGE_EXAMPLES.md](./USAGE_EXAMPLES.md) 了解更多详细示例
- 查看 [ARCHITECTURE.md](./ARCHITECTURE.md) 了解架构设计
- 查看现有的面板和编辑器实现作为参考

## 常见问题

**Q: 如何在边栏隐藏时保持状态？**  
A: 新架构已经自动处理，边栏使用CSS隐藏，组件保持挂载。

**Q: 如何传递复杂的对象作为负载？**  
A: 直接在 payload 中传递，TypeScript 会提供类型检查。

**Q: 快捷键冲突怎么办？**  
A: 使用 `when` 参数限定快捷键的作用范围。

**Q: 如何更新负载而不重新打开编辑器？**  
A: 使用 `uiService.editor.updatePayload(tabId, newPayload)`。

**Q: 边栏组件如何知道自己的 panelId？**  
A: 通过 props 自动传递：`({ panelId, payload }) => ...`

