# Studio 的缓存：位置、规则与现状

**加任何缓存之前先读这份。** 它是审查 2026-08-06 全仓缓存位置之后写下的事实来源。

## 两层，各有一条硬规则

|          | 全局缓存                           | 工程缓存                                     |
| -------- | ---------------------------------- | -------------------------------------------- |
| 位置     | `userData/cache/<CacheNamespace>/` | 工程内 `editor/cache/`                       |
| 归谁     | 这台机器                           | 这一个工程                                   |
| 版本控制 | 不适用                             | **被 lore 排除**（`@shared/vcs/workingSet`） |
| 界面入口 | 设置 ▸ 缓存清单                    | 目前**没有**                                 |

**能放进缓存的判据只有一条：删掉它只损失时间，绝不损失工作。**
过不了这条的就是产品数据，该有自己的 `UserDataNamespace`。
`backgrounds/`（作者选的壁纸）、`dev-mode-saves/`、`signing/` 长得像缓存但都不是，
所以它们不在 `cache/` 下面，也故意不在清单里。

工程缓存**必须**放在 `editor/cache/` 下，因为 `workingSet` 正是按这个前缀排除的：
派生文件因此永远不会被提交、不会出现在变更列表、不会变成一场「谁也没决定过的事实」的合并冲突。

## 全局：`userData/`

| 路径                                                  | 内容                                                                | 在清单里                    |
| ----------------------------------------------------- | ------------------------------------------------------------------- | --------------------------- |
| `cache/build-deps/`                                   | 游戏构建拉的依赖                                                    | ✅ `buildDependencies`      |
| `cache/ui-template-posters/`                          | 模板商店的主题海报，键 `<themeId>@<version>`                        | ✅ `uiTemplatePosters`      |
| `cache/spellcheck-dictionaries/`                      | 拼写词表，每种语言一对 `<code>.txt.gz` + `<code>.json`（含 sha256） | ✅ `spellcheckDictionaries` |
| `plugin-icons/`                                       | 插件商店缩略图，键 `<pluginId>@<version>`                           | ✅ `pluginIcons`            |
| `logs/`                                               | 日志                                                                | ✅ `logs`                   |
| Chromium 自己的 `Cache` / `Code Cache` / `GPUCache` … | 界面缓存                                                            | ✅ `browser`                |

**唯一的历史遗留**：`plugin-icons/` 在 `userData` 根下，不在 `cache/` 下。
它先于这条约定存在。搬它是安全的（纯缓存，删掉只是重下一次），但那是一次
会影响已装机器的改动，目前**有意没做**——写在这里，免得下一个人以为是疏忽。

## 全局：不在 userData 里的

| 路径                                                          | 内容                                                             | 在清单里             |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------- |
| `%LOCALAPPDATA%/electron-builder/Cache`（mac/linux 另有位置） | electron-builder 自己的下载缓存；`winCodeSignCache` 也往这里预置 | ✅ `electronBuilder` |
| `os.tmpdir()/narraleaf-psd/`                                  | PSD 导入时写出的图层                                             | ✅ `psdImports`      |

## 工程内：全部被 lore 排除

`workingSet` 的排除表分两类，**根锚定**与**任意深度**：

根锚定（只在工程根排除，因为这些是普通英文词，作者可能拿来当内容目录名）：
`dist`、`node_modules`、`editor/cache`、`editor/assets/remote`

任意深度（这些名字属于工具或系统，不可能是作者内容）：
`.lore`、`.nlstudio`、`.git`、`.DS_Store`、`Thumbs.db`

| 路径                                              | 内容                                           | 形状                                                    |
| ------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `editor/cache/thumbnail/`                         | 资产缩略图                                     | 两级分片，`<encodedId>.png`                             |
| `editor/cache/puppet/`                            | 每个 puppet 模型上次挂载时自述的动作/皮肤/参数 | 平铺 `<key>.json`，**每条带输入指纹**，对不上就算未命中 |
| `editor/cache/media/support.json`                 | 媒体探测结果：引擎能不能播、播不了转成什么     | 单文档，按内容哈希键                                    |
| `editor/assets/remote/`                           | 远程资产的本地副本                             | 分片；**受版控的是引用，不是副本**                      |
| `.nlstudio/build/staging*`、`build/mobile-icons/` | 构建产物                                       |                                                         |
| `.nlstudio/preview/`                              | 预览构建产物                                   |                                                         |
| `.nlstudio/convert/`                              | 媒体转换暂存                                   |                                                         |

⚠ `editor/assets/remote/` 是唯一一个**不在 `editor/cache/` 下的工程缓存**。
它单独出现在排除表里。新加工程缓存请放 `editor/cache/`，不要再增加一个例外。

⚠ `.nlstudio/devmode/revisions/` **不是缓存**——那是撤销状态，删了会丢工作。

## 内存缓存

| 位置                                     | 内容                        | 失效方式                                            |
| ---------------------------------------- | --------------------------- | --------------------------------------------------- |
| `pluginRegistryClient.indexMemo`         | 插件注册表 index，按 URL    | **opt-in `maxAgeMs`**；刷新按钮不传，所以真的走网络 |
| `uiTemplateRegistryClient.indexMemo`     | 模板注册表 index，按 URL    | 同上，TTL 见 `UI_TEMPLATE_INDEX_MAX_AGE_MS`         |
| `PluginIconCache.inFlight` / `.failures` | 请求去重 / 本次会话的失败集 | 失败集**只存内存**：一次 502 不该变成永久空图标     |
| `UITemplatePosterCache` 同上             |                             |                                                     |
| `storyBadgeImageCache`（渲染层）         | 故事行徽章图                |                                                     |

**注册表 index 的 memo 一定要 opt-in。** 默认走网络、只有明确传 `maxAgeMs` 的调用方才复用，
这样「刷新」永远是真的刷新。模板商店以前没有 memo，一次「浏览→进主题→添加」
要拉四遍 index.json。

## 已知缺口

1. **工程缓存没有任何界面**。设置里的缓存清单只覆盖全局。一个工程的
   `.nlstudio/build/staging` 和 `editor/cache/thumbnail` 可以比所有全局缓存加起来还大，
   而界面上没有任何地方说得出它们的存在或大小。
2. `plugin-icons/` 的位置遗留，见上。

## 加一个新缓存的清单

1. 判据：删掉只损失时间吗？不是 → 它不是缓存。
2. 全局 → 在 `CacheNamespace` 加一项（不要写裸字符串常量：`build-deps` 曾经就是，
   和做同样事的 `UserDataNamespace` 成员并排却是两种写法）。
   工程 → 放 `editor/cache/` 下。
3. 键上带版本或输入指纹，让「上游变了」自然表现为未命中，而不是需要一次迁移。
4. 写新版本时顺手扫掉同一实体的旧版本，目录就自然有界，不用单独的驱逐流程。
5. 全局缓存要进 `CACHE_BUCKET_IDS` 与 `cacheInventory.ts`，并在**三份** i18n 目录（`en`/`ja`/`zh`）里加标签，
   否则作者看不见它、也清不掉它。
6. 远程字节一律经主进程取，渲染层拿 `data:` URL——渲染进程不许直连网络
   （见 `renderer-never-touches-network`），而且这样恶意 index 也没法把 `<img>` 指向别处。
