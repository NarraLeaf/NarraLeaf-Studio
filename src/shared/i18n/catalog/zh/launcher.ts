import type { LocaleNamespace } from "../types";

export const launcher = {
    nav: {
        projects: "项目",
        // 排在「项目」和「插件」之间：它回答的是同一个问题的另一半。「项目」是这台机器上已有的，
        // 「服务器」是这台机器可以取到的。
        servers: "Team",
        plugins: "插件",
        learning: "学习",
        settings: "设置",
    },
    projects: {
        title: "项目",
        // 是「添加」不是「新建」：这个按钮背后的向导还能解包安装包、从服务器克隆，
        // 那两条都不创建任何东西。
        addProject: "添加项目",
        openProject: "打开项目",
        recentTitle: "最近项目",
        openFolder: "打开文件夹",
        openNamed: "打开 {name}",
        search: {
            placeholder: "搜索项目",
            clear: "清除搜索",
            empty: "没有匹配“{query}”的项目",
        },
        // 第一个项目出现之前的整个标签页，见 WelcomePane。
        // 第二块磁贴不复用 openFolder：那条在标题栏里要单独当 tooltip 用，
        // 这里两块并排是同一个选择，「打开…」的省略号才说明下一步会弹出文件对话框。
        // 第一块仍用 addProject，向导做的事不止「新建」。
        empty: {
            title: "欢迎使用 NarraLeaf Studio",
            subtitle: "打开过的项目会显示在此处",
            openFolder: "打开…",
        },
        // 按将要响应的系统命名：作者接下来看到的就是那个窗口。
        // 分成三条而不是一条「在文件管理器中打开」：访达和资源管理器是这两个系统自己的叫法，
        // 菜单另造一个词会让人以为打开的是别的东西。通用说法只留给没有统一名字的系统。
        errorReveal: "打开项目文件夹失败",
        removeFromRecent: "从最近列表中移除",
        removeConfirm: {
            title: "从最近列表中移除",
            message: "{name} 将不再出现在此列表中，磁盘上的文件不会被删除",
            confirm: "移除",
        },
        moreActions: "更多操作",
        moreActionsNamed: "{name} 的更多操作",
        removeNamedFromRecent: "将 {name} 从最近项目中移除",
        errorCreate: "添加项目失败",
        errorOpenFolder: "打开文件夹失败",
        missing: {
            reasonFolderMissing: "此项目文件夹已被删除或移动",
            reasonNotAProject: "此文件夹已不是 NarraLeaf 项目",
            dialogTitle: "找不到此项目",
            note: "移除只会更新此列表，不会删除磁盘上的任何文件",
            relocate: "重新定位…",
            remove: "从列表移除",
            errorNotAProject: "所选文件夹不是 NarraLeaf 项目",
        },
        // 指向 Team 服务器的项目。本机断开与该服务器的连接后，项目不再能打开，
        // 只能删除本地副本或转为个人项目：服务器那一侧的设置只在项目之外修改。
        team: {
            label: "团队项目",
            on: "{server} 上的团队项目",
            signedOut: "已断开与 {server} 的连接",
            gate: {
                title: "无法打开团队项目",
                message: "本机已断开与 {server} 的连接，无法打开此团队项目",
                note: "转为个人项目会保留全部内容与版本历史，此后不再与服务器同步；删除会将项目文件夹移到{trash}",
                detach: "转为个人项目",
                delete: "删除",
            },
            detachConfirm: {
                title: "转为个人项目",
                message: "{name} 将不再与 {server} 同步，内容与版本历史保留在本机",
                confirm: "转为个人项目",
            },
            deleteConfirm: {
                title: "删除项目",
                message: "{name} 的项目文件夹将被移到{trash}，可从中恢复",
                confirm: "删除",
            },
            trashMac: "废纸篓",
            trashOther: "回收站",
            errorDetach: "转为个人项目失败",
            errorDelete: "删除项目失败",
            errorOpen: "请先关闭正在使用此项目的窗口",
            // 首页列表里，当前账号所在服务器上本机尚无副本的项目：排在本机项目之后，
            // 点击时先确认克隆
            uncloned: "{server} 上尚未克隆的项目",
            notCloned: "未克隆",
            details: "查看详情",
            detailsTitle: "项目详情",
            newOn: "在 {server} 上新建团队项目",
            clone: {
                action: "克隆",
                hint: "克隆 {name}",
                title: "克隆团队项目",
                message: "{name} 尚未克隆到本机。是否从 {server} 克隆该项目？下一步可选择副本的存放位置",
                confirm: "克隆",
            },
        },
    },
    // 「服务器」标签页。它列的是已登录服务器上有什么；这台机器上已有的由「项目」标签页回答，
    // 这里不重复。
    servers: {
        // 打开「添加服务器」对话框的那一个控件，在视图切换那条线的右端，以及空状态里。
        // 只作提示与标签，不出现为可见文字。
        manage: "添加服务器",
        empty: {
            title: "没有服务器",
            description: "服务器上的项目会显示在这里",
            action: "添加服务器",
        },
        choose: "选择一台服务器",
        newProject: "新建项目",
        loading: "正在读取项目列表",
        noProjects: "该服务器上暂无项目",
        // 同一台服务器的两个视图，名字写在切换它们的标签条上。
        // 成员那一栏用的还是 people.title，两处是同一个词。
        tabs: {
            projects: "项目",
            todos: "我的待办",
            active: "活跃项目",
        },
        // 只有一个动作，而且它在项目自己的页面上，不在行里。用「获取」而不是「克隆」，
        // 因为它背后的向导还会问副本放在哪里。
        open: "打开",
        get: "获取",
        // 写在本机已有的那个项目行上，是说明文字旁边的一个词，不是另起的标记。
        // 这正是这个标签页要回答的问题，所以留在能一眼扫过去的地方。
        here: "已在本机",
        // 项目列表移到首页后，Team 页面保留的两个视图
        todos: {
            loading: "正在读取待办",
            problem: "暂时无法读取待办",
            empty: "暂无待办",
            noProject: "未关联项目",
            cloneHint: "克隆 {name}",
            due: "{date} 截止",
            status: {
                open: "待处理",
                doing: "进行中",
            },
        },
        active: {
            empty: "近 7 天暂无活跃项目",
            online: "{names} 正在使用",
            notHere: "未克隆",
        },
        // 服务器读过该仓库，里面没有内容。只有服务器给出的数字确实为零时才写；
        // 还没读过的服务器什么都不说，这里也就什么都不写。
        nothingSent: "尚未发送内容",
        // 只有服务器给出了时间才会出现。服务器还没读过仓库时它什么都不说，这里也就什么都不写。
        lastVersion: "上一个版本 {date}",
        lastVersionBy: "上一个版本 {date}，由 {name} 记录",
        problem: {
            noToken: "本机无法访问该服务器，请使用令牌重新添加",
            refused: "该服务器拒绝本机登录的账号",
            unreachable: "该服务器无响应",
            // 只有发布时才会遇到，而这个页面在「为某台服务器新建项目」时就会发布。
            // 名字就是项目自己的 app id，审阅页已经写过，这里不重复。
            nameTaken: "该服务器上已有同名项目",
            // 这里不重复名字：这个页面按项目自己的 app id 发布，审阅页已经写过，
            // 而这行旁边就是列表，能看到它已经以什么名字在服务器上。
            alreadyPublished: "本项目已以其他名称存在于该服务器",
            unknown: "无法读取该服务器",
        },
        // 在本机建好、但服务器没有接收的项目。项目本身是完整的，缺的只是与服务器的连接，
        // 这个对话框负责把它打开，让版本轨道再试一次。
        unsent: {
            title: "项目未发送",
            message: "{name} 已在本机创建，未发送到 {server}",
            open: "打开项目",
            close: "关闭",
        },
        // 从一行项目打开进去的地方。只有当服务器能说出列表之外的东西时才会出现。
        detail: {
            back: "全部项目",
            loading: "正在读取该项目",
            // 主操作旁边的溢出菜单。里面那件事是破坏性的，也没人是为了做它才打开项目的，
            // 所以要多点一下才够得着。
            more: "更多操作",
            moreNamed: "{name} 的更多操作",
            createdBy: "创建者",
            created: "创建于",
            lastVersion: "上一个版本",
            // 只有服务器读过项目文件才会出现。这些数字都是服务器给的，没有一个是本机算出来的。
            title: "标题",
            stage: "舞台",
            scenes: "场景",
            assets: "资产",
            // 刚创建的项目本来就是这样；读取功能没跑起来的部署上，这就是唯一的答案。
            // 它取代那几行数字，而不是把数字填成零；服务器自己的说明也不重复，
            // 那句话是写给运维服务器的人看的。
            //
            // **只说项目文件这一件事。** 版本是另外问的，可以单独缺席；
            // 在上面已经写着场景数的项目下面说这句话，就是自相矛盾——
            // 那种情况在下面有自己的一行。
            unread: "服务器尚未读取该项目",
            // 写在 unread 之前并取代它：没人往里面发送过内容的项目，本来就没有项目文件可读，
            // 两句话说的是同一件事。
            empty: "该项目尚未收到任何内容",
            versions: "最近的版本",
            noVersions: "没有记录任何版本",
            // 服务器答了这个项目的其他内容，却没有给版本。不是「没有版本」：
            // 这里不知道的是那份名单，不是它的长度。
            versionsUnavailable: "该项目的版本暂不可用",
            olderVersions: "更早的版本不在此显示",
        },
        discussion: {
            title: "讨论",
            empty: "该项目暂无备注",
            placeholder: "写一条备注",
            add: "添加",
            resolve: "标记为已解决",
            reopen: "重新打开",
            resolved: "已解决",
            failed: "备注未发送",
            unavailable: "无法读取该项目的讨论",
            watch: "关注",
            watching: "已关注",
            watchHint: "项目有改动时通知我",
            react: "添加表情回应",
        },
        forget: {
            action: "从该服务器移除",
            title: "从该服务器移除",
            message: "{name} 将不再出现在 {server} 的项目列表中，仓库及其中的所有版本仍保留在服务器上",
            confirm: "移除",
            cancel: "取消",
            failed: "项目未能移除",
        },
        // 这台服务器上还有谁。账号地址随列表一起读取，但只在读者打开某个成员时才显示。
        people: {
            title: "成员",
            loading: "正在读取成员列表",
            none: "该服务器上暂无账号",
            // 是词，不是彩色徽标：它们只在适用的那天有意义，其余时候什么都不说，
            // 所以就以文字的形式排在名字旁边。
            operator: "管理员",
            disabled: "已停用",
            serviceAccount: "服务账号",
            noAddress: "该账号未设置邮箱地址",
        },
    },
    // 中文只有一种复数形式，只需给出 other。
    recentCount: {
        other: "{count} 个最近项目",
    },
} satisfies LocaleNamespace<"launcher">;
