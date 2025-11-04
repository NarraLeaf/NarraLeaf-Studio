# NarraLeaf Studio 项目规范文档

## 目标

- 打造可扩展、一体化的 NarraLeaf 游戏制作 IDE
- 提供资源管理、节点化剧情编辑、运行与打包全流程
- 代码模块化、插件化，方便后续功能增删
- 剧情脚本使用结构化数据 `.nlstory` 作为唯一真源，保证编辑细节完整；`.nls` 作为可选导出格式

## 架构

### 主进程

- 只负责：
  - 应用生命周期
  - IPC 桥梁，暴露 Service API（文件系统、CLI 调用）
- 不参与窗口生命周期；窗口由父窗口脚本控制

### 多窗口体系

- 每个窗口独立打包，产物：`dist/windows/<name>/index.html`

### 插件系统

- 插件即 npm 包，支持两类：
  1. Renderer 插件：向某窗口注入 React 面板或工具栏按钮
  2. 主进程插件：扩展 Service API、打包流程
- 插件加载：读取项目 `package.json > narraLeafStudio.plugins`
- 插件接口声明位于 `packages/types/plugin.d.ts`

### 数据规范

1. 剧情脚本
   - `.nlstory`：JSON Schema 描述的节点图结构，IDE 直接读写
   - `.nls`：由 `.nlstory` 导出的人类可读 DSL，可用于版本对比
   - 保证一对一映射，导出/导入流程由 story-editor 提供
2. 资源描述
   - `assets/*.json`：不同类型资源独立 schema，例如 `texture.json`、`audio.json`
3. 项目结构
```text
my-game/                 # NarraLeaf Studio 项目根目录
  .nlstudio/            # IDE 私有数据（缓存、窗口布局等）
    plugins/             # 插件目录
  assets/               # 游戏资源
  scripts/              # 剧情脚本及逻辑
  project.json          # 插件列表与元数据
  assets.metadata.json  # 资产元数据
```

## 打包流程

1. 使用 esbuild 分别构建各窗口 → `dist/windows/*`
2. 调用 NarraLeaf-CLI：`nls build --input dist/windows --output build` 打包游戏资源
3. electron-builder 统一封装为最终安装包/可执行文件

### Dist

Dist 目录结构：
```text
dist/
├── main/
│   └── index.js
└── windows/
    ├── launcher/
    │   ├── index.js
    │   └── index.html
    └── ...
```
## 代码规范

- ESLint + Prettier + stylelint，保证统一代码风格
- commitlint + Conventional Commits 规范提交信息
- 单元测试：Vitest；E2E：Playwright

## CI/CD

- GitHub Actions：
  1. `lint` → `test` → `build`
  2. 发布标签触发 electron-builder，生成 Release

## 引擎

### 资源管理

所有资源导入之后复制到本地并且使用GUID进行命名，无后缀，所有元信息储存在引擎的meta系统中。

### 场景

场景使用json格式储存在特定目录中，每个场景对应一个json文件，防止读取时产生严重性能问题。

## 后续路线

1. MVP：Asset Manager + 剧情编辑器 + 基础打包
2. 插件市场 & 模板项目
3. 云同步 / 协作

---
