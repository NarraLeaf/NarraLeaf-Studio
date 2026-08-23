import type { LocaleNamespace } from "../types";

/**
 * `onboarding` 简体中文。
 *
 * 只放这条流程自己的词。每个问题问的都是设置里已有的偏好，所以标签和选项名从 `settings` 读，
 * 不在这里重写一遍：「跟随系统」有两种写法，就是设置流程和设置窗口对同一个选择各说各话的开始。
 * 预览里的占位文案同理，取自 `story.rows.*`——那是编辑器本身印出来的句子。
 */
export const onboarding = {
    windowTitle: "欢迎使用 {name}",
    progress: "进度 {current}/{total}",
    steps: {
        welcome: "欢迎",
        language: "语言",
        appearance: "外观",
        zoom: "缩放",
        identity: "署名",
        team: "团队",
        story: "故事编辑器",
        done: "完成",
    },
    welcome: {
        title: "欢迎",
        expectation: "接下来是几个关于 Studio 长什么样、怎么写字的问题。这些之后都能在设置里改。",
        haveSettings: "已经在别的机器上用过 Studio？",
    },
    language: {
        title: "语言",
        expectation: "Studio 界面使用的语言，之后可在设置中修改",
        matchedToDevice: "已匹配本机语言",
    },
    appearance: {
        title: "外观",
        expectation: "主题与强调色，选中即刻生效",
    },
    zoom: {
        title: "界面缩放",
        expectation: "Studio 界面绘制的大小。这个窗口本身就是样张",
        custom: "自定义",
        surface: "预览显示",
    },
    identity: {
        title: "谁在写",
        expectation: "记在你每一次修订上的名字，以及新建工程时预填的作者",
        unsigned: "留空则修订记为 {name}",
    },
    team: {
        title: "团队服务器",
        expectation: "共享工程存放的地方。不连服务器，Studio 的功能也是完整的",
        connect: "连接服务器",
        connected: "已登录",
        none: "未连接服务器。工程留在本机，之后也可以在设置里添加",
    },
    story: {
        title: "故事编辑器",
        expectation: "场景编辑器怎么读、怎么接受输入。以下每一项在设置里都有",
    },
    import: {
        action: "导入设置文件…",
        leaves: "应用后直接进入 Studio，余下的设置由这份文件回答",
    },
    done: {
        title: "Studio 设置完成",
        expectation: "这里问过的一切，以及更多个性化选项，都在设置中；在任意位置按 F1 可查看光标所在处的说明",
        docs: "查看文档",
    },
    previewWindow: {
        open: "查看完整窗口",
        notice: "界面预览。除了可以输入的那一行，这里的东西都不接受操作",
    },
    skipConfirm: {
        title: "跳过设置？",
        message: "Studio 将以默认设置打开。设置向导不会再次出现，但它问过的每一项都在设置里。",
    },
    nav: {
        skip: "跳过设置",
        finish: "打开 Studio",
    },
    sample: {
        projectName: "示例工程",
        storyName: "第一章",
        scene: "天台，傍晚",
        speaker: "安予",
        line: "灯一下子全亮了，沿着山路一路铺下去。",
        lineContinued: "能看见路在哪里到头。",
        narration: "山下的镇子已经醒了。",
        background: "天台",
        placement: "居中",
        transition: "淡入淡出",
        rail: {
            story: "故事",
            versions: "版本控制",
            team: "团队",
        },
        versions: {
            latest: "天台一场，初稿",
            earlier: "开篇",
            checkpoint: "检查点",
        },
        dashboard: {
            lastActive: "刚刚",
            trackedSince: "本周",
        },
        console: {
            start: "正在构建预览…",
            assets: "86 个资源，12 个场景",
            warning: "场景「天台，傍晚」里有个角色没有立绘",
            done: "预览就绪，用时 3.4 秒",
        },
        teamAlone: "在本机上工作",
    },
} satisfies LocaleNamespace<"onboarding">;
