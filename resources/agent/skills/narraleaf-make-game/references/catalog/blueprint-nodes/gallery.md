# 蓝图节点：画廊 · Gallery

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

「画廊 · Gallery」分类下的 10 个节点。标题是节点面板里显示的名字（中文 · English）。

The 10 nodes in the "Gallery" palette category, titled as the node palette shows them.

### 获取画廊条目 · Get Gallery

`narraleaf.gallery.getEntries` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：分组 Id · Group Id（`groupId`，string；可不连 · optional）
- 输入 · In：仅已解锁 · Only Unlocked（`onlyUnlocked`，boolean；可不连 · optional；可直接填值 · accepts a typed value）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：条目 · Entries（`entries`，array<struct:narraleaf.gallery.entry>）
- 输出 · Out：数量 · Count（`count`，integer）
- 输出 · Out：已解锁数量 · Unlocked Count（`unlockedCount`，integer）
- 设置 · Setting：类型 · Kind（`galleryKind`：CG / 回想 · Recollection / 音乐 · Music / 配音 · Voice）
- 设置 · Setting：分组 · Group（`galleryGroupId`）

### 获取画廊分组 · Get Gallery Groups

`narraleaf.gallery.getGroups`

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：分组列表 · Groups（`groups`，array<struct:narraleaf.gallery.group>）
- 输出 · Out：数量 · Count（`count`，integer）

### 获取画廊进度 · Get Gallery Progress

`narraleaf.gallery.getStats` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：分组 Id · Group Id（`groupId`，string；可不连 · optional）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：总数 · Total（`total`，integer）
- 输出 · Out：已解锁 · Unlocked（`unlocked`，integer）
- 输出 · Out：百分比 · Percent（`percent`，integer）
- 输出 · Out：变体总数 · Variant Total（`variantTotal`，integer）
- 输出 · Out：已解锁变体数 · Variant Unlocked（`variantUnlocked`，integer）
- 设置 · Setting：类型 · Kind（`galleryKind`：CG / 回想 · Recollection / 音乐 · Music / 配音 · Voice）
- 设置 · Setting：分组 · Group（`galleryGroupId`）

### 按索引获取画廊变体 · Get Gallery Variant At

`narraleaf.gallery.getVariant` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：条目 Id · Artwork Id（`artworkId`，string；可不连 · optional）
- 输入 · In：索引 · Index（`index`，integer；可直接填值 · accepts a typed value）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：图片 · Image（`image`，ImageAsset|null）
- 输出 · Out：已解锁 · Unlocked（`unlocked`，boolean）
- 输出 · Out：名称 · Name（`name`，string）
- 输出 · Out：变体 Id · Variant Id（`variantId`，string）
- 设置 · Setting：条目 · Artwork（`galleryItemId`）

### 获取画廊变体 · Get Gallery Variants

`narraleaf.gallery.getVariants` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：条目 Id · Artwork Id（`artworkId`，string；可不连 · optional）
- 输入 · In：仅已解锁 · Only Unlocked（`onlyUnlocked`，boolean；可不连 · optional；可直接填值 · accepts a typed value）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：条目 · Entries（`entries`，array<struct:narraleaf.gallery.variant>）
- 输出 · Out：数量 · Count（`count`，integer）
- 输出 · Out：已解锁数量 · Unlocked Count（`unlockedCount`，integer）
- 设置 · Setting：条目 · Artwork（`galleryItemId`）

### 画廊条目是否已解锁 · Is Gallery Unlocked

`narraleaf.gallery.isUnlocked` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：条目 Id · Artwork Id（`artworkId`，string；可不连 · optional）
- 输入 · In：变体 Id · Variant Id（`variantId`，string；可不连 · optional）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 输出 · Out：已解锁 · Unlocked（`unlocked`，boolean）
- 设置 · Setting：条目 · Artwork（`galleryItemId`）
- 设置 · Setting：变体 · Variant（`galleryVariantId`）

### 锁定画廊条目 · Lock Gallery

`narraleaf.gallery.remove` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：条目 Id · Artwork Id（`artworkId`，string；可不连 · optional）
- 输入 · In：变体 Id · Variant Id（`variantId`，string；可不连 · optional）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 设置 · Setting：条目 · Artwork（`galleryItemId`）
- 设置 · Setting：变体 · Variant（`galleryVariantId`）

### 锁定整个画廊 · Lock Whole Gallery

`narraleaf.gallery.clear` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）

### 解锁画廊条目 · Unlock Gallery

`narraleaf.gallery.add` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输入 · In：条目 Id · Artwork Id（`artworkId`，string；可不连 · optional）
- 输入 · In：变体 Id · Variant Id（`variantId`，string；可不连 · optional）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
- 设置 · Setting：条目 · Artwork（`galleryItemId`）
- 设置 · Setting：变体 · Variant（`galleryVariantId`）

### 解锁整个画廊 · Unlock Whole Gallery

`narraleaf.gallery.unlockAll` · 会等待，完成后才继续 · Latent: waits before continuing

- 可放在 · Allowed in: 应用逻辑 · App logic、页面逻辑 · Page logic、控件逻辑 · Widget logic、组件内的控件逻辑 · Widget logic inside a component、故事动作 · Story action
- 输入 · In：进入 · In（`in`，执行 · exec）
- 输出 · Out：下一步 · Next（`next`，执行 · exec）
