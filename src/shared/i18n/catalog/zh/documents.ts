/** `documents` - 读取方对一份拒绝读取的工程文件的说明。 */
export const documents = {
    tooNew: {
        message: "{subject} 由更新版本的 NarraLeaf Studio 写入（{kind}格式 v{version}），当前构建最高读到 v{supported}",
        kind: {
            story: "故事",
            storyIndex: "故事库",
            storyAnimation: "动画",
            uiDocument: "页面",
            uiGraphs: "页面蓝图",
            blueprints: "蓝图",
            variables: "变量",
            saveSchema: "存档结构",
            localization: "翻译",
            localizationKeys: "翻译键",
            voice: "配音",
            brand: "设计",
            appTags: "变体",
            dlc: "DLC",
            assetSets: "资产集",
            audioTracks: "音轨",
            characters: "人物",
        },
    },
} as const;
