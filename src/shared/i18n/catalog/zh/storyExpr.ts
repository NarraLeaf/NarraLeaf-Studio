export const storyExpr = {
    issue: {
        unexpectedToken: "此处不应出现「{text}」",
        unexpectedEnd: "表达式尚未写完",
        unterminatedString: "引号没有闭合",
        unbalancedParen: "括号没有闭合",
        unknownVariable: "没有名为「{name}」的变量",
        unknownQualifiedVariable: "{scope} 作用域中没有「{name}」",
        unknownScopePrefix: "「{prefix}」不是作用域，可用 scene、saved 或 persis",
        unknownFunction: "没有「{name}」这个函数",
        badArity: "{fn} 需要 {expected} 个参数，而不是 {received} 个",
    },
    check: {
        notBoolean: "条件必须是真假判断，例如 gold >= 100",
        typeMismatch: "这里得到的是 {received}，而变量存放的是 {expected}",
        notConstant: "默认值不能引用其他变量——它在所有变量存在之前就已确定",
        duplicateVariable: "该作用域下已存在同名变量",
        compoundWithoutTarget: "这里没有可供累加的变量",
    },
};
