import type { LocaleNamespace } from "../types";

/**
 * `onboarding` 简体中文。
 *
 * 只放这条流程自己的词。每个问题问的都是设置里已有的偏好，所以标签和选项名从 `settings` 读，
 * 不在这里重写一遍：「跟随系统」有两种写法，就是设置流程和设置窗口对同一个选择各说各话的开始。
 * 预览里的文案同理，故事行取自 `story.rows.*`，版本列的标题取自 `workspace.shell`。
 *
 * 三条 zh 判据（与 `zh/lint.ts` 同）：标题是名词短语，不是句子；动词取书面形式；
 * 单行提示句末不写句号，对话框正文才写。
 */
export const onboarding = {
    windowTitle: "欢迎使用 {name}",
    progress: "进度 {current}/{total}",
    steps: {
        welcome: "欢迎",
        language: "语言",
        appearance: "外观",
        zoom: "缩放",
        identity: "作者",
        team: "团队",
        story: "故事编辑器",
        agent: "Agent 接入",
        done: "完成",
    },
    welcome: {
        title: "欢迎",
        expectation: "界面、故事编辑器与 Agent 接入的七项设置。每一项选中即刻生效，均可在设置中修改",
        haveSettings: "来自其他安装的设置",
    },
    language: {
        title: "语言",
        expectation: "Studio 界面使用的语言",
        matchedToDevice: "已匹配本机语言",
    },
    appearance: {
        title: "外观",
        expectation: "界面的主题与强调色",
    },
    zoom: {
        title: "界面缩放",
        expectation: "Studio 界面绘制的大小。本窗口跟随该设置",
        custom: "自定义",
        surface: "预览的界面",
    },
    identity: {
        title: "作者",
        expectation: "用于标记版本提交的作者名，并作为新建项目的默认作者",
        unsigned: "为空时，版本作者记为 {name}",
    },
    team: {
        title: "团队服务器",
        expectation: "共享项目的存放位置。服务器不是必需的",
        connect: "连接服务器",
        connected: "已登录",
        none: "项目保存在本机",
    },
    story: {
        title: "故事编辑器",
        expectation: "场景编辑器的阅读与输入方式",
    },
    agent: {
        title: "Agent 接入",
        expectation: "AI Agent 通过 MCP 连接 Studio，编辑打开的工程。Agent 不是必需的",
        app: "Agent 应用",
        other: "其他",
        connection: "连接",
        offHint: "开启「允许 Agent 连接」后可用",
        runCommand: "在终端中运行",
        mergeInto: "合并到 {file}",
        claudeDesktop: "合并到 claude_desktop_config.json（Claude 的 设置 > 开发者 > 编辑配置），然后重启 Claude",
        otherClient: "Streamable HTTP 传输，在客户端的 MCP 设置中填写该地址与请求头",
        skill: "Skill",
        skillFolder: "复制到 {path}，已有的其他 Skill 保持不变",
        skillInstall: "安装 Skill",
        skillReinstall: "重新安装",
        skillInstalled: "已安装到 {path}",
        skillUpload: "保存为 zip 文件，在 Claude 的 设置 > 功能 > Skills 中上传",
        skillSave: "保存 zip 文件…",
        skillSaved: "已保存到 {path}",
        skillServed: "其他应用通过 Studio 的 MCP 服务读取同一份指南。支持 Skill 的应用可在终端中运行以下命令安装",
    },
    import: {
        action: "导入设置文件…",
        leaves: "应用这份设置将结束设置流程并打开 Studio",
    },
    done: {
        title: "设置完成",
        expectation: "这里问到的每一项都在设置中。按 F1 查看光标所在处的说明",
        docs: "打开文档",
    },
    skipConfirm: {
        title: "跳过设置",
        message: "Studio 将以默认设置启动。设置流程不再出现，其中的每一项都在设置中。",
    },
    nav: {
        skip: "跳过设置",
        finish: "打开 Studio",
    },
    sample: {
        projectName: "Afterlight",
        storyName: "第一章",
        scene: "天台，傍晚",
        speaker: "Narra",
        line: "铃声是十分钟前响的。",
        lineContinued: "上面没有别人。",
        narration: "身后通往楼梯间的门一直开着。",
        background: "天台",
        placement: "居中",
        transition: "淡入淡出",
        versions: {
            latest: "天台一场，初稿",
            checkpoint: "检查点",
            earlier: "开篇",
        },
        dashboard: {
            lastActive: "刚刚",
            trackedSince: "本周",
        },
        console: {
            start: "正在构建预览…",
            assets: "86 个资产，12 个场景",
            warning: "场景「天台，傍晚」中有一个角色缺少立绘",
            done: "预览就绪，用时 3.4 秒",
        },
    },
} satisfies LocaleNamespace<"onboarding">;
