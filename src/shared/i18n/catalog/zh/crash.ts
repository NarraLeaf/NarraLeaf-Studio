/**
 * `crash` - 出错之后 Studio 说的话：窗口用来顶替整个界面的那一屏，以及主进程在页面进程退出、
 * 窗口停止响应、主进程自身无法继续时弹出的三个原生对话框。
 */
export const crash = {
    screen: {
        title: "本窗口已停止工作",
        detail: "其他窗口不受影响。重新载入会按磁盘上的文件重建本窗口。",
        reload: "重新载入窗口",
        close: "关闭窗口",
        showStackTrace: "显示堆栈跟踪",
        copyDetails: "复制详情",
        copied: "错误详情已复制到剪贴板",
        copyFailed: "复制失败：{error}",
        exportLogs: "导出日志",
        exported: "日志已保存到 {path}",
        exportFailed: "导出日志失败：{error}",
        saved: "未保存的改动已写入磁盘",
        saveFailed: "未保存的改动无法写入磁盘",
    },
    rendererGone: {
        title: "窗口已停止工作",
        message: "一个 NarraLeaf Studio 窗口已停止工作。",
        messageProject: "{project} 的窗口已停止工作。",
        detail: "原因：{reason}。尚未写入磁盘的改动已丢失。",
        detailRepeated: "原因：{reason}。本窗口已连续多次停止工作，不再重新载入。",
        reload: "重新载入",
        close: "关闭窗口",
    },
    unresponsive: {
        title: "窗口无响应",
        message: "一个 NarraLeaf Studio 窗口没有响应。",
        messageProject: "{project} 的窗口没有响应。",
        detail: "重新载入会丢弃尚未写入磁盘的改动。",
        wait: "继续等待",
        reload: "重新载入",
    },
    fatal: {
        title: "NarraLeaf Studio 需要关闭",
        message: "NarraLeaf Studio 遇到了无法继续的错误。",
        detail: "报告位于 {path}。",
        restart: "重新启动",
        quit: "退出",
    },
} as const;
