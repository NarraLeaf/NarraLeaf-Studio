# 远程资产：钉住的引用 + 受版控快照

远程资产从资源管理器的第一版起就在规划里，但一直停在「建一条记录」的程度，没有跟上后来的
资产管线（哈希、格式闸、缩略图、lint、构建、VCS）。这一轮把它补齐。

裁决（2026-08-05）：**远程资产是一条钉住的引用**——URL 和内容哈希都进版本控制，字节以快照
形式随工程走，作者手上有一个显式的「检查更新」动作。不是运行时拉取（见 §1.3）。

## 1. 现状与判据

### 1.1 两条会咬人的

**构建依赖一份被明令排除在版本控制之外的缓存。** `src/shared/vcs/workingSet.ts` 把
`editor/assets/remote` 列入 `ROOT_EXCLUDED_DIRECTORIES`，注释写着「the reference is versioned,
not the copy」；而 `gameRuntimeArtifactCompiler.ts` 的 `resolveAssetSourcePath` 恰恰从那个目录
读字节往包里拷。填充那份缓存的唯一路径是作者在编辑器里预览过该资产。于是新克隆、换机器、
清过缓存、或者只是从没点开过那张图，构建就抛 `Failed to copy remote cache "..."`。

**渲染进程直连网络。** `EditorRemoteCacheManager.download()` 是渲染进程里的裸 `fetch(url)`，
另有三处把原始 URL 直接交给 DOM：`resolveWorkspaceAssetUrl` 的两个解析器与
`pluginRuntime` 的 `createObjectUrl`。这违反既有硬约束（远程字节一律经主进程）。

### 1.2 名存实亡的

- `hash: ""` —— 没有内容摘要，于是没有完整性、没有变更检测、没有去重；下游要么特判绕开
  （lint `assets/unreadable` 的豁免），要么静默跳过（`assetOverviewSnapshot`）。
- `meta.lifetime` —— 类型注释说「只影响 production 的抓取」，但 production 根本不抓：
  `GameRuntimeAssetManifestEntry` 没有 url 字段，字节全烘焙进包。默认 `0`，没有 UI 能改。
- 缓存策略 —— 无条件请求、无 TTL、无体积上限、无淘汰、内存 Map 无界、无并发去重、
  无超时重试、无字节嗅探（类型靠 URL 扩展名猜，本地导入走的 `FileFormatValidator` 完全绕过）。

### 1.3 为什么不是「运行时远程」

`lifetime` 暴露了当初的意图是运行时拉取。否决它的理由不是工程量，是它和已发货的东西冲突：
密封包与资产加密（`docs/asset-protection.md`）保护的是包里的字节，包外拉取的资产不在保护范围内；
而离线降级、玩家机器上的缓存目录与失败处理是一整套本轮不打算开的产品面。
`lifetime` 按仓库既有惯例保留为 `@deprecated` 只读字段（对照 `cuePoints`），不再有人读它。

## 2. 目标形状

**远程资产 = 本地资产 + 出处（provenance）。**

字节存在**和本地资产完全相同的位置**：`assets/content/<shard>`，受版本控制。记录仍带
`source: AssetSource.Remote`，`meta` 记住它从哪来、什么时候取的、服务器给的验证子是什么。

这条选择是整轮的支点：它让远程资产在磁盘上与本地资产**结构同构**，于是每一个为远程开的
特例都可以删掉——构建不再分叉、lint 不再豁免、总览不再跳过、缩略图直接可用。

```
meta: {
    url: string;            // 作者给的地址，原样保存
    fetchedAt: string;      // 快照取回的时刻（ISO）
    etag?: string;          // 服务器验证子，用于条件请求
    lastModified?: string;
    contentType?: string;   // 响应头声明的类型，仅作诊断
    lifetime?: number;      // @deprecated 从不读
}
```

`hash` 是快照字节的真实摘要，和本地资产同一算法、同一含义：**它变了就是字节被换过**。
VCS 的语义 diff 已经把 `hash` 单独标为「内容」（`assetsMetadata.ts` 的 `LABEL.content`），
远程资产刷新后会正确显示成一次内容变更，不需要额外接线。

## 3. 里程碑

### R1 主进程取字节

- `src/shared/constants/remoteAsset.ts`：超时、体积上限。
- `src/main/.../managers/remoteAssetFetcher.ts`：`fetchRemoteAsset(url, conditional)`
  → `{kind:"ok", bytes, etag, lastModified, contentType}` | `{kind:"not-modified"}`。
  scheme 白名单只放 `http:`/`https:`；`redirect: "follow"`；`AbortController` 超时；
  `content-length` 预检 + 读完再检一次（声明可以撒谎）；走 `applyDownloadRewrite`，
  这样作者配的镜像对远程资产同样有效。
- IPC `assetRemoteFetch` + preload `assets.fetchRemote(...)`。
  这里渲染进程**确实发地址**，与插件图标不同——地址是作者当场输入的，不是从不可信数据里读出来的；
  受约束的是「谁发起请求」，答案仍然是主进程。

### R2 导入即落地

`RemoteAssetsManager.importRemoteAsset` 变成一条真正的导入：取字节 → 过
`FileFormatValidator`（和本地导入同一道闸）→ 写 `assets/content/<shard>` → 真哈希 → 建记录。
失败就是失败，不再留下一条指向空气的记录。

`EditorRemoteCacheManager` 整个删除，`editor/assets/remote` 不再产生。

`RemoteAssetsManager.fetch` / `deleteAsset` 委托给 `LocalAssetsManager` —— 字节的位置一样，
读法与删法就该一样。`AssetsService.fetch` 与 `deleteAsset` 的 source 分叉一并去掉。

### R3 刷新

`AssetsService.refreshRemoteAsset(asset)`：带上 `If-None-Match`/`If-Modified-Since` 发一次请求。
304 → 只更新 `fetchedAt`。200 → 过格式闸 → 写字节 → 重算哈希 → 清缩略图 → 写记录 → 广播
`updated`，**顺序照抄 `replaceAssetContent` 的四步**（那个顺序是契约，不是实现细节）。

旧记录（`hash: ""`、无快照）不需要专门的迁移代码：它们没有 etag，刷新对它们就是首次下载。

### R4 管线去分叉

- `gameRuntimeArtifactCompiler.resolveAssetSourcePath` 删掉 remote 分支。
- lint `assets/unreadable` 删掉 `isRemoteAsset` 豁免——现在没有快照的远程资产**就是**一个读不出
  字节的资产，报出来是对的，而且正好是旧记录的迁移信号。
- `assetOverviewSnapshot` 删掉 remote 跳过。

### R5 界面

- 导入走既有的导入队列，有进度、有失败重试。
- 资产总览显示出处：URL、取回时间、一个「检查更新」动作。复用既有组件，不新造控件。

## 4. 不做的

- 鉴权（私有 CDN / token）、代理设置、SRI。
- 远程 Model bundle：一个 URL 对应不上一棵目录树，需要先定「远程 bundle 是什么」（zip？清单？），
  是独立一轮。当前 `fetch` 里那条 `"not supported in M2"` 的 Blueprint 分支同时收拾掉。
- 运行时拉取，理由见 §1.3。
