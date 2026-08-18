export const saveSchema = {
  title: "存档字段",
  open: "存档字段",
  type: {
    string: "字符串",
    integer: "整数",
    float: "浮点数",
    boolean: "布尔值",
    json: "JSON",
    array: "数组"
  },
  field: {
    name: "名称",
    type: "类型",
    default: "默认值",
    defaultPlaceholder: "默认值",
    add: "添加字段",
    remove: "删除字段",
    newName: "字段"
  }
} as const;
