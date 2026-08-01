# V5a：远程服务器（配置 / 推送 / 同步 / 克隆）

本卡把版本控制从**单机**推到**协作**：项目可以连到一台 Lore 服务器，把版本推上去、把别人的版本拉下来，
第二个人可以从服务器把工程克隆到本机。

前置事实源：[docs/version-control.md](../version-control.md)（§4 的坑、§5 服务端策略、§6 离线 diff）与
[2026-07-27-001](2026-07-27-001-plan-editor-data-and-version-control.md) §4.5。**动手前先读那两份**。

> **本卡的全部行为都在真 loreserver 0.8.5 上实测过**，不是从头文件推的。测量脚本见 §6，
> 结论逐条写在 §1。此前仓库里没有任何一行代码跟真服务器说过话——既有测试**全程 `offline: true`**。

## 0. 结论先行

| 问题 | 实测结论 |
|---|---|
| 已经建好的本地工程能不能事后连服务器 | **能，但要两步**：改写 `remote_url` **并且**用显式 id 在线登记一次仓库。只做前者会得到一个「推得上去、clone 不下来」的工程（§1.6） |
| 分歧了会怎样 | `branchPush` **自己就拒绝**，措辞已经可用；`revisionSync` **会自动合并**不冲突的改动并产生新修订 |
| 服务器连不上会不会卡死 | **不会**。在线 status 2.03s 返回 `remoteAvailable:false`；push 2.03s 抛传输错误 |
| 同步状态字段哪来的 | `repositoryStatus` 的既有字段，但**必须 `offline:false`**；离线时五个字段恒为 false |
| 令牌认证 | `authLoginWithToken` 要求 **https** 的 authUrl（`lore://` 直接拒绝）；裸服务器没有认证端点 |

## 1. 实测记录（loreserver 0.8.5，本机）

每条都可以用 §6 的脚本复现。

### 1.1 `repositoryCreate` 在 `offline:false` 下**会连服务器建库**

第二次跑同名仓库时报：

```
repositoryCreate: creating repository on server: 'Some entity that we attempted to create already exists',
"Repository local already exist with id 019f... which does not match 019f..."
```

也就是说建库不是纯本地动作——**只要 globals 不是离线的**。Studio 现在的 `initRepository` 走
`offline: true`，所以今天是安全的，但这条约束必须写死：**建库永远离线**，连服务器是之后一个独立的、
作者显式发起的动作。

### 1.2 `remote_url` 存的是**服务器源**，不是每个工程一条 URL —— 且今天所有工程都指着默认端口

传进去 `lore://127.0.0.1:41337/spike-xxx`，配置文件里落下来的是：

```toml
remote_url = "lore://127.0.0.1:41337"
```

**路径段被剥掉了。** 仓库的身份在 `.lore/id`，不在 URL 里。

后果是硬的：Studio 的占位符是 `lore://127.0.0.1:41337/local`，剥掉路径之后
**每一个 Studio 建的工程，配置文件里都写着 `lore://127.0.0.1:41337`——loreserver 的默认地址**。
今天没事只因为所有调用都离线。一旦本卡让任何调用上线，一台本机跑着 loreserver 的电脑就会
让工程去跟它说话。

> **对策**：占位符改成 `lore://unconfigured.invalid/`（`.invalid` 是 RFC 2606 保留的，
> 永远解析不了），并且 `isRemoteConfigured` 把**新旧两个占位符都当作「没配」**——
> 老工程不迁移也不会被误判成已连接。

### 1.3 分歧：push 自己会拒绝，sync 会自动合并

两边各提交一次之后：

| 调用 | 结果 |
|---|---|
| `repositoryStatus(offline:false)` | `isLocalAhead:true, isRemoteAhead:true` |
| `pushBranch` | **抛错**：`Branch has diverged, sync to merge remote changes` |
| `revisionSync` | **成功**，产生修订 `#3`，工作树三个文件都在，`fileAutomerge:0 / fileConflict:0` |

所以「分歧」不是死胡同：**push 拒绝 → 作者按同步 → 合并 → 再 push** 是一条走得通的闭环，
只有**同一个文件两边都改**才会真冲突。本卡按这条闭环做，冲突解决界面是另一条线（§5）。

Lore 的拒绝措辞已经说清了下一步该干什么，所以**原样透出**，不套一层自己的翻译。

### 1.4 服务器连不上：2 秒，不是挂死

| 调用 | 耗时 | 结果 |
|---|---|---|
| `repositoryStatus(offline:false, scan:false, revisionOnly:true)` | **2030 ms** | `remoteAvailable:false`，不抛 |
| `branchPush` | **2028 ms** | 抛 `gRPC connection to http://127.0.0.1:41999/: transport error` |

两秒可以接受，但**绝不能放在打开工程的路径上**。所以同步状态**只在作者要的时候读**——
展开服务器区、按刷新、或刚做完一次推送/同步之后。这跟 §4.17「状态查询不能挂定时器轮询」是同一条纪律，
只是这次的理由是延迟而不是副作用。

### 1.5 URL 必须带一个路径段，而那个路径段**就是仓库在服务器上的名字**

| URL | 结果 |
|---|---|
| `lore://unconfigured.invalid` | ❌ `parsing repository URL: Invalid URL` |
| `lore://unconfigured.invalid/` | ❌ 同上 |
| `lore://unconfigured.invalid:41337` | ❌ 同上 |
| `lore://unconfigured.invalid/none` | ✅ 存成 `lore://unconfigured.invalid`，仓库 `name` = `none` |

**两件事一起被这张表定死了**：占位符必须带一段路径（所以是 `.../none` 而不是 `.../`），
以及**作者要填的地址必须包含工程在服务器上的名字**——因为那正是协作者 clone 时要用的东西。
所以界面上那一个字段收的是 `lore://host:41337/my-game`，不是 `lore://host:41337`；
一个字段同时是「服务器」和「发给队友的地址」。

### 1.6 只写地址不够：**push 成功、状态说「远端有这个分支」，而工程根本 clone 不出来**

这条是整轮里最危险的一个，因为**从设置它的那台机器上看，一切都是对的**。

离线建库 → 改 `remote_url` → push：

| 观察 | 值 |
|---|---|
| `pushBranch` | 成功，`alreadyPushed: false` |
| `readSyncState` | `remoteAvailable: true, remoteAuthorized: true, **remoteBranchExists: true**` |
| `repositoryClone`（按 URL 里的名字） | ❌ `Not found` |
| `repositoryClone`（按仓库 id） | ❌ `Not found` |
| `repositoryClone`（按仓库自己的 `name`） | ❌ `Not found` |

**只有 `repositoryCreate` 会在服务器上登记仓库**，push 不会。而 `repositoryCreate` 拒绝在已经是仓库的
目录里跑。

**解法（已实测通过）**：在一个**临时空目录**里用**显式 `id`** 在线建一次库——
`repositoryCreate(online, { repositoryUrl: url, id: <本工程的 repositoryId> })`。
之后 push / 同步状态 / 按名字 clone 全部正常，clone 下来的内容也对。临时目录随即释放并删除。

所以「连接服务器」在 `VcsManager` 里是**两件事的原子操作**：写地址 **且** 登记仓库，失败就把地址
回滚。只做前一半留下的，正是上面那张表描述的状态。

### 1.7 令牌认证要 https 的 authUrl

```
authUrl: ''            -> invalid auth URL (missing scheme): ''
authUrl: 'lore://...'  -> no authentication implementation registered for scheme 'lore'
                          (available: ["ucs-auth", "https"])
authUrl: 'https://...' -> exchanging external token: failed to connect to auth endpoint
```

第三条是**对的失败**——裸 loreserver 本来就没有认证端点。所以：

- 局域网裸服务器**不需要令牌**，也没有地方可以填；
- 令牌 + authUrl 是一对，**只有服务器真的验签时才有意义**；
- **不上来就问。** 界面在服务器真的拒绝我们（`remoteAuthorized:false`）的那一刻才把这一对拿出来，
  这比一个常驻的「高级」折叠区更符合作者的处境。

> **未验证**：真实 JWT 登录成功的那条路走不通——裸服务器没有认证端点，本机造不出 JWKS。
> 令牌链路是**接通但未验证**的，接 NarraLeaf Hub 时必须重测。这条写在交付说明里。

### 1.8 凭据不进 Studio

Lore 有自己的 per-user 认证存储（`auth_list` / `auth_logout` / `auth_clear`）。所以令牌
**输入一次 → `authLoginWithToken` → Lore 自己保存**，Studio 不落盘、不进工程文件、不进全局设置。
少一处泄漏面，也少一处要加密的东西。

## 2. 边界与约束

1. **只有五个动作可以上线**：`getSyncState` / `push` / `sync` / `clone` / `login`。
   其余一律沿用 `offline: true`。这条由 `globalsFor(root, { online })` 的**单一开关**保证，
   `VcsManager` 里除这五处外没有第二个地方能把它打开。
2. **同步会写工作树**，所以它必须跟恢复（V4）走**同一条重载路径**。不这么做，编辑器会拿着旧内存
   把同步下来的内容再写回去——这正是 V4 已经踩过并写死的那条。
3. **同步前工作树必须干净**。脏树同步在实测里没有得到确定结论（当时无内容可同步），
   而它的失败模式是覆盖作者没记录过的改动，所以按最保守的来：有改动就先让作者提交。
4. **推送/同步都会产生或移动修订** → 必须让 `VersionControlService.afterRevision()` 跑到，
   否则三个版本界面会当场互相矛盾（既有实测缺陷）。
5. **渲染进程不碰网络**（既有硬约束）：远程动作全部经主进程，渲染进程只发标识符。
6. **长操作排在项目串行队列里**：一次 clone/push 期间，这个工程的其它 VCS 调用会排队等待。
   状态栏读分支因此可能变慢——可以接受，但**不能把在线状态读放进开窗路径**（§1.4）。

## 3. 落地

### 3.1 绑定层（已完成）

`lore/` 新增五个 verb，结构体逐字段抄自 `upstream.json`，因此 `definitions.test.ts` 的
161 条比对自动覆盖它们：

| verb | 用途 |
|---|---|
| `repositoryClone` | 从服务器拉一份到空目录 |
| `repositoryConfigGet` | 读 `remote_url`，判断有没有配服务器 |
| `revisionSync` | 把远端修订同步下来（写工作树） |
| `branchPush` | 把本分支推上去 |
| `authLoginWithToken` | 令牌登录 |

`branchPush` 的 `fastForwardMerge` **故意不暴露**：它让服务器替你合并，而一次 Studio 看不见、
审不了、撤不掉的合并不该是一个「推送」按钮能造成的。

### 3.2 主进程

新增 `vcs/remote.ts`：

| 函数 | 说明 |
|---|---|
| `readRemote(globals)` | `remote_url`，占位符归一成「没配」 |
| `writeRemote(root, url)` | 原子改写 `.lore/config.toml` 的那一行；**只动那一行** |
| `readSyncState(onlineGlobals)` | 既有 `VcsSyncState` 形状，2s 上限 |
| `pushBranch` / `syncFromRemote` | 薄封装 + Studio 侧的前置判据 |
| `cloneInto(url, destination)` | 空目录守卫 + clone |

`VcsManager` 相应加 `getRemote` / `setRemote` / `getSyncState` / `push` / `sync` / `clone`，
全部走既有的 `serialize`。`setRemote` 要先释放 session 再改文件，下一次调用自然重开。

### 3.3 界面：VCS 边栏里的服务器区

层级上，**服务器是仓库的属性**，和分支/HEAD 同级，所以它在「当前版本」块之下、提交表单之上：

```
[ 版本控制                          << ]
[ 当前版本 / 正在看的版本              ]
[ 服务器 ────────────────────────── ]   ← 本卡新增
[ 提交表单                            ]
[ 变更清单                            ]
[ 历史                               ]
```

服务器区的状态机（**每一格都只说这一格为真时的事**）：

| 状态 | 画什么 |
|---|---|
| 不是仓库 | **不画**。没有仓库就没有远端可言 |
| 没配服务器 | 一行说明 + 「连接服务器」→ 就地展开一个输入框（**一个字段**，不是弹窗） |
| 配了、还没查 | 主机名 + 「检查」。**不自动查**，因为连不上要 2 秒（§1.4） |
| 配了、通 | 主机名 + `↑n ↓n` + 推送 / 同步 |
| 配了、连不上 | 主机名 + 「连接不上」+ 重试 |
| 服务器拒绝我们 | 主机名 + **这时才**出现令牌 + 认证地址两个字段（§1.5） |

「容易配置」落在三件事上：常见情况**只有一个字段**（服务器地址）；令牌**不到需要时不出现**；
以及每一次失败都直接把 Lore 自己的那句话透出来——它们已经说清了下一步（§1.3）。

### 3.4 启动器：从服务器打开工程

启动器加一个入口：服务器地址 + 目标文件夹 → clone → 直接打开。

- 目标目录**必须存在且为空**，由 Studio 判据，不交给 Lore（它不问就覆盖）；
- clone 是长操作，要有进度与取消。**注意**：`invoke` 的 `onEvent` 是在调用**结束后**才派发的，
  所以现在拿不到实时进度。本卡先给不确定态进度；把 trampoline 里就地派发进度做成可选改动，
  单独评估（回调里不许重入 Lore，§4.3 后半仍然成立）。

## 4. 里程碑

| # | 内容 | 状态 |
|---|---|---|
| **R0** | 绑定层五个 verb + ABI 结构体 | ✅ 已完成 |
| **R1** | 实测 spike：分歧 / 死服务器 / 重指 / 令牌 | ✅ 已完成，结论即 §1 |
| **R2** | `remote.ts` + `VcsManager` + IPC + 在线 globals 单一开关 | ✅ |
| **R3** | 边栏服务器区（六个状态）+ i18n | ✅ |
| **R4** | 同步写工作树 → 接 V4 的重载路径；推送/同步 → `afterRevision` | ✅ |
| **R5** | 启动器 clone 入口 | |
| **R6** | 集成测试（打真服务器，`LORE_TEST_REMOTE` 未设则跳过）+ 真机验收 | 测试 ✅（7 条）／真机验收进行中 |

## 5. 不在本卡内

- **冲突解决 / 语义 diff 界面**：独立大工程，另开一条线。本卡遇到 `fileConflict > 0` 时
  **报告并停下**，列出文件，明说解决界面还没有——不假装能处理。
- **分支操作**（列表/切换/合并）：`branchSwitch` 会写工作树，且合并需要上面那个界面。
- **NarraLeaf Hub**（签发 JWT + JWKS）：§1.5 的令牌链路已经接通，Hub 是另一张卡。
- **公网部署建议**：裸 loreserver 谁连上谁能读写，文档里要写死「只在可信网络里用」。

## 6. 怎么复现这些测量

```bash
# 1. 拿到与 Studio 钉住的同一个版本的服务器（0.8.5，不是最新的 0.8.6——协议要对得上）
#    github.com/EpicGames/lore releases -> loreserver-v0.8.5-x86_64-pc-windows-msvc.zip
loreserver.exe                      # 默认就跑，41337 gRPC/QUIC + 41339 HTTP
curl http://127.0.0.1:41339/health_check

# 2. 打真服务器的集成测试；不设这个变量就整组跳过
LORE_TEST_REMOTE="lore://127.0.0.1:41337" yarn vitest run src/main/app/application/managers/vcs/
```
