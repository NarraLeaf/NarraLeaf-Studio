/** `storySnapshot` - 场景快照（变量快照）侧边栏及其 Dev Mode 启动守卫。 */
export const storySnapshot = {
    empty: "打开一个故事场景以管理其快照。",
    none: "暂无快照。",
    getStarted: "添加一个快照以设置启动值。",
    noVariables: "此场景没有可用变量。",
    add: "添加快照",
    delete: "删除快照",
    defaultName: "快照",
    nameAria: "快照名称",
    value: {
        true: "真",
        false: "假",
    },
    launch: {
        needSnapshot: "从此处启动游戏需要一个快照",
        needSnapshotDetail: "从某一行开始播放需要具体的变量值。请先创建一个场景快照，然后重试。",
        createAction: "创建快照",
    },
} as const;
