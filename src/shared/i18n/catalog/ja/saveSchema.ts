export const saveSchema = {
  title: "セーブ項目",
  open: "セーブ項目",
  type: {
    string: "文字列",
    integer: "整数",
    float: "浮動小数点数",
    boolean: "真偽値",
    json: "JSON",
    array: "配列"
  },
  field: {
    name: "名前",
    type: "型",
    default: "既定値",
    defaultPlaceholder: "既定値",
    add: "項目を追加",
    remove: "項目を削除",
    newName: "項目"
  }
} as const;
