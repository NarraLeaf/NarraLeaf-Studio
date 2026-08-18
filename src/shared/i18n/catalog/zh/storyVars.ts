import type { LocaleNamespace } from "../types";

export const storyVars = {
  valueType: {
    boolean: "布尔值",
    number: "数字",
    string: "字符串",
    json: "JSON"
  },
  row: {
    nameAria: "变量名",
    defaultPlaceholder: "默认值",
    defaultAria: "默认值",
    delete: "删除变量"
  },
  scene: {
    title: "场景变量",
    hint: "在故事里用 /local 声明，点击行可跳到声明处"
  },
  saved: {
    title: "存档变量",
    hint: "在工程里定义，值保存在存档文件中"
  },
  // 说明词跟随故事行上的写法：`/global` 声明的就叫「全局变量」，键名保持 persistent 不动
  persistent: {
    title: "全局变量",
    hint: "在工程里定义，应用级，与蓝图共享"
  }
} satisfies LocaleNamespace<"storyVars">;
