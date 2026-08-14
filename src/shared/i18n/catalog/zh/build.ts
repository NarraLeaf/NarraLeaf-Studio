import type { LocaleNamespace } from "../types";

export const build = {
    dialog: {
        title: "构建发行包",
        start: "开始构建",
        runningTitle: "构建进行中",
        runningBody: "该项目已有构建正在运行，进度显示在控制台",
        viewConsole: "查看控制台",
        cancelBuild: "取消构建",
    },
    platform: {
        windows: "Windows",
        macos: "macOS",
        linux: "Linux",
        web: "Web",
        android: "Android",
        ios: "iOS",
    },
    unavailable: {
        windows: "当前设备无法为 Windows 平台构建",
        macos: "只有 Mac 才能为 macOS 平台构建",
        linux: "当前设备无法为 Linux 平台构建",
        web: "任何设备都可以为 Web 平台构建",
        android: "任何设备都可以为 Android 平台构建",
        ios: "任何设备都可以为 iOS 平台构建",
    },
    format: {
        zip: "便携 ZIP",
        nsis: "安装程序",
        dmg: "磁盘映像",
        appimage: "AppImage",
        dir: "文件夹",
        apk: "APK",
        aab: "AAB",
        ipa: "IPA",
    },
    outputDir: "输出目录",
    chooseFolder: "选择文件夹…",
    // 侧边导航。其中六项对应检查结果可以归属的分区；`variant` 是选择变体的那一页，
    // 它决定其余各页描述的是哪一个变体，只在工程存在可选变体时出现；`plugins` 只在有插件
    // 索要取值时出现。
    section: {
        variant: "变体",
        targets: "目标",
        identity: "标识",
        content: "内容与保护",
        // 插件索要的取值。随包发布的插件列在「内容与保护」里，那是另一回事。
        plugins: "插件",
        signing: "签名",
        output: "输出",
    },
    arch: {
        label: "架构",
        x64: "Intel / AMD（x64）",
        arm64: "ARM（arm64）",
        universal: "通用",
    },
    // 第一页：本次构建产出哪一个变体，以及该变体发布的值。
    variant: {
        // 标在「该变体自己未填写」的读数旁边，使继承来的值与被覆盖的值在同一行都给出出处
        inherited: "来自工程",
        // 该变体的剧情止于何处。数的是指向它的截断行，因此正式变体恒为完整剧情
        boundary: "剧情结束处",
        endsNever: "剧情播放至结尾",
        endsAt: {
            one: "在 {count} 个截断点处结束，其后的内容不在这份构建里",
            other: "在 {count} 个截断点处结束，其后的内容不在这份构建里",
        },
        variantRows: {
            one: "有 {count} 行读取了变体，在不同构建里可能不同",
            other: "有 {count} 行读取了变体，在不同构建里可能不同",
        },
        blocking: "阻止本次构建",
        blockingNone: "没有阻止本次构建的问题",
    },
    identity: {
        // 第一页所做的选择的名称，同时用作那份列表的标签
        variant: "变体",
        // 标在「由该变体自己填写、而非继承」的读数旁边，使与「应用」页不一致的值在同一行给出原因
        fromVariant: "来自该变体",
        version: "项目版本",
        productName: "产品名",
        productNameSource: "源自项目名",
        appId: "应用 ID",
        copyright: "版权",
        icons: "图标",
        iconsHint: "点击图标可在项目设置中修改",
        iconUnset: "未设置",
        // 项目版本或版权为空时显示什么。这一段现在只回读，空字段得说明自己是空的，
        // 而不是看起来像一个等着输入的控件。
        notSet: "未设置",
        editInProject: "在「项目 ▸ 应用」中编辑",
    },
    content: {
        protection: "资源保护",
        protectionOn: "打包后的游戏会加密资源与存档",
        protectionOff: "资源与存档以明文随包发布",
        plugins: "随包插件",
        pluginsNone: "没有插件会随游戏发布",
        pluginsRescanUnavailable: "当前窗口无法重新扫描插件列表",
        locales: "随包语言",
        localesNone: "尚未配置本地化，游戏只发布一种语言",
        localeSource: "{name}（源语言）",
        network: "网络策略",
        networkAllowHttp: "允许明文 HTTP",
        networkStrict: "禁止明文 HTTP",
    },
    // 插件页。字段名与说明都来自插件清单，这里只写密文相关的措辞——密文是这一页唯一
    // 不会显示出来的取值。
    pluginConfig: {
        secretUnset: "未设置",
        // 凭据库还没有回答时的说法。那时只知道「已设置」，写成下面两种读法中的任何一种，
        // 都会是一个片刻之后自我撤回的判断。
        secretSet: "已设置",
        secretHere: "已设置，本机可以读取",
        secretElsewhere: "在其他设备上设置，本机没有它的值",
        secretEnter: "输入新的值",
        clear: "清除",
        secretFailed: "无法在本机保存这个值",
    },
    signing: {
        empty: "选择一个可签名的目标后，这里会列出对应平台",
        // 工程配置里存在 "linux" 名下，但它与 Linux 无关：签名文件落在这次构建
        // 产出的每一个产物旁边。
        detached: "分离签名",
        none: "不签名",
        missing: "本机没有这份凭据",
        import: "导入…",
        // 对话框只报告选择，挑选与导入都在面板里完成。
        editInProject: "在「项目 ▸ 设置」中管理",
        remove: "从本机移除",
        removeConfirm: "从本机移除 {label}？",
        removeConfirmDetail: "它的密钥材料会在本机删除；使用它的工程在重新导入之前都会以未签名方式构建",
        removeAction: "移除",
        chooseFile: "选择…",
        noFile: "未选择",
        expires: "{date} 到期",
        expired: "已于 {date} 过期",
        certUnsupported: "Studio 打不开这种容器",
        certUnreadable: "无法读取证书",
        alias: "密钥 {alias}",
        keyId: "密钥 {keyId}",
        azure: "{account} / {profile}",
        importTitle: "为 {platform} 导入",
        importAction: "导入",
        aliasLocked: "请先填写 keystore 密码",
        aliasEmpty: "该 keystore 里没有签名密钥",
        keyPasswordSame: "与 keystore 密码相同",
        macIdentityLoading: "正在读取钥匙串…",
        macIdentityEmpty: "本机钥匙串里没有代码签名证书；请在「钥匙串访问」中安装一张，或改用证书文件导入",
        macIdentityNotDeveloperId: "不能用于分发",
        notarized: "已配置 Apple 公证",
        notNotarized: "未公证，玩家首次打开时会看到 Gatekeeper 警告",
        kind: {
            "windows-pfx": "证书文件",
            "windows-store": "Windows 证书存储",
            "windows-azure": "Azure Trusted Signing",
            "macos-keychain": "钥匙串里的证书",
            "macos-apple": "证书文件",
            "android-keystore": "Release keystore",
            "ios-apple": "Apple 签名身份",
            "linux-gpg": "GPG 密钥",
        },
        field: {
            kind: "类型",
            label: "名称",
            pfx: "证书（.pfx / .p12）",
            keystore: "Keystore",
            appleCertificate: "证书（.p12）",
            provisioningProfile: "描述文件",
            password: "密码",
            storePassword: "Keystore 密码",
            keyPassword: "密钥密码",
            alias: "密钥",
            subjectName: "主题名",
            sha1: "指纹",
            endpoint: "Endpoint",
            account: "账户",
            profile: "证书配置文件",
            publisher: "发布者",
            keyId: "Key ID",
            gpgPath: "gpg 路径",
            macIdentity: "证书",
            notaryKey: "公证密钥（.p8）",
            notaryKeyId: "公证 Key ID",
            notaryIssuerId: "公证 Issuer ID",
        },
    },
    output: {
        artifacts: "产物",
        artifactsEmpty: "选择一个目标后这里会列出产物",
        openWhenDone: "构建完成后打开输出目录",
        compression: "压缩",
        compressionMaximum: "最大（体积最小）",
        compressionNormal: "标准",
        compressionStore: "不压缩（最快）",
    },
    // 构建完成后打印在产物清单下方的体积读数。数字本身不翻译：共用的字节格式化在所有语言里
    // 都是同样那几个字母，这里只放数字周围的词。
    size: {
        // 用在读不出体积的产物上，替代那个数字。不写「0 B」：那会让人以为这次构建什么都没产出。
        unknown: "体积未知",
        // 唯一的合计行。只计入真正量到的产物，因此即使有一个读不出来，这句话仍然是真的。
        totalOne: "总体积：{size}，共 1 个产物",
        totalMany: "总体积：{size}，共 {count} 个产物",
    },
    mirror: {
        official: "官方源",
        change: "修改",
    },
    preflight: {
        "no-targets": "请至少选择一个平台和格式",
        "unbuildable-platform": "当前设备无法为 {platform} 平台构建",
        "version-invalid": "项目版本 {version} 不是合法的语义化版本号，构建会失败",
        "version-missing": "未设置项目版本，将以 0.0.0 构建",
        "identifier-missing": "项目没有标识符，将使用应用 ID {appId}",
        // 构建本身同样拒绝这个文件，所以这里说明的是中止的原因，而不是替代的取值
        "variants-unreadable": "无法读取工程的变体：{reason}",
        "icon-missing": "未设置应用图标，将使用 NarraLeaf 图标",
        "icon-unusable": "{platform} 图标无法读取，将使用 NarraLeaf 图标",
        "icon-low-resolution": "{platform} 图标小于 {minimum}×{minimum}，将放大后出片",
        "icon-stale": "{platform} 图标尚未烘焙，请打开 项目 ▸ 应用 生成",
        // 这一行看起来像结局，但产出的包和没有这一行完全一样，整本书都会随包发出去。这里报场景名而
        // 不报行号：构建对话框没有行号栏，作者要打开的也是场景。
        "cut-point-inert": "{scene}（{story}）中的截断点没有从 {variant} 里去掉任何内容，该构建仍会带上整个剧本",
        // 只针对真的会截短剧本的变体；两种回答都算作答：选一个页面，或者在该变体上选「不显示任何页面」，
        // 让画面停在最后一帧。
        "variant-ending-missing": "{variant} 会提前结束剧本，但没有指定结束后显示的页面。请在 项目 ▸ 应用 ▸ 变体 中选择",
        // 句子里不带数量：对话框用的是普通翻译函数，选不了复数形式，而且这个数字并不比场景名多说什么。
        "variant-branch-uncut": "从 {scene}（{story}）出发的部分路线上没有截断点，{variant} 会把这些路线整段发出去",
        "plugins-invalid": "插件校验失败：\n{errors}",
        // {platforms} 是这一个取值需要覆盖的平台：按平台存放时是它所属的那一个，否则是本次
        // 构建的全部平台。它永远不为空，两种情形下句子读起来一样。
        "plugin-config-missing": "构建 {platforms} 需要 {plugin} 的「{field}」，该值尚未填写",
        "plugin-secret-unavailable": "{plugin} 的「{field}」在其他设备上设置，本机没有它的值。在此重新输入即可构建 {platforms}",
        "build-dependency-unavailable":
            "{plugin} 在 {platform} 上需要构建依赖 {dependency}，本机没有缓存，也无法从 {url} 获取（{reason}）；"
            + "自行下载并另存为 {path} 即可离线构建",
        "sidecar-target-missing": "{plugin} 没有为 {platform} 提供 {sidecar} 程序，它所支撑的功能在这份产物里不会生效",
        "sidecar-crossbuild-exec-bit":
            "{plugin} 的 {sidecar} 程序进入 {platform} 产物后将无法运行：Windows 无法给文件加上可执行位；"
            + "请在 {targetPlatform} 机器上构建该目标",
        "encryption-key-unavailable": "资源保护已开启，但无法取得密钥",
        "web-unprotected": "资源保护对 Web 导出不生效，其文件以明文发布",
        "progress-carry-unsupported":
            "{blueprints} 会在版本之间继承进度，而 {platform} 构建做不到：网页没有可写的共享文件，"
            + "两个节点都会走失败分支",
        "web-lossy-images": "有损图像重压缩已开启，导出的图像将以质量 {quality} 重新编码，细节不可恢复",
        "mobile-template-missing": "移动端外壳模板不可用：{reason}",
        "mobile-payload-too-large": "项目素材体积（{size}）超出移动端安装包能容纳的上限",
        "version-uncodable": "项目版本 {version} 无法编码为 Android 版本号（主版本号最大 2099，次版本号与修订号最大 999）",
        "appid-android-adjusted": "应用 ID {appId} 不是合法的 Android 包名，构建将使用 {applicationId}",
        "bundleid-ios-adjusted": "应用 ID {appId} 不是合法的 iOS Bundle ID，构建将使用 {bundleId}",
        // 不再点名 Gatekeeper / SmartScreen：那是厂商的词，不是作者的，而且两边的预期一样。
        // 更长的说法在 `build` 帮助主题里。
        unsigned: "未做代码签名；玩家首次打开时可能看到安全提示",
        "unsigned-android": "使用本地调试签名，仅供旁加载安装，这样签出的 AAB 也不能用作 Google Play 的上传密钥；选择你自己的 release keystore 即可用你的身份签名",
        "unsigned-ios": "这份 .ipa 未签名，而 iOS 不允许安装任何未签名应用；请选择一份 Apple 签名凭据；从钥匙串导出 .p12 时要连同签发链一起导出，否则签名会失败",
        "signing-credential-missing": "本机没有本工程为 {platform} 指定的签名凭据，密钥材料不会随工程流转；请在此导入，或清除该选择以未签名方式构建 {platform}",
        "signing-credential-expired": "{platform} 签名证书不在有效期内（{notBefore} 至 {notAfter}），签名会失败；请向签发方续期并导入新证书",
        "signing-credential-expiring": "{platform} 签名证书将于 {notAfter} 到期；在此之前签出的产物仍然有效，之后的构建需要续期后的证书",
        "signing-secret-unavailable": "本机无法读取 {platform} 签名凭据的密码；重新导入一次即可重新保存密码",
        "signing-tool-missing": "为 {platform} 签名需要 {tool}，本机没有安装；请安装并确保它在 PATH 中，然后重新打开本对话框",
        "signing-host-unsupported": "本机是 {host}，无法用所选凭据为 {platform} 签名：它的私钥由只存在于对应平台的系统服务保管；请在 {platform} 机器上构建这个目标",
        "signing-needs-network": "为 {platform} 签名需要联网；构建的其余环节都可离线完成",
        "signing-macos-identity-missing": "本机钥匙串里没有名为 {identity} 的证书；请在「钥匙串访问」中安装它，或在此改选其他证书",
        "signing-macos-identity-unusable": "证书 {identity} 无法用于签名：它已过期、私钥不在、或签发链不完整；请在「钥匙串访问」中打开它确认原因",
        "signing-macos-not-developer-id": "{identity} 不是「Developer ID Application」证书；产物能在本机运行，但在别人的 Mac 上会被 Gatekeeper 拒绝，Apple 也不会为它公证",
        "signing-android-not-play": "签名后的 APK 适用于旁加载安装，以及 itch.io 等接受 APK 的平台；Google Play 只接受 AAB 包，在 Android 目标下打开 AAB 格式即可产出",
        "signing-ios-profile-mismatch": "应用 ID {bundleId} 不在描述文件的覆盖范围内，该描述文件签发给的是 {profileAppId}；请修改工程标识符，或导入与之匹配的描述文件",
        "cross-build-download": "跨平台构建 {platforms} 需要下载 Electron（首次下载，之后会缓存）",
        "output-not-writable": "无法写入 {outputDir}",
        "output-not-empty": "输出目录已有文件，同名产物会被覆盖",
    },
    webStaticNotice: "Web 构建是可部署到任意网页服务器的静态站点；资源加密与 HTTP 限制对它不生效",
    toast: {
        submitted: "构建已开始，进度显示在控制台",
        done: "构建完成",
        failed: "构建失败",
    },
    invalidCommand: "{story} / {scene} 中有无效指令：{source}",
    invalidCommandSummary: {
        one: "构建已中止：有 {count} 条无效指令，详见控制台",
        other: "构建已中止：有 {count} 条无效指令，详见控制台",
    },
    appTagUnresolved: "{story} / {scene} 中 AppTag 没有得出固定值：{source}",
    appTagUnresolvedSummary: {
        one: "构建已中止：有 {count} 处 AppTag 没有得出固定值，详见控制台",
        other: "构建已中止：有 {count} 处 AppTag 没有得出固定值，详见控制台",
    },
    appTagGraphUnresolved: "{blueprint} / {graph} 中的变体没有得出固定值，请把它与变体名比较，或直接使用它的值",
    appTagGraphUnknownNode: "{blueprint} / {graph} 既判断了变体，又使用了本次构建无法读取的节点，请把变体判断移到不含该节点的图中",
    appTagGraphFnHead: "{blueprint} / {graph} 中的变体判断决定了一个 Fn 是否存在，请把该 Fn 移出它决定的分支",
    appTagGraphSummary: {
        one: "构建已中止：有 {count} 处蓝图的变体判断没有得出固定值，详见控制台",
        other: "构建已中止：有 {count} 处蓝图的变体判断没有得出固定值，详见控制台",
    },
    cutPointNested: "{story} / {scene} 中 {variant} 的截断点位于条件或分组内部，请把它移到场景顶层",
    cutPointNestedSummary: {
        one: "构建已中止：有 {count} 处截断点不在场景顶层，详见控制台",
        other: "构建已中止：有 {count} 处截断点不在场景顶层，详见控制台",
    },
    contentBlockedStartStory: "{location} 中的开始游戏节点在运行时才确定场景。请在检查器中选定场景，或在 {variant} 变体中列出它可以开始的场景",
    contentBlockedScript: "蓝图 {location} 使用 TypeScript 编写，可以开始任意场景。请在 {variant} 变体中列出它可以开始的场景",
    contentBlockedPlugin: "{location} 插件可以开始任意场景。请在 {variant} 变体中列出它可以开始的场景",
    contentBlockedSummary: {
        one: "构建已中止：有 {count} 处可以开始 {variant} 构建无法读取的场景，详见控制台",
        other: "构建已中止：有 {count} 处可以开始 {variant} 构建无法读取的场景，详见控制台",
    },
    contentStaleDeclaration: "{variant} 变体中为 {location} 列出的某个场景已不在本工程中",
    contentKept: {
        one: "{variant} 构建包含 {count} 个场景",
        other: "{variant} 构建包含 {count} 个场景",
    },
    contentDropped: "{story} 中的 {scene} 不在本次构建里",
    // 只针对会删场景的构建，也只针对剧本文档里的缺口：索引认不出某个控件里的图片，说明不了任何剧本能
    // 走到哪些场景；为这种缺口拒绝构建，等于让一个谁也解析不了的 URL 永久挡住所有变体的构建。
    contentCoverageGap: "{location} 无法读取，因此无法判断 {variant} 构建应当去掉什么",
    // 缺口指的是整份索引而不是某个文档时，`{location}` 用这句。
    contentCoverageWholeProject: "本工程",
    contentCoverageSummary: {
        one: "构建已中止：{variant} 构建会删场景，但有 {count} 份文档无法读取，详见控制台",
        other: "构建已中止：{variant} 构建会删场景，但有 {count} 份文档无法读取，详见控制台",
    },
    mediaNeedsConverting: "{asset} 无法播放，请在素材面板中转换",
    mediaNotPlayable: "{asset} 不含音频也不含视频，请替换或删除该文件",
    mediaSummary: {
        one: "构建已中止：有 {count} 个素材无法播放，详见控制台",
        other: "构建已中止：有 {count} 个素材无法播放，详见控制台",
    },
    networkNodeDisallowed: "{blueprint} 发起了网络请求，本工程不允许",
    networkSummary: {
        one: "构建已中止：有 {count} 个网络节点无法运行；请在工程设置中开启「允许 HTTP」，或删除该节点",
        other: "构建已中止：有 {count} 个网络节点无法运行；请在工程设置中开启「允许 HTTP」，或删除这些节点",
    },
    networkAddressNotAllowlisted: "{blueprint} 请求了 {url}，它不在本工程的网络白名单内",
    networkAllowlistSummary: {
        one: "构建已停止：有 {count} 个地址不在网络白名单内。请在工程设置里加上它，或者改掉这个节点",
        other: "构建已停止：有 {count} 个地址不在网络白名单内。请在工程设置里加上它们，或者改掉这些节点",
    },
    mediaUnchecked: {
        one: "有 {count} 个媒体文件未经检查，本机没有可用的转换工具",
        other: "有 {count} 个媒体文件未经检查，本机没有可用的转换工具",
    },
} satisfies LocaleNamespace<"build">;
