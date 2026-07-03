# Variables 节点

Variables 节点用于声明 blueprint-level 变量、读写当前蓝图可访问变量，以及访问项目级 Persistent 变量。

## Var

`blueprint.local.declareVar` - 声明变量

无输入引脚、无输出引脚。它在除 Blueprint Value (`widgetValue`) 外的所有蓝图 owner 中出现，用于声明当前 blueprint-level 生命周期变量。运行时启动和执行前会扫描当前蓝图内所有 `Var` 节点，将它们作为 `Get Var` / `Set Var` 可访问的变量定义。变量 store 会随对应蓝图 owner/runtime scope 存活，并在多条事件链之间复用，直到该 owner 实例被释放或重新挂载。

- `Name` - 变量名称
- `Data type` - 变量类型
- `Default` - JSON-safe 默认值

当 `Data type` 选择 `Any` 时，`Default` 显示为禁用的单行 `null` 输入框。`Any` Var 必定以 `null` 初始化，不能在声明节点上编辑初始值；需要赋值时使用后续 `Set Var`。

Blueprint Value 不使用 `Var` 节点声明变量。旧版 blueprint-level `members.variables` 不显示在成员栏中，但仍作为兼容 fallback 可被 `Get Var` / `Set Var` 引用。

## Get Var

`blueprint.local.get` - 读取变量

读取当前蓝图可访问的变量。可访问范围按顺序包含当前 Page/Surface、当前 blueprint-level 变量和 Global；同名变量会在下拉项中显示作用域提示。

- `Variable` - 节点参数，选择要读取的变量
- `Value` - 输出变量当前值

`Value` 输出引脚会根据 `Variable` 当前选择的变量类型动态推断。变量类型后续改变时，已有连接不会被自动删除；不兼容连接会由 graph validation 报告类型错误。

## Set Var

`blueprint.local.set` - 写入变量

写入当前蓝图可访问的变量，并继续执行 `next`。写入 Page / Global 变量时会写入对应作用域的运行时 store。

- `Variable` - 节点参数，选择要写入的变量
- `Value` - 输入新值

`Value` 输入引脚会根据 `Variable` 当前选择的变量类型动态推断。变量类型后续改变时，已有连接不会被自动删除；不兼容连接会由 graph validation 报告类型错误。

## Get Persistent

`blueprint.persistent.get` - 读取 Persistent 变量

通过 Host 管理的项目存储异步读取 Persistent 变量；没有已保存值时返回变量定义中的默认值。

- `Persistent` - 节点参数，选择 Persistent 变量
- `Value` - 输出读取结果

## Set Persistent

`blueprint.persistent.set` - 写入 Persistent 变量

通过 Host 管理的项目存储异步写入 Persistent 变量。

- `Persistent` - 节点参数，选择 Persistent 变量
- `Value` - 输入要保存的值
