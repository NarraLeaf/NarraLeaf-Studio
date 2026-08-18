import type { LocaleNamespace } from "../types";

/**
 * `developer` - 开发者选项往右键菜单底部加的那一段。
 *
 * 与 `devMode`（运行游戏的那个窗口）不是一回事，所以中文里叫「开发者选项」而不是「开发模式」。
 */
export const developer = {
  copyId: {
    surface: "复制{label} ID",
    element: "复制元素 ID",
    asset: "复制素材 ID",
    assetGroup: "复制分组 ID",
    character: "复制角色 ID",
    characterGroup: "复制分组 ID",
    story: "复制故事 ID",
    chapter: "复制章节 ID",
    scene: "复制场景 ID",
    storyRow: "复制行 ID"
  },
  copied: "已复制 ID",
  copyFailed: "无法复制 ID"
} satisfies LocaleNamespace<"developer">;
