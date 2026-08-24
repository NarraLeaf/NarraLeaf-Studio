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
        done: "完成",
    },
    welcome: {
        title: "欢迎",
        expectation: "界面与故事编辑器的设置，共六屏。每一项选中即刻生效，之后都在设置中",
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
        expectation: "记录在每个版本上的名字，以及新建工程时的默认作者",
        unsigned: "留空则版本记为 {name}",
    },
    team: {
        title: "团队服务器",
        expectation: "共享工程的存放位置。服务器不是必需的",
        connect: "连接服务器",
        connected: "已登录",
        none: "工程保存在本机",
    },
    story: {
        title: "故事编辑器",
        expectation: "场景编辑器的阅读与输入方式",
    },
    import: {
        action: "导入设置文件…",
        leaves: "应用这份设置将结束设置流程并打开 Studio",
    },
    done: {
        title: "设置完成",
        expectation: "这里的每一项都在设置中。按 F1 查看光标所在处的说明",
        docs: "打开文档",
    },
    skipConfirm: {
        title: "跳过设置？",
        message: "Studio 将以默认设置打开。设置流程不再出现，其中的每一项都在设置中。",
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
            warning: "场景「天台，傍晚」里有个角色没有立绘",
            done: "预览就绪，用时 3.4 秒",
        },
    },
} satisfies LocaleNamespace<"onboarding">;
