# Studio 的缓存：位置、规则与现状

**加任何缓存之前先读这份。** 它是审查 2026-08-06 全仓缓存位置之后写下的事实来源。

## 两层，各有一条硬规则

| | 全局缓存 | 工程缓存 |
|---|---|---|
| 位置 | `<缓存根>/<CacheNamespace>/`，见下一节 | 工程内 `editor/cache/` |
| 归谁 | 这台机器 | 这一个工程 |
| 版本控制 | 不适用 | **被 lore 排除**（`@shared/vcs/workingSet`） |
| 界面入口 | 设置 ▸ 缓存清单 | 目前**没有** |

**能放进缓存的判据只有一条：删掉它只损失时间，绝不损失工作。**
过不了这条的就是产品数据，该有自己的 `UserDataNamespace`。
`backgrounds/`（作者选的壁纸）、`dev-mode-saves/`、`signing/` 长得像缓存但都不是，
所以它们不在缓存根下面，也故意不在清单里。

工程缓存**必须**放在 `editor/cache/` 下，因为 `workingSet` 正是按这个前缀排除的：
派生文件因此永远不会被提交、不会出现在变更列表、不会变成一场「谁也没决定过的事实」的合并冲突。

## 缓存根在哪：装到哪就缓存到哪

全局缓存只有**一个根**，每次启动决定一次，决定写在日志的 `[Cache]` 行里。
逻辑全在 `src/main/app/application/managers/storage/cacheRoot.ts`，
入口是 `App.getCacheRootDir()`。

| 情形 | 缓存根 | `reason` |
|---|---|---|
| Windows / Linux 解包安装，且可写 | `<安装目录>/nl-cache/` | `app-directory` |
| 同上但不可写（Program Files、按机器安装） | `<userData>/nl-cache/` | `app-directory-read-only` |
| macOS | `<userData>/nl-cache/` | `app-directory-unsupported` |
| Linux AppImage | `<userData>/nl-cache/` | `app-directory-unsupported` |
| 开发 | `<userData>/nl-cache/`（即 `.dev/temp/userData-dev/`） | `development` |

后三条是**规则不是探测**，各有各的理由，动之前先读：

- **macOS 永远不用安装目录**。那是 `NarraLeaf Studio.app` 内部，bundle 带着
  `electronFuses.resetAdHocDarwinSignature` 打上的 ad-hoc 签名。往里写文件系统完全允许，
  签名却坏了，arm64 Mac 从此拒绝启动这个应用。探测会答「可写」，然后第一次缓存写入就把
  Studio 弄死。
- **AppImage 永远不用**。挂载点只读，探测本来就会拒；但即使可写也没意义，
  挂载点每次启动都是新的 `/tmp/.mount_*`，缓存永远不命中。
- **开发永远不用**。安装目录就是检出目录，几百 MB 的 Zig 不该躺在工作树里。

**根的名字是 `nl-cache`，绝不能改回 `cache`。** Chromium 的 HTTP 缓存在
`<userData>/Cache`，Windows 和 macOS 默认文件系统都不区分大小写——所以 userData 下叫
`cache` 的根**就是** Chromium 那个目录。这曾经是事实：一个 294 MB 的 Zig 工具链和
`Cache_Data` 并排躺着，清单在 `toolchains` 和 `browser` 两个桶里各数了它一遍，
而「清除界面缓存」会把 Studio 下载过的一切删光。守门的是
`cacheRoot.test.ts` 里的两条大小写测试。

旧的 `<userData>/cache` 由 `migrateLegacyCacheRoot` 在启动时清空：**只搬认识的桶名**
（那个目录在 Windows 上是 Chromium 的，删掉不认识的孩子就是删 Chromium 的索引），
能 rename 就 rename，跨盘失败就直接删——它们按定义都是重新拉一次就有的东西，
在启动时拷 300 MB 只为省一次下载是错的取舍。

## 全局：缓存根下面

| 路径 | 内容 | 在清单里 |
|---|---|---|
| `build-deps/` | 游戏构建拉的依赖 | ✅ `buildDependencies` |
| `ui-template-posters/` | 模板商店的主题海报，键 `<themeId>@<version>` | ✅ `uiTemplatePosters` |
| `spellcheck-dictionaries/` | 拼写词表，每种语言一对 `<code>.txt.gz` + `<code>.json`（含 sha256） | ✅ `spellcheckDictionaries` |
| `optimized-images/` | 构建重新编码过的图像，键 `<源字节 sha256>-<模式>-v<版本>`，两级分片；`.webp` 是留用的结果，`.rejected` 是「转过、不划算」的记号 | ✅ `optimizedImages` |
| `compressed-media/` | 构建重新编码过的音视频，键法同上 | ✅ `compressedMedia` |
| `toolchains/` | 构建拉的 Zig 工具链，一版一目录 | ✅ `toolchains` |
| `puppet-runtimes/` | 构建模型运行时时解压的 Live2D SDK，键 `<archive sha256>` | ✅ `puppetRuntimes` |
| `electron-builder/` | electron-builder 自己的下载：winCodeSign、NSIS、AppImage、跨平台目标要的 Electron 分发 | ✅ `electronBuilder` |

`electron-builder/` 是**用 `ELECTRON_BUILDER_CACHE` 搬进来的**，没有别的办法：
那些下载发生在 `app-builder.exe` 内部，它只读这个环境变量，Studio 传不了任何参数进去。
`GameBuildManager.runWorker` 给构建 worker 设这个变量，`winCodeSignCache` 读同一个变量，
所以两边天然一致。**作者自己导出过这个变量的话仍然是作者赢**——CI 镜像会设它，
而一台机器如果特意把所有 electron-builder 指向同一个共享目录，Studio 不该偷偷退出这个安排。

## 全局：不在缓存根里的

| 路径 | 内容 | 在清单里 |
|---|---|---|
| `<userData>/plugin-icons/` | 插件商店缩略图，键 `<pluginId>@<version>` | ✅ `pluginIcons` |
| `<userData>/logs/` | 日志 | ✅ `logs` |
| `<userData>/` 下 Chromium 自己的 `Cache` / `Code Cache` / `GPUCache` … | 界面缓存 | ✅ `browser` |
| `%LOCALAPPDATA%/electron-builder/Cache`（mac/linux 另有位置） | electron-builder 的**宿主默认**目录。Studio 不再往这里写，但这之前的每个 Studio 都写过 | ✅ 也算进 `electronBuilder` |
| `os.tmpdir()/narraleaf-psd/` | PSD 导入时写出的图层 | ✅ `psdImports` |

**`plugin-icons/` 的位置是历史遗留**：它在 `userData` 根下，不在缓存根下。
它先于这条约定存在。搬它是安全的（纯缓存，删掉只是重下一次），但那是一次
会影响已装机器的改动，目前**有意没做**——写在这里，免得下一个人以为是疏忽。

宿主默认的 electron-builder 目录**只列不搬**：它不是 Studio 的目录，
这台机器上任何别的 electron-builder 都在共用它。列进清单是为了那几百 MB 仍然找得到，
而不是变成一笔没人认领的孤儿。

## 工程内：全部被 lore 排除

`workingSet` 的排除表分两类，**根锚定**与**任意深度**：

根锚定（只在工程根排除，因为这些是普通英文词，作者可能拿来当内容目录名）：
`dist`、`node_modules`、`editor/cache`、`editor/assets/remote`

任意深度（这些名字属于工具或系统，不可能是作者内容）：
`.lore`、`.nlstudio`、`.git`、`.DS_Store`、`Thumbs.db`

| 路径 | 内容 | 形状 |
|---|---|---|
| `editor/cache/thumbnail/` | 资产缩略图 | 两级分片，`<encodedId>.png` |
| `editor/cache/puppet/` | 每个 puppet 模型上次挂载时自述的动作/皮肤/参数 | 平铺 `<key>.json`，**每条带输入指纹**，对不上就算未命中 |
| `editor/cache/media/support.json` | 媒体探测结果：引擎能不能播、播不了转成什么 | 单文档，按内容哈希键 |
| `editor/cache/test-parameters.json` | 每个测试上次运行时作者填的参数值 | 单文档，键 `<testId>`；**不带指纹**——取值是否还成立由读的时候拿实时声明核对，对不上就退回默认 |
| `editor/assets/remote/` | 远程资产的本地副本 | 分片；**受版控的是引用，不是副本** |
| `.nlstudio/build/staging*`、`build/mobile-icons/` | 构建产物 | |
| `.nlstudio/preview/` | 预览构建产物 | |
| `.nlstudio/convert/` | 媒体转换暂存 | |

⚠ `editor/assets/remote/` 是唯一一个**不在 `editor/cache/` 下的工程缓存**。
它单独出现在排除表里。新加工程缓存请放 `editor/cache/`，不要再增加一个例外。

⚠ `.nlstudio/devmode/revisions/` **不是缓存**——那是撤销状态，删了会丢工作。

## 内存缓存

| 位置 | 内容 | 失效方式 |
|---|---|---|
| `pluginRegistryClient.indexMemo` | 插件注册表 index，按 URL | **opt-in `maxAgeMs`**；刷新按钮不传，所以真的走网络 |
| `uiTemplateRegistryClient.indexMemo` | 模板注册表 index，按 URL | 同上，TTL 见 `UI_TEMPLATE_INDEX_MAX_AGE_MS` |
| `PluginIconCache.inFlight` / `.failures` | 请求去重 / 本次会话的失败集 | 失败集**只存内存**：一次 502 不该变成永久空图标 |
| `UITemplatePosterCache` 同上 | | |
| `storyBadgeImageCache`（渲染层） | 故事行徽章图 | |

**注册表 index 的 memo 一定要 opt-in。** 默认走网络、只有明确传 `maxAgeMs` 的调用方才复用，
这样「刷新」永远是真的刷新。模板商店以前没有 memo，一次「浏览→进主题→添加」
要拉四遍 index.json。

## 已知缺口

1. **工程缓存没有任何界面**。设置里的缓存清单只覆盖全局。一个工程的
   `.nlstudio/build/staging` 和 `editor/cache/thumbnail` 可以比所有全局缓存加起来还大，
   而界面上没有任何地方说得出它们的存在或大小。
2. `plugin-icons/` 的位置遗留，见上。
3. **缓存根的位置界面上说不出来**。日志的 `[Cache]` 行说了，清单里每个桶的路径也说了，
   但没有一句话解释「为什么我这台机器缓存在 userData 而同事那台在安装目录」。
4. **Windows 更新会连带删掉安装目录里的缓存**。NSIS 更新先跑卸载器，
   `<安装目录>/nl-cache` 跟着走。这是选安装目录时明知的代价，不是疏忽。

## 加一个新缓存的清单

1. 判据：删掉只损失时间吗？不是 → 它不是缓存。
2. 全局 → 在 `CacheNamespace` 加一项，路径用 `path.join(app.getCacheRootDir(), CacheNamespace.X)`。
   **不要写裸字符串常量**：`build-deps` 和 `puppet-runtimes` 都曾经是，
   前者和做同样事的枚举成员并排却是两种写法，后者因此从来没进过清单——
   作者能攒下任意多个解压过的 SDK，而界面上没有一个地方说得出它们存在。
   工程 → 放 `editor/cache/` 下。
3. 键上带版本或输入指纹，让「上游变了」自然表现为未命中，而不是需要一次迁移。
4. 写新版本时顺手扫掉同一实体的旧版本，目录就自然有界，不用单独的驱逐流程。
5. 全局缓存要进 `CACHE_BUCKET_IDS` 与 `cacheInventory.ts`，并在**三份** i18n 目录（`en`/`ja`/`zh`）里加标签，
   否则作者看不见它、也清不掉它。
6. 远程字节一律经主进程取，渲染层拿 `data:` URL——渲染进程不许直连网络
   （见 `renderer-never-touches-network`），而且这样恶意 index 也没法把 `<img>` 指向别处。
