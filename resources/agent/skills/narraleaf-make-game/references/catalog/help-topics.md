# Studio 内置帮助全文 · In-Studio help topics

> 本文件由 NarraLeaf Studio 源码自动生成，请勿手动修改。
> Generated from the NarraLeaf Studio source. Do not edit by hand.

Studio 里按 F1 或点 `?` 打开的帮助主题全文，按帮助浏览器的分区排列。每个主题先中文后英文。

The full text of the help topics F1 and `?` open inside Studio, in the help browser's sections. Each topic gives Chinese first, then English.

## 上手 · Getting around

### 获取帮助 · Getting help

按 F1 查看当前聚焦的控件或指针所在处的帮助；主题显示在旁边，按 Esc 关闭

对话框、项目面板的分组、蓝图编辑器和版本轨道在指针经过标题时显示问号按钮，点击打开该处的主题；侧边面板不显示问号按钮，在面板中按 F1

- 「相关」跳转到相关主题，标题栏的返回箭头回到上一条
- 本列表包含全部主题，上方的搜索框同时匹配标题与正文
- 命令面板的「帮助」一栏按名称列出全部主题
- 没有对应主题的位置按 F1 打开本列表

Press F1 for help on whatever has focus, or whatever the pointer is over. The topic opens beside it and closes on Escape.

Dialogs, the groups on the Project panel, the blueprint editor and the version rail show a question mark in their header under the pointer. It opens the topic for that place. Side panels show none; press F1 inside the panel instead.

- See also moves to a related topic, and the back arrow in the header returns to the previous one.
- This list holds every topic. The search field above it matches titles and bodies.
- The command palette lists every topic by name under Help.
- Where there is no topic, F1 opens this list.

相关快捷键 · Shortcuts：

- 当前位置的帮助 · Help for What Is Focused：`F1`
- 显示并运行命令 · Show and Run Commands：`⌘⇧P`（macOS）/ `Ctrl+Shift+P`（Windows）

相关主题 · Related：工作区布局 · Workspace layout、键盘与鼠标 · Keyboard and Mouse、查找 · Search

### 工作区布局 · Workspace layout

左侧图标栏切换侧边面板，例如故事、角色、搜索和资产；中间是编辑器标签页，每个打开的对象占一个标签页；右侧面板编辑当前选中的对象

- 面板宽度与开合状态由所有项目共用，打开其他项目时保持不变
- 关闭面板后图标保留在栏中，点击图标重新打开该面板
- 编辑器区域可以拆分为两半，标签页可以拖入其中任意一半

The rail on the left switches the side panel, among them story, characters, search and assets. The middle holds editor tabs, one per open item. The right panel edits the current selection.

- Panel widths and which panels are open are shared by every project, and stay the same when another project is opened.
- Closing a panel keeps its rail icon. Click the icon to reopen the panel.
- The editor area can be split in two, and a tab can be dragged into either half.

相关快捷键 · Shortcuts：

- 向右拆分编辑器 · Split Editor Right：`⌘\`（macOS）/ `Ctrl+\`（Windows）
- 向下拆分编辑器 · Split Editor Down：`⌘⌥\`（macOS）/ `Ctrl+Alt+\`（Windows）
- 平分编辑区 · Split the Editor Area Evenly：双击分隔条 · Double-click the divider
- 切换到下一个编辑器标签 · Switch to Next Editor Tab：`⌃Tab`（macOS）/ `Ctrl+Tab`（Windows）

相关主题 · Related：键盘与鼠标 · Keyboard and Mouse、查找 · Search、撤销 · Undo and redo

### 添加项目 · Adding a project

启动器通过三种方式添加项目：新建项目、导入 .nlspkg 项目包、从服务器克隆

- 新建项目需要模板、项目名称、应用 ID、位置和舞台尺寸；应用 ID 创建后不可更改
- 位置必须是空文件夹；尚不存在的文件夹在创建项目时一并创建
- 从服务器克隆的项目保持与该服务器的连接，本地副本可正常编辑
- 模板「空白」只有项目结构；模板「骨架」是一个可直接运行的短故事，包含三个场景、一次分支选择，以及启动画面、标题、鉴赏、存档、读档、设置、记录七个界面，蓝图均已配置

The launcher adds a project three ways: New project, Import .nlspkg, and Clone from a server.

- A new project needs a template, a project name, an app ID, a location and a stage size. The app ID cannot be changed once the project exists.
- The location must be an empty folder. A folder that does not exist yet is created with the project.
- A project cloned from a server stays connected to it, and the local copy is editable.
- The Empty template holds the project structure only. The Skeleton template is a short story that runs as delivered: three scenes, one choice, and splash, title, extra, save, load, config and backlog screens with their blueprints already wired.

相关主题 · Related：工作区布局 · Workspace layout、与服务器协作 · Working with a server

### 运行游戏 · Running the game

开发模式在 Studio 窗口中打开游戏，附带调试面板：跳转到指定故事行、查看变量、在编辑器内重新加载

预览在独立窗口中按玩家收到的形式运行游戏，不含调试面板

构建产出交付给玩家的文件；开发模式和预览耗时数秒，构建耗时数分钟

- 开发模式的调试菜单可以在故事编辑器中打开正在播放的行
- 运行按钮以上一次选择的模式启动
- 开启资产保护的项目，运行菜单中有「生产预览」；关闭时预览与测试直接运行项目文件，启动约一秒
- 发版前打开它；打开后预览与测试按与交付给玩家的游戏完全相同的方式存放内容，预览窗口标题会标明
- 项目冻结时预览和构建不可用；开发模式仍可运行；查看历史版本时运行的是该版本

Dev Mode opens the game in a Studio window with the debug panels: jump to a story row, inspect variables, reload without leaving the editor.

Preview runs the game in its own window, in the form players receive it, without the debug panels.

Build produces the files delivered to players. Dev Mode and Preview take seconds; a build takes minutes.

- Dev Mode opens the line that is playing in the story editor, from its debug menu.
- Run starts the mode chosen last.
- A project that protects its assets has Preview as shipped in the Run menu. Off, a preview and a test run use the project's files directly and start in about a second.
- Turn it on before a release. A preview and a test run then hold their content exactly as the delivered game does, and the preview window title says so.
- Preview and Build are unavailable while the project is frozen. Dev Mode still runs, and while an old version is open it runs that version.

相关快捷键 · Shortcuts：

- 运行开发模式 · Run Dev Mode：`F5`
- 运行预览 · Run Preview：`F6`
- 停止运行 · Stop the Run：`⇧F5`（macOS）/ `Shift+F5`（Windows）

相关主题 · Related：测试 · Tests、构建 · Builds、冻结的项目 · Frozen projects、从某一行开始播放 · Playing from a row

### 键盘与鼠标 · Keyboard and Mouse

「快捷键与鼠标操作」按编辑器分组，列出 Studio 的全部快捷键与鼠标操作，包括仅在特定编辑器打开时生效的操作；当前编辑器或面板中可用的操作列在最前

- 在搜索框中输入名称、按键或分组即可筛选
- 每条快捷键都可以在设置的快捷键一栏中修改；鼠标操作与少数不在该栏中的按键固定不变
- 修改后的快捷键在快捷键表、菜单和命令面板中同步更新

Shortcuts and Mouse Actions lists every shortcut and mouse action in Studio, grouped by editor, including those that apply only while a particular editor is open. What works in the focused editor or panel is listed first.

- The search box filters the list by name, key or group.
- Every shortcut can be changed in Settings, under Shortcuts. Mouse actions, and the few keys that Settings does not list, are fixed.
- A changed shortcut is updated in the sheet, the menus and the command palette.

相关快捷键 · Shortcuts：

- 显示快捷键与鼠标操作 · Show Shortcuts and Mouse Actions：`⇧?`（macOS）/ `Shift+?`（Windows）
- 显示并运行命令 · Show and Run Commands：`⌘⇧P`（macOS）/ `Ctrl+Shift+P`（Windows）

相关主题 · Related：工作区布局 · Workspace layout、Studio 设置 · Studio settings

### 查找 · Search

搜索面板与标题栏的搜索框检索整个项目：场景、故事、角色、界面、蓝图、资产与变量的名称，以及剧情文本、界面文本、翻译键与蓝图节点；每条结果标明所在位置，选中结果即打开该位置

- 名称匹配排在正文匹配之前
- 界面文本按项目源语言检索，选中后打开所在页面或组件并选中该控件；示例文字在位置后标有「示例文字」
- 搜索面板可以在整个项目中替换剧情文本
- 在搜索面板中撤销，会在上一次替换改过的每个场景中撤销该替换；替换后有改动的场景保留替换，并由通知列出；在场景中撤销只撤销该场景中的替换
- 在搜索框与替换框中，撤销只作用于该框中的文字
- 在标题栏的搜索框中以「>」开头，改为按名称查找命令
- 快速打开按名称打开场景、角色、界面、资产和蓝图

The Search panel and the search box in the title bar search the whole project: the names of scenes, stories, characters, screens, blueprints, assets and variables, and story text, interface text, translation keys and blueprint nodes. Every result states where it is, and selecting one opens that place.

- Name matches rank above matches inside a document.
- Interface text is searched in the project's source language. Selecting it opens the page or component with the widget selected. Sample text is marked Sample text after its place.
- The Search panel can replace story text across the whole project.
- Undo in the Search panel takes back its last replace in every scene that replace changed. A scene edited after the replace keeps it, and a notice names the scene. Undo in a scene takes back the replace in that scene alone.
- In the search and replace boxes, Undo applies to that box's own text.
- In the title bar's search box, a query that starts with > finds commands by name.
- Quick Open opens scenes, characters, screens, assets and blueprints by name.

相关快捷键 · Shortcuts：

- 显示并运行命令 · Show and Run Commands：`⌘⇧P`（macOS）/ `Ctrl+Shift+P`（Windows）
- 快速打开 · Quick Open：`⌘P`（macOS）/ `Ctrl+P`（Windows）
- 查找和替换 · Find and replace：`⌘F`（macOS）/ `Ctrl+F`（Windows）
- 撤销替换 · Undo Replace：`⌘Z`（macOS）/ `Ctrl+Z`（Windows）
- 重做替换 · Redo Replace：`⌘⇧Z`（macOS）/ `Ctrl+Shift+Z`（Windows）

相关主题 · Related：场景与行 · Scenes and rows

### 撤销 · Undo and redo

撤销最近一次改动。焦点位于某个编辑器时由该编辑器执行，否则由工作区执行

- 每个编辑器各自维护撤销步骤，切换标签页不会合并它们
- 编辑菜单中也有撤销和重做
- 撤销的范围是项目内部的改动；写入磁盘的文件、构建产物和已提交的版本不在范围内
- 已关闭的标签页可以重新打开

Undo reverses the last change, in the editor that made it. The editor with focus performs it. With focus outside every editor, the workspace performs it.

- Each editor keeps its own steps, so switching tabs does not merge them.
- Undo and redo are also in the Edit menu.
- Undo covers changes inside the project. Files written to disk, build output and submitted versions are outside its range.
- A closed tab can be reopened.

相关快捷键 · Shortcuts：

- 撤销 · Undo：`⌘Z`（macOS）/ `Ctrl+Z`（Windows）
- 重做 · Redo：`⌘⇧Z`（macOS）/ `Ctrl+Shift+Z`（Windows）
- 重新打开关闭的标签 · Reopen Closed Tab：`⌘⇧T`（macOS）/ `Ctrl+Shift+T`（Windows）

相关主题 · Related：工作区布局 · Workspace layout、版本控制 · Version control

### Studio 设置 · Studio settings

设置属于本机的 Studio，不属于某个项目；打开其他项目时设置不变，把项目交给他人时设置不随之传递

- 界面语言、主题、编辑器文字和全部快捷键都在这里设置
- 还原将单项或全部设置恢复为默认值
- 缓存文件可以列出并清除，清除的部分在下次需要时重新生成
- 设置可以导出为文件，并在其他设备上导入

Settings belong to Studio on this machine, not to a project. Opening another project leaves them unchanged, and a project given to someone else does not carry them.

- Language, theme, editor text and every shortcut are set here.
- Reset returns one setting, or all of them, to its default value.
- Cached files can be listed and cleared. Cleared files are rebuilt when they are next needed.
- Settings can be exported to a file and imported on another machine.

相关主题 · Related：键盘与鼠标 · Keyboard and Mouse、插件 · Plugins

## 故事 · Story

### 场景与行 · Scenes and rows

场景是一串行；一行是一句对白、一段旁白，或者一条指令

输入文字即写入对白，在行首输入斜杠改为选择指令

- 右侧面板编辑当前选中的行
- F2 或行菜单中的「以文本形式编辑」将指令行展开为指令文本，光标位于行末；Enter 按新输入的行提交，Esc 保持原行不变
- 行支持键盘移动、复制、缩进和删除
- 在空行上，经输入法确认的「・」「／」「＃」会变为 / 或 #，紧接着按 Esc 恢复原字符
- 实时预览显示选中行处的舞台；点击预览选中游戏下一处等待玩家的行，即一句对白、一段旁白或一个菜单；在菜单上点击某个选项，选中该选项下的第一句
- 实时预览中的句子仍在逐字显示时，点击先显示整句；在实时预览顶部开启「跳过打字动画」后，每句直接完整显示
- 画中画模式下，实时预览在其他编辑器上方保持显示，显示最近使用的场景编辑器中的场景
- 对游戏 UI 的修改随即显示在实时预览中
- 实时预览顶部切换到「图层」，显示本场景的图层：左侧列表从前到后排列，距离相同的图层合为一个层级。距离以基准图层为 1（未指定图层的内容都在基准图层上），数值越大越远，镜头移动时位移越小，∞ 时保持不动；点击层级的数值可直接输入。拖动一行可并入其他层级，或放在两个层级之间成为新的层级；拖动图层上的名称可调整距离，靠近其他层级时并入该层级；右下角的小画面演示镜头移动时的效果。场景标题栏的「图层」按钮也会打开这一视图；用 /layer 名称 可直接为本场景添加图层
- 「图层」视图右下角的小画面在鼠标移上去时放大，镜头跟随鼠标移动、滚轮推拉，鼠标移开后复位；选中设置镜头位置的镜头行时，它以该行的镜头为准
- 行上的 ▶（从这一行开始播放）在开发模式中从该行开始运行场景

A scene is a list of rows. A row is one line of dialogue, one piece of narration, or one command.

Typing writes a line. Typing a slash at the start of a row selects a command instead.

- The right panel edits the selected row.
- F2, or Edit as text in a row's menu, opens a command row as its command line with the caret at the end. Enter commits the line as a newly typed one; Escape leaves the row unchanged.
- Rows can be moved, duplicated, indented and deleted from the keyboard.
- On an empty row, a ・, ／ or ＃ confirmed from an input method becomes / or #. Escape straight after restores the character.
- The live preview shows the stage at the selected row. Clicking it selects the next row the game waits at: a line or a menu. On a menu, clicking an option selects the first line of that option.
- A click on a line the live preview is still typing shows the whole line first. With Skip typing animation turned on at the top of the live preview, every line appears in full at once.
- In picture-in-picture, the live preview stays on screen over the other editors and shows the scene of the scene editor used last.
- Edits to the Game UI appear in the live preview as they are made.
- Layers, at the top of the live preview, shows the scene's layers. The list on the left runs front to back, and layers at the same distance form one level. Distance is measured from the base layer, which holds everything not placed on another layer and is at 1: larger values are farther away and move less with the camera, and at ∞ a layer stays still. Click a level's value to type a distance. Drag a row onto another level to join it, or between two levels to make a new one; drag the name on a layer to change its distance, and close to another level it joins that level. The small view in the corner shows the camera moving. The Layers button in the scene's title bar opens the same view, and /layer name adds a layer to the scene.
- The small view in the corner of Layers grows while the pointer is on it: the camera follows the pointer, scrolling zooms, and it settles back when the pointer leaves. With a camera row that sets the camera's position selected, it starts from that row's shot.
- The ▶ on a row, Play from this row, runs the scene in Dev Mode starting at that row.

相关快捷键 · Shortcuts：

- 编辑当前行（或打开其检查器） · Edit the active row (or open its inspector)：`Enter`
- 以文本形式编辑当前行 · Edit the active row as text：`F2`
- 提交并新建同类行 · Commit and Continue With the Same Kind of Row：Enter
- 在当前行下方插入新的故事行 · Insert a new story row below the active row：`⇧Enter`（macOS）/ `Shift+Enter`（Windows）
- 选择连续多行 · Select a Range of Rows：Shift+单击行 · Shift+Click a row；在多行上拖动 · Drag across rows
- 创建选中故事行的副本 · Duplicate selected story rows：`⌘D`（macOS）/ `Ctrl+D`（Windows）
- 将选中的故事行下移 · Move the selected story rows down：`⌥↓`（macOS）/ `Alt+↓`（Windows）

相关主题 · Related：指令 · Commands、变量 · Variables、分支与路线 · Branches and routes

### 指令 · Commands

指令是不包含对白的行：切换背景、移动角色、播放声音、赋值、分支

编辑器旁的动作面板是完整清单，列出每条指令接受的值和可用示例

- 面板中的指令写法与输入写法一致；编辑器为中文时中文写法可解析，英文写法始终有效
- 指令旁的星标将其加入收藏；收藏的指令列于「/」菜单最前
- 可在面板的指令页为指令设置缩写；输入缩写后按空格即替换为该指令，行中不会保留缩写
- 必填值不完整的行无法提交

Commands are the rows that are not speech: show a background, move a character, play a sound, set a variable, branch.

The Actions panel beside the editor lists every command, the values each one accepts, and a working example.

- The panel spells commands the way they are typed. With the editor in Chinese the Chinese spellings parse, and the English spellings remain valid.
- The star beside a command adds it to Starred. Starred commands are listed first in the “/” menu.
- Abbreviations of your own are set on a command's page in the panel. An abbreviation followed by a space is replaced with the command, so rows never contain it.
- A row with a required value missing cannot be committed.

相关主题 · Related：场景与行 · Scenes and rows、变量 · Variables、表达式 · Expressions

### 变量 · Variables

三种作用域，区别在于值保留多久：

- 场景变量：属于单个场景，每次进入该场景时回到默认值；保存在存档中
- 存档变量：属于一个存档，开始新游戏时回到默认值
- 持久变量：不属于任何存档，跨存档与重新启动保留；蓝图也可以读写

场景变量在它所属的场景里声明，与其他行一样占一行；存档变量和持久变量在变量面板中为整个项目声明一次，之后任何场景、任何蓝图都能使用。两者的取值都必须可写入存档

Three scopes, differing in how long a value is kept:

- Scene: belongs to one scene, and returns to its default each time the scene is entered. It is stored in the save.
- Saved: belongs to one save, and returns to its default when a new game starts.
- Persistent: belongs to no save, and is kept across saves and restarts. Blueprints read and write it too.

A scene variable is declared in the scene it belongs to, as a row like any other. Saved and persistent variables are declared once for the whole project, in the Variables panel, and any scene and any blueprint can then use them. Both must hold a value that can be written to a save.

相关主题 · Related：指令 · Commands、表达式 · Expressions、从某一行开始播放 · Playing from a row

### 表达式 · Expressions

指令接受值的位置同样接受表达式：比较、算术、函数调用；输入过程中行内标出错误位置，表达式无法解析时不能提交

- 单独的名称表示作用域内的变量；在名称前加 scene.、saved. 或 persistent. 指定作用域
- visited 判断某个场景是否到达过，picked 判断某个选项是否被选过
- 条件必须是结果为真或假的判断

Wherever a command takes a value, it also takes an expression: a comparison, an arithmetic operation, a call. The row marks what is wrong as it is typed, and a row whose expression does not parse cannot be committed.

- A bare name is a variable in scope. Prefix it with scene., saved. or persistent. to choose the scope.
- visited reports whether a scene has been reached, and picked whether a choice option has been chosen.
- A condition must be a test that evaluates to true or false.

相关主题 · Related：变量 · Variables、指令 · Commands

### 分支与路线 · Branches and routes

流程视图解析场景，绘制故事可以经过的路径：每个选项通向哪里、哪些场景只能经分支到达、路径在哪里终止

- 路径终止不一定是结局，也可能是分支尚未续写，或者回到了已经经过的场景

The flow view reads the scenes and draws the paths the story can take: which choice leads where, which scenes are reachable only through a branch, and where a path ends.

- A path that ends is not always an ending. It can be a branch with nothing written after it, or a return to a scene already visited.

相关主题 · Related：场景与行 · Scenes and rows、项目检查 · Project checks

### 在 Studio 之外编辑 · Editing outside Studio

场景可以导出为文本文件，在外部编辑后再导入

两种格式：往返格式包含场景数据，可以再次导入；审阅格式只包含正文，用于阅读和比对

- 导入前会列出将要新增、修改和删除的每一行
- 导出之后又在 Studio 中修改过的场景，导入时这些修改会被覆盖，导入前会先说明

A scene can be exported as a text file, edited elsewhere, and imported again.

Two formats: round-trip carries the scene data and can be imported back; review carries prose only, for reading and comparing.

- The import lists every row it will add, change or remove before writing anything.
- A scene edited in Studio after the export loses those edits on import, and the import states this first.

相关主题 · Related：场景与行 · Scenes and rows、粘贴为行 · Paste as Rows、语言 · Languages

### 粘贴为行 · Paste as Rows

在故事编辑器中一次粘贴多行文字时，先打开「粘贴为行」：按识别出的分隔方式把每一行拆成说话人与正文，并预览将要插入的行

- 识别有误时在上方改选分隔方式，或选择「自定义」填写正则表达式；分隔方式可以命名保存，供之后的粘贴选用
- 每个识别出的名字对应四种结果之一：已有角色、新建角色、仅名称、不是说话人。仅名称的行只带该名字，不关联角色；不是说话人的行原样作为旁白
- 改选过的名字对应保存在本项目中，之后粘贴同一名字时自动沿用；未改选的名字每次重新识别
- 确认后这些行插入到当前行下方，计为一次撤销操作

Pasting several lines into the story editor opens Paste as Rows first. It splits each line into a speaker and its text by the separator it recognised, and previews the rows it will insert.

- When the guess is wrong, pick another separator above, or Custom to write a regular expression. A separator can be named and saved for later pastes.
- Each name found maps to one of four answers: an existing character, New character, Name only, or Not a speaker. A Name only row carries the name and no character. A Not a speaker line becomes narration exactly as pasted.
- An answer changed for a name is remembered by the project and used again the next time that name is pasted. A name left as recognised is recognised again.
- Confirming adds the rows below the current line as one undo step.

相关快捷键 · Shortcuts：

- 粘贴时不打开「粘贴为行」 · Paste Without Paste as Rows：Ctrl+Shift+V

相关主题 · Related：场景与行 · Scenes and rows、角色 · Characters、在 Studio 之外编辑 · Editing outside Studio

### 从某一行开始播放 · Playing from a row

开发模式可以从当前行开始播放，而不是从场景开头；该行之前的内容不会运行，其中本应设置的变量取本项目为它们声明的值

- 一份快照属于一个场景，为该场景作用域内的每个变量提供起始值
- 快照是可选的；快照列表的第一项是「默认值」，表示不应用任何快照
- 从某一行开始播放使用「场景快照」面板中选中的那一项
- 快照不影响成品游戏的运行

Dev Mode can start at the current row instead of at the beginning of the scene. Nothing before that row runs, and the variables it would have set hold the values the project declares for them.

- A snapshot belongs to one scene and gives every variable in its scope a starting value.
- A snapshot is optional. The snapshot list starts with Defaults, which applies none.
- A row start uses the entry selected in the Scene Snapshots panel.
- Snapshots do not affect the finished game.

相关主题 · Related：变量 · Variables、运行游戏 · Running the game

### 场景历史与单行历史 · Scene history and line history

「场景历史」面板列出当前场景的内容快照；快照保存在本机，不进入版本控制，也不随游戏发布

- 自动快照：编辑期间按设置中的间隔，为有改动的场景各保存一份
- 手动快照：点击「保存快照」立即保存当前内容，不会被自动清理
- 较早的自动快照每天保留一份，保留两周
- 「与当前对比」列出修改、新增与删除的行
- 「恢复此快照」先为当前内容保存一份快照，再替换场景中的行；可撤销

在故事行的右键菜单中选择「查看此行历史」，可查看该行在各快照中的不同版本

- 删除线为该版本独有的文字，高亮为当前版本独有的文字
- 可同时检索最近的版本控制提交
- 「恢复此版本」只改动该行，可撤销

The Scene History panel lists content snapshots of the current scene. Snapshots are kept on this computer, outside version control, and are not part of the finished game.

- Automatic snapshots: while editing, one per changed scene at the interval set in Settings.
- Manual snapshots: Save snapshot keeps the current content now. They are never removed automatically.
- Older automatic snapshots are thinned to one a day and kept for two weeks.
- Compare with current lists changed, added and removed lines.
- Restore this snapshot first snapshots the current content, then replaces the lines in the scene. Undo reverts it.

View line history in a story line's context menu shows the versions that line had in each snapshot.

- Struck-through text exists only in that version; highlighted text exists only in the current one.
- Recent version-control revisions can be searched as well.
- Restore this version changes that line only. Undo reverts it.

相关主题 · Related：场景与行 · Scenes and rows、Studio 设置 · Studio settings

### 项目词典 · Project dictionary

词典收录本项目有意使用的词：人名、地名、自造词。它属于项目，打开该项目的每个人用到的是同一份

一条词条由词条本身和三个可留空的字段组成：

- 读音：为该词条标注的注音
- 异体写法：与该词条同义、但不是本项目写法的拼写
- 备注：该词条是什么，供之后阅读列表的人参考

在词典面板中添加词条，也可以在故事行中添加：选中文字后选择「加入词典」，或右键点击被标记的词

The dictionary holds the words this project writes on purpose: character names, place names, invented vocabulary. It is part of the project and is available to everyone who opens it.

An entry is a term, and three fields that may be left empty:

- Reading: the ruby the term is annotated with.
- Variant spellings: spellings that mean the term but are not how this project writes it.
- Note: what the term is, for whoever reads the list later.

A term is added in the dictionary panel, or from a story row: select the words and choose Add to dictionary, or right-click a marked word.

相关主题 · Related：词典标记 · Dictionary marks、拼写 · Spelling、场景与行 · Scenes and rows

### 词典标记 · Dictionary marks

检查原文拼写时，词典中的每一种拼写都会被接受，词条与异体写法一样

正在编辑的行中还会出现词典自己的两种标记。两者在词典面板底部开关，作用于整个项目

- 琥珀色波浪线标出异体写法。右键点击将其改写为该词条
- 点线标出词典中记有读音、而该处没有注音的词条。右键点击应用该读音

「检查项目」读取每一个故事，查找异体写法，并把每一处列在所属词条下；选中一处即打开对应的行。读音不在检查范围内：记有读音的词条在其出现的每一处都会被列出

Every spelling in the dictionary is accepted when the source text is checked, terms and variant spellings alike.

Two marks of its own appear in the row being edited. Both are switched on and off for the whole project at the foot of the dictionary panel.

- An amber wave marks a variant spelling. Right-clicking it writes the term instead.
- A dotted line marks a term the dictionary holds a reading for, where the row carries no ruby. Right-clicking it applies the reading.

Check project reads every story for variant spellings and lists each place under the term it belongs to. Selecting one opens that row. Readings are left out of it: a term with a reading occurs wherever it appears.

相关主题 · Related：项目词典 · Project dictionary、拼写 · Spelling、项目检查 · Project checks

### 故事动效 · Story Motion

故事动效是一段可复用的移动：角色滑入、图片淡出、镜头推向舞台；定义一次后可用于任意行

- 预设库按用途分组收录现成的动效；选用一条会在项目中生成副本，副本可以继续修改
- 动效只描述移动方式，不指定对象；对象由使用它的那一行指定
- 每条动效对应一种对象（角色、图像、文本、图层或镜头），只在移动该类对象的行中可选
- 在底部面板中双击动效即可打开编辑器；名称、重复次数与预览图片在检查器中设置
- 预览按游戏实际绘制的尺寸显示，预览中的节奏与运行时一致

A motion is a reusable movement: a character sliding in, a picture fading, the camera pushing in on the stage. It is defined once and can be used on any row.

- The library groups ready-made motions by purpose. Choosing one copies it into the project, and the copy can be edited.
- A motion describes how something moves, not what moves. The row names the target.
- Each motion is made for one kind of object (character, image, text, layer or camera) and is offered only on rows that move that kind.
- In the bottom panel, double-click a motion to open its editor. Its name, repeats and preview pictures are set in the inspector.
- The preview is drawn at the size the game draws, so its timing matches playback.

相关快捷键 · Shortcuts：

- 播放 / 暂停 · Play or Pause：`Space`
- 跳到上一个关键帧 · Go to Previous Keyframe：`↑`
- 跳到下一个关键帧 · Go to Next Keyframe：`↓`
- 在播放头处添加关键帧 · Add Keyframes at Playhead：`I`
- 框选关键帧 · Select Keyframes in a Box：在轨道上拖动 · Drag across the tracks
- 删除选中的关键帧 · Delete Selected Keyframes：`Delete`
- 拖动时不吸附 · Drag Without Snapping：Alt+拖动 · Alt+Drag

相关主题 · Related：指令 · Commands、角色 · Characters

### 舞台时间轴 · Stage timeline

舞台时间轴按执行顺序列出当前场景中每一行执行后的舞台：每个对象一条轨道，每一行一列；标尺只标出对白与旁白的行号

- 轨道包括背景、角色、图片与文本、环境效果、镜头、音乐与音效；从未出现的对象不显示
- 色块表示对象在场，换表情或换图片时另起一块；名称不变的修改在被修改的对象上以菱形标出，例如移动或缩放
- 单击任意一列，编辑器与预览即跳转到该行；面板拉宽或拉高时，列与轨道随之铺满
- 每句对白占据的宽度足以完整显示该句文字，只操作舞台的行宽度固定；顶部的滑块可缩放时间轴，「显示完整行号」按钮在标尺上标出每一行的行号
- 遇到选项时默认沿第一个选项继续；单击标尺上的分支按钮可改选；光标位于某个选项内时，时间轴沿该选项展开
- 条件按预览的方式求值；跳转、结局与退出之后的行不显示
- 按住 Ctrl 或 Command 滚动滚轮可缩放时间轴

The stage timeline lists the stage after every row of the current scene, in the order the rows run: one lane per object, one column per row. The ruler numbers only the rows of dialogue and narration.

- Lanes cover the background, characters, images and text, ambience effects, the camera, music and sounds. Objects that never appear are not shown.
- A bar means the object is on stage, and a new expression or picture starts a new block. A change that keeps the name, such as a move or a zoom, shows as a diamond on the object it changes.
- Clicking a column moves the editor and the preview to that row. Columns and lanes stretch to fill the panel when it is made wider or taller.
- Each line is as wide as its words, and a row that only acts on the stage keeps a narrow width. The slider at the top zooms the timeline, and Show all row numbers numbers every row on the ruler.
- At a menu the timeline follows the first option. The branch button on the ruler picks another. With the cursor inside an option, the timeline follows that option.
- Conditions are evaluated the way the preview evaluates them. Rows after a jump, an ending or a quit are not shown.
- Hold Ctrl or Command and scroll to zoom the timeline.

相关主题 · Related：场景与行 · Scenes and rows、配音 · Voice-over、故事动效 · Story Motion

## 内容 · Content

### 资产 · Assets

游戏加载的全部内容都是资产：图片、音频与视频、数据文件、字体、模型；Studio 按这些分类归置资产，分类内可自建分组

- 把文件夹拖到面板上，其中受支持的文件会一并导入
- 替换资产的文件后，原有引用全部保留
- 删除仍在使用的资产前，会先列出它的使用位置
- 在底部面板中，左侧的树用于打开分组；导入与新建分组作用于内容上方所示的分组；双击分组即可打开

Everything the game loads is an asset: images, audio and video, data files, fonts and models. Studio sorts them into those categories, and groups can be created inside a category.

- Drop a folder onto the panel to import every supported file in it.
- Replacing an asset's file keeps every reference to it.
- Deleting an asset that is still in use lists its usages first.
- In the bottom panel, the tree on the left opens a folder, and Import and New Group add to the folder named above its contents. Double-click a folder to open it.

相关快捷键 · Shortcuts：

- 重命名选中的资产或分组 · Rename selected asset or group：`F2`
- 复制选中的资产 · Copy selected assets：`⌘C`（macOS）/ `Ctrl+C`（Windows）
- 粘贴资产 · Paste assets：`⌘V`（macOS）/ `Ctrl+V`（Windows）
- 选择连续多个资产 · Select a Range of Assets：Shift+单击资产 · Shift+Click an asset
- 返回上级分组 · Back to parent group：Backspace；Alt+↑

相关主题 · Related：资产的来源 · Where an asset's file comes from、资产集 · Asset sets、角色 · Characters、音频轨道 · Audio tracks、项目检查 · Project checks

### 资产的来源 · Where an asset's file comes from

资产保存的是文件的一份副本，随项目一起纳入版本控制；副本有两种取得方式

- 从本机的文件导入：该文件留在原处，Studio 不跟踪它；它变化后用「替换文件」重新导入
- 从网址下载：资产会记下网址与取回时间，「检查更新」向服务器确认该副本是否仍然一致

构建与重新克隆项目用的都是保存下来的副本，既不需要原来的文件，也不需要联网

An asset holds its own copy of a file. The copy is stored in the project and versioned with it, and it was taken in one of two ways.

- Imported from a file on this machine. The file stays where it is, and Studio does not track it. Replace File imports it again after it changes.
- Downloaded from an address. The asset records the address and the time of the download, and Check for Updates asks the server whether the copy still matches.

A build and a fresh clone of the project use the stored copy. Neither needs the file it came from, and neither needs a network connection.

相关主题 · Related：资产 · Assets、转换无法播放的文件 · Converting unplayable files、改动内容 · Changes since the last version

### 资产集 · Asset sets

资产集是资产库里的一个条目，代表一组随语言或构建变体变化的文件。字段可以填写该条目而不是某个文件，游戏使用与之相符的文件

资产集留在建立它的文件夹内，其成员在集合内部列出，不再与其它文件并列

- 选中两个及以上同一类型的文件，选择「用所选文件新建资产集」。文件夹菜单里的「新建资产集」则在对话框中逐个挑选文件
- 对话框先问按什么变化，再问每个取值使用哪个文件
- 在「取值」清单中为某一项选择文件，该文件即成为集合的成员
- 「解散资产集」只移除集合，文件留在集合原先所在的位置；「删除」连同集合内的文件一并删除。两者都会先列出引用该集合的位置
- 故事行、角色外观与对白头像、界面中的图片、背景与视频，以及蓝图中的图片与声音字段都接受资产集，其选择器中有「资产集」一节；字体字段只接受文件

An asset set is one library entry standing for several files that differ by language or by build variant. A field can name the set instead of a file, and the game uses the file that matches.

A set stays in the folder it was created in, and its files are listed inside it rather than beside the other files.

- Select two or more files of one type and choose New Set from Selection. In a folder's menu, New Asset Set starts one from files chosen in the dialog.
- The dialog asks what the set varies by, then which file each value uses.
- Choosing a file for a value in the Values list adds that file to the set.
- Dissolve Set removes the set and leaves its files in the folder it stood in. Delete removes the set and the files in it. Both first list the places that reference the set.
- Story rows, character appearances and dialog avatars, images, backgrounds and videos in the interface, and image and sound fields in blueprints accept a set, and their pickers list sets under Asset sets. Font fields accept a file.

相关主题 · Related：资产集按什么变化 · What a set varies by、资产 · Assets、语言 · Languages

### 资产集按什么变化 · What a set varies by

资产集按下列两者之一变化，在建立时选定：

- 语言：全部文件都在安装包内，游戏按当前语言使用对应的文件
- 变体：构建使用正在构建的变体对应的文件，其余文件不进入安装包

其中一个取值是兜底取值，也是唯一必须有文件的取值。没有自己文件的取值使用兜底取值的文件；项目为某个语言指定了回退语言时，先使用回退语言的文件

需要同时按两者变化时，在某个取值下再建一个资产集：选中相应文件，右键该取值，选择「用所选文件在此新建资产集」

没有文件的取值，以及对应到多个文件的取值，都由项目检查报出。各变体在「变体」页声明自己对应哪个取值；正在构建的变体没有声明时，构建会中止

A set varies by one of two things, chosen when it is created:

- Language: every file is in the package, and the game uses the file for the language it is running in.
- Variant: the build uses the file for the variant being built, and the other files are left out of the package.

One value is the fallback, and it is the only value that requires a file. A value with no file of its own uses the fallback's file. A language that has a fallback language uses that language's file first.

To vary by both, make a second set under one value: select its files, right-click the value, and choose New Set from Selection, Here.

The project check reports a value with no file, and a value that more than one file matches. Under Build variants, each variant states which value it takes, and a build stops while the variant being built states none.

相关主题 · Related：资产集 · Asset sets、变体 · Build variants、变体构建的内容 · Variant build contents

### 转换无法播放的文件 · Converting unplayable files

部分音频和视频文件无法在游戏中播放；导入这类文件时，Studio 会提供转换，并说明转换的影响

- 转换向项目写入新文件，所选的源文件不会被修改
- 部分文件转换后画面和声音与原文件完全一致
- 其余文件必须重新编码，耗时更长，质量有损失
- 不含可播放内容的文件会被跳过，并列出原因

已经在项目中的这类文件会在资产面板上标记，通过该标记可以就地执行同样的转换；文件名保留，原有引用继续有效

项目中存在这类文件时构建会中止，并在控制台列出它们

Some audio and video files cannot play in a game. When one is imported, Studio offers to convert it and states the effect of the conversion.

- Converting writes a new file into the project. The source file is not modified.
- Some files convert with picture and sound identical to the original.
- Others must be re-encoded, which takes longer and loses some quality.
- A file with no playable content is skipped and listed with the reason.

Files already in the project are marked in the asset browser, and the mark starts the same conversion in place. The file keeps its name, and every reference to it remains valid.

A build stops while any such file remains in the project, and lists them in the console.

相关主题 · Related：资产 · Assets、减小下载体积 · Reducing download size

### 角色 · Characters

角色包含名称、颜色和一组外观；外观是角色在舞台上的形象，故事行按名称在外观之间切换

- 对白旁的头像由立绘生成；由运行时绘制的角色显示角色属性中的「默认对白头像」
- 角色不在舞台上时也可以发言

A character has a name, a color and a set of appearances. An appearance is the character's form on stage, and story rows switch between appearances by name.

- The portrait beside dialogue is generated from a sprite. A character drawn by a runtime shows the Default dialog avatar from its properties.
- A character can speak without being on stage.

相关主题 · Related：角色外观 · Character appearances、资产 · Assets、场景与行 · Scenes and rows

### 角色外观 · Character appearances

角色有三种绘制方式，在新建角色时选择，之后不可更改

- 成品立绘：每个姿态一张完整图片
- 分层立绘：图层由差分轴上的标签控制开关，服装与表情可以独立变化
- 由运行时绘制：Live2D Cubism、Spine 或自定义运行时绘制的模型，运行时安装在本项目中。故事行用「动作」「外观」「皮肤」「参数」设置模型的状态；「动作」循环播放，直到另一行更改，不能设为只播放一次

成品立绘与分层立绘的对白头像由绘制结果生成，默认随每条差分轴变化，在轴上关闭「头像随此轴变化」后不随该轴变化；没有差分给出头像时，对白显示角色属性中的「默认对白头像」

由运行时绘制的角色不生成对白头像，对白显示「默认对白头像」；未设置时不显示头像

A character is drawn one of three ways, chosen when the character is created. It cannot be changed afterwards.

- Preset sprites: one finished image per pose.
- Layered sprite: layers switched by tags on axes, so a costume and an expression change independently.
- Drawn by a runtime: a model drawn by Live2D Cubism, Spine or a custom runtime installed in this project. Story rows set its state with Motion, Appearance, Skin and Parameter; a motion loops until another row changes it and cannot be set to play once.

For preset and layered sprites, the dialog avatar is generated from the drawn result and by default changes with every axis; an axis with Avatar varies with this axis switched off leaves it unchanged. Where no differential gives one, dialogue shows the Default dialog avatar from the character's properties.

A character drawn by a runtime has no generated avatar. Dialogue shows its Default dialog avatar, or none when it is not set.

相关主题 · Related：角色 · Characters、模型运行时 · Model runtimes、资产 · Assets

### 模型运行时 · Model runtimes

模型由运行时绘制，Studio 不附带任何运行时；项目各自安装所需的运行时，每种安装一次

- Studio 不会代为下载运行时；运行时从供应方获取，其条款也在供应方处接受
- Live2D 和 Spine 由各自的公司授权；安装开始前会展示条款，条款同样适用于发行的游戏
- 运行时被移除后，角色保留运行时名称并绘制为空框，直到重新安装

A model is drawn by a runtime, and Studio includes none. Each project installs the runtimes it needs, once each.

- Studio does not download runtimes. A runtime comes from its vendor, and its terms are accepted there.
- Live2D and Spine are licensed by their own companies. Their terms are shown before the install starts, and they apply to the shipped game.
- After a runtime is removed, a character keeps the runtime's name and draws an empty box until it is installed again.

相关主题 · Related：角色外观 · Character appearances、资产 · Assets

### 音频轨道 · Audio tracks

轨道汇入上层轨道或主输出。调低一条轨道会同时降低其下全部音量

- 音频的实际音量为自身电平乘以上层各轨道的音量；轨道只降低音量
- 重命名轨道不影响播放，故事行不按名称引用轨道

A track is a volume group. It feeds the track above it or the main output, so lowering one track lowers everything under it.

- A clip plays at its own level multiplied by every track above it. Tracks only lower volume.
- Renaming a track does not affect playback. Story rows do not reference a track by name.

相关主题 · Related：资产 · Assets、裁剪与循环 · Trimming and looping a clip

### 裁剪与循环 · Trimming and looping a clip

打开音频资产会显示波形，可以为这段音频设置三个标记：入点、循环点、出点

- 设置循环点后，开头播放一次，循环点之后的部分循环播放
- 标记属于该资产，所有播放它的行都使用同一组标记
- 波形下方的循环接缝并排显示循环的结尾与它返回的位置；左右拖动任一半即移动对应的标记，「试听接缝」播放接缝前后各几秒
- 电平列出峰值、响度、首尾静音与削波
- 增益降低该音频在游戏中各处的音量；「对齐响度」按测得的响度设置增益，使所有已对齐的音频响度一致；音量只能调低
- 「清除全部标记」使音频重新整段播放、整段循环
- 按住 Option（Alt）滚动滚轮可纵向放大波形，只改变显示
- 播放、移动、设置标记和缩放都有对应的键盘操作

Opening an audio asset shows its waveform, where three marks can be set: the in point, the loop point and the out point.

- With a loop point set, the opening plays once and the part after it repeats.
- The marks belong to the asset, so every row that plays it uses them.
- Under the waveform, the loop seam shows the end of the loop beside the point it returns to. Dragging either half sideways moves that mark. Audition seam plays a few seconds either side of it.
- Levels lists the peak, the loudness, the silence at each end and any clipping.
- Gain lowers the clip's volume wherever the game plays it. Align loudness sets it from the measured loudness, so every aligned clip plays at the same level. A clip cannot be made louder.
- Clear all markers plays and loops the whole file again.
- Scrolling with Option (Alt) held magnifies the waveform vertically. Only the display changes.
- Playback, movement, marking and zooming all have keyboard actions.

相关快捷键 · Shortcuts：

- 播放 / 暂停 · Play or pause：`Space`
- 试听循环接缝 · Audition loop seam：`⇧Space`（macOS）/ `Shift+Space`（Windows）
- 设置入点 · Set in point：`I`
- 设置循环点 · Set loop point：`L`
- 设置出点 · Set out point：`O`
- 清除全部标记 · Clear all markers：`⌘⇧Backspace`（macOS）/ `Ctrl+Shift+Backspace`（Windows）
- 在时间方向缩放波形 · Zoom the Waveform in Time：Ctrl+滚动滚轮 · Ctrl+Scroll

相关主题 · Related：音频轨道 · Audio tracks、资产 · Assets

### 查看视频 · Inspecting a video

打开视频资产会显示画面、帧缩略图时间线，视频带声音时还会显示波形；这里的操作不改动文件

- 在时间标尺上拖动可逐帧浏览；在标尺下方拖动选择一段区间，开启循环时播放会重复该区间
- 方向键每次移动一帧；当前帧号与帧率显示在状态栏
- 「预览循环接缝」播放结尾两秒并接着播放开头两秒，与循环视频在游戏中衔接的方式相同
- 缩放菜单设置画面大小；按住 Command（Ctrl）滚动滚轮以指针为中心缩放，双击在适应窗口与实际像素之间切换
- 带透明像素的视频显示在棋盘格背景上
- 「将当前帧存为图片」把画面中的这一帧按视频原始分辨率加入图片资产，可用作封面或静止画面

Opening a video asset shows the picture, a timeline of its frames and, when the clip has sound, its waveform. Nothing here changes the file.

- Dragging along the ruler scrubs through the clip. Dragging below it selects a range, and play repeats the range while Loop is on.
- The arrow keys step one frame at a time. The frame number and frame rate are in the status bar.
- Preview loop seam plays the last two seconds and carries on into the first two, the way a looping clip turns around in the game.
- The zoom menu sets the picture's size. Scrolling with Command (Ctrl) held zooms at the pointer, and double-clicking switches between the fitted view and actual pixels.
- A clip with transparent pixels is shown over a checkerboard.
- Save frame as image adds the frame on screen to the image assets at the clip's own resolution, for use as a poster or a still.

相关快捷键 · Shortcuts：

- 播放 / 暂停 · Play or pause：`Space`
- 上一帧 · Previous frame：`←`
- 下一帧 · Next frame：`→`
- 切换循环 · Toggle loop：`R`
- 预览循环接缝 · Preview loop seam：`⇧Space`（macOS）/ `Shift+Space`（Windows）
- 缩放画面 · Zoom the Picture：Ctrl+滚动滚轮 · Ctrl+Scroll

相关主题 · Related：资产 · Assets、裁剪与循环 · Trimming and looping a clip

### 配音 · Voice-over

一种配音语言为每句旁白与对白各配一段音频；面板列出全部配音语言及各自的覆盖率，打开一种即显示它的配音表

- Studio 只导入已录制的音频，不提供录制功能
- 「导入音频…」可以一次选择多个文件，文件名符合「录音文件名规则」的音频关联到对应的行
- 「导出录音脚本」把待录制的行导出为表格文件，交给录制方；文件列出文件名、说话人、场景、文本、状态与备注，最后一列「行 ID」供「导入录音脚本…」把备注与状态对应回各行，不要修改
- 配音完成后正文再被修改的行标记为待更新，「导出补录脚本」只导出这些行；导入补录的音频时，可用新文件替换原录音的文件
- 开启「为选项配音」后，选项才计入待录制的行

A voice language holds one clip per line of narration and dialogue. The panel lists the voice languages with how much of the story each covers, and opening one shows its voice table.

- Studio imports existing clips. It does not record.
- Import audio takes several files at once, and links each file whose name follows the Recording filename pattern to its line.
- Export recording script writes the lines to record as a spreadsheet file for the person recording them. It lists each line's file name, speaker, scene, text, status and note; the last column, Line ID, is what Import recording script uses to bring notes and statuses back to their lines, and is not to be edited.
- A line whose text changed after its clip was assigned is marked Outdated, and Export pickup script writes only those lines. When the pickups are imported, their files can replace the old takes' files.
- Choice options become lines to record only while Voice choice options is on.

相关主题 · Related：语言 · Languages、音频轨道 · Audio tracks、角色 · Characters

### 语言 · Languages

每一行都可以按语言各带一份译文。译文处于四种状态之一：未翻译、机翻、已翻译、已校对；译文完成后原文再被修改，该译文标记为待复查

- 翻译表有两种模式：「翻译」中填写译文，「审校」中逐条通过或退回已翻译的译文
- 一种语言可以导出为 CSV、XLIFF、PO 或 JSON，在外部翻译后导回；导入会报告应用、未变更与未知的条数
- 导出和导入位于语言行的「更多」菜单中，以及该语言翻译表的工具栏上
- 导出的文件中，翻译键所在的行列出用到该键的页面与组件
- 界面控件上直接输入的文字与对白一样翻译，每个控件自身的文字在翻译表中各占一行；仅由数字和符号组成的文字与示例文字除外
- 翻译键是多个控件共用的同一句话；用到它的控件都显示它的文字，与项目是否设置了源语言无关，翻译时只翻一次
- 移除翻译键，或粘贴、导入使用了本项目没有的键的控件时，这些控件的文字来源改为「直接输入」，保留该键的文字与译文
- 游戏进行中切换语言会重启游戏，并回到切换时所在的那一行；项目设置中另有两种选择：重启但不保留进度，或下次启动时再应用

Every line can carry a translation per language. A translation is in one of four states: untranslated, machine, translated or reviewed. When the original text changes after a translation, the translation is marked To review.

- The translation table has two modes: Translate, for writing translations, and Review, for approving or returning translated lines one at a time.
- A language can be exported as CSV, XLIFF, PO or JSON, translated elsewhere, and imported back. The import reports how many lines it applied, how many were unchanged and how many it could not match.
- Export and import are in the language row's More menu and on the toolbar of the language's translation table.
- In an exported file, a translation key's row names the pages and components that use the key.
- Words written directly on an interface widget are translated like a line: each widget's own words have a row in the translation table, except words made only of digits and symbols, and sample text.
- A translation key is words shared by every widget that names it. They show its words whether or not the project has a source language, and the key is translated once.
- Removing a key, or bringing in widgets that use a key the project does not have, gives those widgets the key's words and translations as their own.
- Changing language during a game restarts it and returns the player to the line they were on. Project settings offer two alternatives: restart without keeping the playthrough, or apply the next time the game is started.

相关主题 · Related：场景与行 · Scenes and rows、配音 · Voice-over、构建 · Builds

## 界面 · Game interface

### 配色与字体 · Colors and fonts

此处设定的颜色与字体可以在项目各处使用；设为项目颜色的字段会跟随它，修改此处的颜色即修改全部使用它的位置

- 上方的颜色属于项目本身；下方各组是每个控件的各个部位，每个部位默认跟随上方的某一种颜色
- 部位可以改为跟随另一种颜色，也可以单独指定颜色
- 删除颜色不会改写使用过它的地方；这些地方会回落到自身的默认颜色，并由项目检查列出
- 字体是一份按优先级排列的清单：文字使用其中第一个含有该字符的字体；没有单独指定字体的控件使用这份清单，指定了字体的控件在该字体缺字时也回落到这份清单
- 清单中的字体可以限定于项目的部分语言；每种语言使用清单中除去限定于其他语言的字体后的部分，同一份清单适用于所有语言，新增语言无需额外设置；未限定的字体对所有语言生效
- 项目有两种及以上语言时才显示限定；添加字体时，Studio 读取字体文件中声明的目标语言并自动填写，未声明时留空
- 项目检查按语言报告剧本中使用、但清单中所有字体都无法绘制的字符
- 控件按每个状态所用的字体分别检查；仅在某个状态下无法绘制的字符，报告中注明该状态

A color or a font decided here can be used anywhere in the project. A field set to a project color follows it, so changing the color here changes every place that uses it.

- The colors at the top belong to the project. The groups under them are the parts each control is painted with, and every part follows one of the colors above by default.
- A part can be pointed at a different color, or given a color of its own.
- Deleting a color does not rewrite the places that used it. Those places fall back to their own default color, and the project check reports them.
- The fonts are a list in priority order: text is set in the first of them that has the character. A widget that names no font of its own is set in this list, and one that names a font falls back to the list for the characters that font does not have.
- A font in the list can be limited to some of the project's languages. A language then uses the list with the fonts limited to other languages left out, so one list serves every language and adding a language asks for nothing. A font that is not limited is used for every language, which is how every font starts.
- Limits appear only once the project has a second language. When a font is added, Studio reads the font file and fills the limit in if the font states which language it was made for; it leaves it empty otherwise.
- The project check reports characters the script uses that no font in the list can draw, for each language.
- A widget is checked in the font of each of its states. A character only one state's font cannot draw is reported with the state's name.

相关主题 · Related：游戏界面 · Game screens、可复用的部件 · Reusable parts、项目检查 · Project checks

### 游戏界面 · Game screens

界面编辑器用于搭建游戏自身的界面：主菜单、存读档、对话框；在画布上摆放控件，由蓝图决定控件的行为

- 画布按游戏实际绘制的尺寸显示，编辑结果与玩家所见一致
- 画布上的内容属于游戏，修改画布即修改发布的游戏，而非 Studio 本身
- 编辑游戏 UI 时，画布工具栏的「游戏 UI 参考」可淡显其他游戏 UI，位置与叠放顺序与游戏一致；参考内容不可选中或编辑
- 编辑游戏 UI 时，画布工具栏的「在实时预览中查看此界面」在显示该界面的故事行处打开实时预览，对话框对应一句对白，选项对应一个菜单；画布上的修改随即显示在预览中
- 吸附设置中开启「网格」后，移动元素时其左上角、缩放时被拖动的边落在网格上；网格从画布左上角起算，间距在同一菜单中设置，按项目保存
- 「吸附到网格」将每个选中元素的左上角移到最近的网格点，与是否开启网格吸附无关

The UI editor builds the game's own screens: the main menu, save and load, the dialogue box. Widgets are placed on a surface, and a blueprint decides what they do.

- The surface is drawn at the size the game draws it, so the placement matches what players see.
- A surface belongs to the game. Changing one changes the shipped game, not Studio.
- On a game UI surface, Game UI reference in the canvas toolbar shows the other game UI faintly, in the place and stacking order the game draws it. The reference cannot be selected or edited.
- On a game UI surface, Show this interface in the live preview in the canvas toolbar opens the live preview at a story row that shows it: a line for the dialogue box, a menu for the choices. Edits on the canvas appear in the preview as they are made.
- With Grid on in the snap settings, a moved element's top-left corner and a resized edge land on the grid, which starts at the surface's top-left corner. The grid size is set in the same menu and kept per project.
- Snap to grid moves each selected element's top-left corner to the nearest grid point, with grid snapping on or off.

相关快捷键 · Shortcuts：

- 平移画布 · Pan the Canvas：中键拖动 · Middle-drag；滚动滚轮 · Scroll；Shift+滚动滚轮 · Shift+Scroll
- 以指针为中心缩放 · Zoom at the Pointer：Ctrl+滚动滚轮 · Ctrl+Scroll
- 选择容器内的元素 · Select Inside a Container：双击容器 · Double-click a container
- 直接编辑文字 · Edit Text in Place：双击文本或按钮 · Double-click text or a button
- 暂停智能吸附 · Suspend Smart Snap：Alt+拖动 · Alt+Drag
- 吸附到网格 · Snap to grid：`R`

相关主题 · Related：可复用的部件 · Reusable parts、蓝图 · Blueprints、输入意图 · Input actions、焦点导航 · Focus navigation

### 输入意图 · Input actions

输入意图是对玩家操作的命名，并附带触发它的手势；蓝图响应意图而非手势，修改手势无需修改蓝图

使意图在游戏中生效需要三步

- 在「输入意图」面板中新建意图并添加绑定
- 选中要响应它的界面，在属性面板「输入」一节中点击「添加意图」，选择该意图
- 在该界面的蓝图中添加「意图触发时」节点，并选择该意图

界面只响应「输入」一节中列出的意图，项目中的其他意图不会在该界面触发

An input action is a name for something a player wants to do, together with the gestures that trigger it. A blueprint answers the name, so the gestures can change without the graph changing with them.

Three steps put one on screen.

- Name the action in the Input Actions panel and give it its bindings.
- Select the interface that reacts to it, and choose Add actions in the Input section of its properties.
- Add an On Action node to that interface's blueprint and pick the action.

An interface answers only the actions listed in its Input section, so naming an action does not make every screen react to it.

相关主题 · Related：绑定与设备 · Bindings and devices、界面如何响应意图 · Answering an action、蓝图中的意图 · Actions in blueprints、焦点导航 · Focus navigation

### 绑定与设备 · Bindings and devices

绑定是触发意图的方式；一个意图可以有多条绑定，例如在电脑上使用按键、在手机上使用手势

选择绑定时按设备分组，手势使用各设备通用的名称

- 鼠标：单击、双击、右键单击、中键单击、滚轮
- 触控板：向左滑动、向右滑动；鼠标滚轮无法产生这两种手势
- 触控屏幕：轻触、长按，以及四个方向的滑动
- 键盘：按下要绑定的组合键即可录入
- 手柄：按 Xbox 名称选择按键

多种设备均可产生的手势只需添加一次，在这些设备上均有效；每条绑定旁标明可触发它的设备

长按仅由触控产生，仅绑定长按的意图在电脑上不会触发

A binding is one way to trigger an action. An action takes as many as it needs, so the same action can be a key on a desktop and a gesture on a phone.

The picker is grouped by device, and each device names the gesture the way it produces it.

- Mouse: click, double click, right click, middle click, and the wheel.
- Trackpad: sliding left and right, which a wheel cannot do.
- Touch screen: tap, long press, and sliding in four directions.
- Keyboard: press the combination to record it.
- Gamepad: pick a button by its Xbox name.

A gesture that more than one device produces is added once and works on all of them. Each binding is marked with the devices that reach it.

A long press comes only from a finger, so an action bound to it alone does nothing on a desktop.

相关主题 · Related：输入意图 · Input actions、界面如何响应意图 · Answering an action、焦点导航 · Focus navigation

### 界面如何响应意图 · Answering an action

界面的「输入」一节列出该界面响应的意图；「添加意图」从项目的意图中挑选，未列出的意图该界面不响应

意图触发后，该次输入的传递方式由「触发后」决定：「拦截冒泡」使输入停在该界面，「继续冒泡」将输入传给其下层的界面；默认为拦截冒泡

指针下方的控件优先获得输入，因此玩家点击界面内的按钮时，绑定为单击的意图不会触发

可滚动的列表是唯一的例外，且仅限滚动：列表可继续滚动时由列表获得输入，滚动到尽头后交由意图处理，例如滚动到底部后继续滚动以关闭页面

按键与手柄按键同一时间只由一处接收：最上层的模态叠层，或最上层的页面；剧情显示在屏幕上且其上没有其他界面时，由舞台上的界面接收，例如对话框。按住按键只触发一次意图。按钮或列表行持有键盘焦点时，Enter 与空格键按下该控件，不触发意图

An interface's Input section lists the actions it answers. Add actions picks from the actions the project names, and an action that is not listed is not answered.

Once an action fires, After it fires decides where the input goes: Intercept stops it at that interface, and Continue carries it on to what is drawn behind it. Intercept is the default.

A control under the pointer takes the input first, so an action bound to a click does not fire when the player clicked a button inside the interface.

A scrolling list is the one exception, and only for a scroll: it keeps the scroll while it has somewhere left to travel and lets it through once it does not. That is what lets one more pull at the bottom of a list close the page the list is in.

Keys and gamepad buttons go to one place at a time: the modal layer on top, or the page on top, or, while the story is on screen with nothing over it, the interfaces on the stage such as the dialogue box. A key held down fires its action once. When a button or list row has the keyboard focus, Enter and Space press it and fire no action.

相关主题 · Related：输入意图 · Input actions、绑定与设备 · Bindings and devices、游戏界面 · Game screens、焦点导航 · Focus navigation

### 蓝图中的意图 · Actions in blueprints

以下三个节点读取输入意图

- 「意图触发时」在意图触发时执行，并给出触发它的设备与指针位置；它属于界面或应用逻辑蓝图，不属于单个控件；在应用逻辑蓝图上，它在所有界面中响应全部意图，并先于界面执行
- 「意图是否按住」给出该意图此刻是否处于按住状态；按键、鼠标按键与长按可以保持按住，滚动与双击没有按住状态，恒为 false
- 「获取输入设备」给出玩家当前使用的设备，可用于按设备显示不同的文本

控件自身响应点击时，使用控件的「鼠标点击」事件头；意图处理界面上未被任何控件接收的输入

Three nodes read input actions.

- On Action runs when the action fires. It reports which device raised it and where the pointer was. It belongs to an interface or to the App logic blueprint, not to one widget. On the App logic blueprint it runs for every action on every screen, before any interface answers it.
- Is Action Held answers whether the action is held at this moment. A key, a mouse button and a long press can be held; a scroll is an instant and a double click is a sequence, so both read false.
- Get Input Device answers which device the player is using, for a line that has to read differently on a phone.

A widget that reacts to being clicked uses its own Mouse Click head instead. An action is what the interface does with an input nothing on it wanted.

相关主题 · Related：输入意图 · Input actions、蓝图 · Blueprints、界面上的值 · Values on a screen

### 焦点导航 · Focus navigation

焦点导航供使用键盘或手柄的玩家在屏幕上的控件之间移动焦点；同一时间只有一个控件持有焦点，「确认」按下该控件

「输入意图」面板的「焦点导航」中，每项操作对应一个槽位，由项目中的一个意图填入，该意图的绑定执行这项操作；没有填入任何槽位的项目没有焦点导航。「为空槽位新建意图」为每个空槽位新建一个意图，并添加键盘与手柄的绑定

- 「向上」「向下」「向左」「向右」移到屏幕上该方向最近的控件；持有焦点的滑块沿轨道方向调整数值
- 「下一个控件」「上一个控件」逐个经过各控件，越过最后一个后从另一端继续；列表算作一个控件
- 「确认」按下持有焦点的控件；剧情中没有控件持有焦点时，推进对白
- 「返回」在最上层的模态叠层可关闭时将其关闭，否则返回上一个页面
- 「快捷菜单」在剧情中将焦点移到舞台上游戏 UI 的按钮上，再按「快捷菜单」或「返回」离开

焦点在最上层的模态叠层或页面内移动，剧情中则在选项菜单内移动。该界面通过「输入」一节中的意图，或通过其蓝图、应用逻辑蓝图中针对该按键或手柄按键的事件头响应按键时，焦点不移动

指针移到某个控件上时，其他控件失去焦点，下一次方向操作从指针下的控件开始

外观中带有「聚焦」状态的控件在持有焦点时以该状态绘制；没有该状态的控件显示默认的焦点框，且仅在玩家使用键盘或手柄时显示。控件的「聚焦」与「失焦」事件头在焦点到达与离开时执行

Focus navigation moves the focus between the controls on screen for a player using a keyboard or a gamepad. One control holds the focus at a time, and Confirm presses it.

Under Focus navigation in the Input Actions panel, each operation has a slot filled by one of the project's actions, and the action's bindings perform the operation. A project whose actions fill no slot has no focus navigation. Add actions for empty slots creates an action for each empty slot, with keyboard and gamepad bindings.

- Move up, Move down, Move left and Move right go to the nearest control in that direction on screen. A focused slider takes the directions along its track and changes its value.
- Next control and Previous control step through the controls one at a time, and continue from the opposite end after the last one. A list counts as one control.
- Confirm presses the focused control. During the story, with nothing focused, it advances the dialogue.
- Back closes the modal layer on top when the layer is dismissible, and otherwise returns to the previous page.
- Quick menu, during the story, moves the focus onto the buttons of the game UI on the stage. Quick menu or Back moves it off them.

The focus moves within the modal layer or the page on top, and during the story within the choice menu. A press does not move the focus when that interface answers it, through an action in its Input section or through a head for the key or button in its blueprint or the App logic blueprint.

Moving the pointer onto a control takes the focus off any other control, and the next direction starts from the control under the pointer.

A control whose appearance has a Focused state is drawn in that state while it holds the focus. A control without one shows a default focus ring, which appears only while the player uses a keyboard or a gamepad. A widget's Focus and Blur heads run when the focus arrives on it and when it leaves.

相关主题 · Related：导航设置 · Navigation settings、输入意图 · Input actions、绑定与设备 · Bindings and devices、界面如何响应意图 · Answering an action、游戏界面 · Game screens

### 导航设置 · Navigation settings

属性面板的「导航」一节设置焦点在界面上的起始位置与各方向的去处。未作设置时，所有控件均可获得焦点，各方向移到屏幕上该方向最近的控件

页面以及「选项」游戏 UI 有以下三项设置

- 「起始焦点」指定焦点开始时所在的元素；为「自动」时从开启「设为起始焦点」的元素开始，没有该元素时从左上方的第一个控件开始
- 「打开时聚焦」决定界面打开时是否将焦点放在控件上；默认的「使用键盘或手柄时」仅在玩家最近使用键盘或手柄时聚焦，「始终」每次都聚焦，其余情况下焦点在第一次按下方向时出现
- 「边缘循环」使越过界面边缘的移动从另一侧回到界面内

回到某个页面时，焦点回到玩家离开时所在的控件

界面上的每个元素有各自的设置

- 「可聚焦」为默认的「自动」时，仅控件可获得焦点；「始终」使任意元素可获得焦点，在该元素上执行「确认」相当于点击；「从不」将该元素及其内部的所有元素排除在导航之外
- 「设为起始焦点」使焦点从该元素开始，界面的「起始焦点」另行指定时除外
- 「导航分组」用于包含其他元素的元素，分组内在按下的方向上还有控件时，焦点留在分组内；开启「边缘循环」时，越过分组边缘的移动从另一侧回到分组内；开启「记住上次焦点」时，再次进入分组的焦点回到上次离开分组时所在的控件
- 「上」「下」「左」「右」指定焦点离开该元素时各方向的去处；「按布局」即该方向上最近的控件

The Navigation sections in the properties panel set where the focus starts on an interface and where each direction takes it. With nothing set, every control can take the focus, and each direction goes to the nearest control on screen.

Pages, and the Choice game UI, have three settings.

- Starting focus names the element the focus starts on. Automatic starts on an element set as Use as starting focus, and otherwise on the first control from the top left.
- Focus on open decides whether a control takes the focus as the interface opens. Keyboard or gamepad, the default, does so when the player last used one of them, and Always does so every time. Otherwise the focus appears at the first direction pressed.
- Loop at edges continues a move past the edge of the interface from the opposite side.

Returning to a page puts the focus back on the control it was on when the player left.

Each element on an interface has its own settings.

- With Focusable on Automatic, the default, an element can take the focus when it is a control. Always lets any element take it, and Confirm on the element acts as a click. Never takes the element and everything inside it out of navigation.
- Use as starting focus starts the focus on the element, unless the interface's Starting focus names another.
- Navigation group, on an element that holds others, keeps the focus inside while a control inside lies in the pressed direction. With Loop at edges, a move past the edge of the group continues from its opposite side. With Remember last focus, a focus entering the group again lands on the control it last left the group from.
- Up, Down, Left and Right name where each direction goes when the focus leaves the element. By layout goes to the nearest control in that direction.

相关主题 · Related：焦点导航 · Focus navigation、游戏界面 · Game screens

### 页面音乐 · Page music

页面属性的「音乐」一节决定页面显示期间播放什么音乐

- 未选择音乐时显示「保持当前音乐」，页面不改变音乐。打开页面时在播放的音乐继续播放
- 选择了音乐时播放它。同一段音乐已在同一音轨上播放时，它不中断地继续；否则正在播放的音乐按自己的淡入淡出时间淡出，新的音乐按页面的设置淡入
- 「选择页面音乐」旁的「无音乐」使页面显示期间不播放音乐；「清除」回到保持当前音乐

返回到下面的页面时，换回那个页面的音乐。用「替换页面」打开、保持当前音乐的页面，继续播放被替换页面的音乐

蓝图节点「播放页面音乐」「停止页面音乐」在页面打开期间改变它的音乐，例如换成在音乐鉴赏里按下的曲目

游戏进行中由故事决定音乐。开始游戏或读取存档时页面音乐淡出，在游戏中打开的页面不播放页面音乐

The Music section of a page's properties decides what music plays while the page is on screen.

- With no music chosen, the row reads Keep current music, and the page changes nothing. Whatever was playing when the page opened goes on playing.
- With music chosen, the page plays it. If the same music is already playing on the same track, it carries on without a break. Otherwise the music playing fades out over its own fade and the new music fades in over the page's.
- No music, beside Choose page music, plays nothing while the page is on screen. Clear goes back to keeping the current music.

Going back to a page underneath brings that page's music back. A page opened with Replace Page that keeps the current music goes on playing the music of the page it replaced.

The Play Page Music and Stop Page Music blueprint nodes change a page's music while it is open, for example to the track pressed in a music room.

While a game is running, the story decides the music. The page's music fades out when a game starts or a save is loaded, and pages opened during the game play no page music of their own.

相关主题 · Related：游戏界面 · Game screens、蓝图 · Blueprints

### 可复用的部件 · Reusable parts

成组的控件可以保存为组件，放置到任意界面上；每个放置处与组件保持关联，修改组件即修改全部放置处

- 放置处可以移动、缩放和旋转；修改其他属性需要先解除关联，解除后该放置处不再跟随组件
- 组件库标明每个组件的放置数量
- 选中放置处时，组件库标出对应的组件
- 组件被删除后，其放置处显示为缺失，直到被替换或解除关联
- 参数在组件上声明，在每个放置处设置；「字符串」参数由组件的蓝图通过「获取组件参数」读取
- 「文字」参数是玩家读到的文字。在组件内的文本或按钮上于「参数」中选择它，各放置处在画布和游戏中显示各自的文字，可以直接输入，也可以使用翻译键；放置处直接输入的文字按该放置处单独翻译，在译表中各占一行

Widgets that belong together can be saved as a component and placed on any screen. Every placement stays linked to the component, so changing the component changes all of them.

- A placement can be moved, resized and rotated. Changing anything else requires unlinking it first, after which it no longer follows the component.
- The library states how many placements each component has.
- Selecting a placement marks its component in the library.
- After a component is deleted, its placements show as missing until they are replaced or unlinked.
- Parameters are declared on the component and set on each placement. A String parameter is read by the component's blueprints with Get Component Param.
- A Text parameter holds words a player reads. Inside the component, a text or a button picks it under Parameter, and each placement shows its own words on the canvas and in the game, written directly or from a translation key. Words written directly on a placement are translated as that placement's own, one row each in the translation table.

相关快捷键 · Shortcuts：

- 编组 · Group：`⌘G`（macOS）/ `Ctrl+G`（Windows）
- 创建副本 · Duplicate：`⌘D`（macOS）/ `Ctrl+D`（Windows）

相关主题 · Related：游戏界面 · Game screens、界面上的值 · Values on a screen

### 蓝图 · Blueprints

蓝图定义一个界面的行为：按钮被按下时执行什么、界面打开时执行什么；每张图从一个事件开始

节点沿连线执行；一种连线决定执行顺序，另一种把值从一个节点传入下一个节点

- 没有图层的蓝图显示几个适合其所属对象的模板和模板库，最后一格是空白图层
- 模板库按分类列出适用于该蓝图的全部模板，并预览每个模板添加的图；图层面板「新建」旁的按钮也能打开它
- 在画布上右键添加节点，放置前节点跟随光标
- 工具栏决定在空白画布上拖动的结果：框选，或移动视图
- 选中的节点可以框为一个分组并整体移动，整张图也可以重新排列成从左到右的顺序
- 每个引脚只接受一条连线；未连线的值直接在节点上填写
- 同一个事件可以由多个事件头监听；事件发生时它们同时开始，互不等待
- 问题列在画布下方，选中一条即选中它指向的对象
- 粘贴蓝图文本格式的内容（例如 AI 工具写出的图层），其中的节点和连线添加到当前图中，可一次撤销；文本有错误时不添加任何内容，通知中注明出错的行
- 节点右键菜单中的「复制为文本」将所选节点以同一格式复制到剪贴板，可粘贴到其他图中或 AI 工具里
- 每个节点及其引脚列在官网的节点参考中，点击下方「打开完整页面」前往

A blueprint defines what a screen does: what runs when a button is pressed, what runs when the screen opens. Every graph starts from an event.

Execution follows the wires between the nodes. One kind of wire sets the order of execution, the other carries values from one node into the next.

- A blueprint with no layers shows a few templates that suit what it belongs to, the template library and, last, a blank layer.
- The template library lists every template for the blueprint by category, with a preview of the graph each one adds. The button beside New in the layer panel opens it too.
- Right-click the canvas to add a node. It follows the cursor until it is placed.
- The toolbar sets what a drag on empty canvas does: selecting, or moving the view.
- A selection can be framed as a group that moves as one, and the whole graph can be arranged from left to right.
- Each pin takes one wire. Values with no wire are typed on the node itself.
- Several event heads can listen for the same event. They all start when it happens, and none waits for another to finish.
- Problems are listed under the canvas, and selecting one selects what it refers to.
- Pasting blueprint text, such as a layer written in the blueprint text format by an AI tool, adds its nodes and wires to the open graph as one undo step. Text with an error adds nothing, and a notification names the line.
- Copy as Text, on a node's right-click menu, puts the selected nodes on the clipboard in the same format, ready to paste into another graph or an AI tool.
- The node reference on the website lists every node and its pins. Open the full page, below, goes there.

相关快捷键 · Shortcuts：

- 添加节点 · Add a Node：右键单击画布 · Right-click the canvas
- 添加并连接节点 · Add a Connected Node：从引脚拖到画布空白处 · Drag from a pin onto empty canvas
- 删除连线 · Delete a Wire：双击连线 · Double-click a wire
- 平移画布 · Pan the Canvas：中键拖动 · Middle-drag；Ctrl+拖动 · Ctrl+Drag；滚动滚轮 · Scroll
- 复制节点 · Copy Nodes：`⌘C`（macOS）/ `Ctrl+C`（Windows）
- 粘贴节点 · Paste Nodes：`⌘V`（macOS）/ `Ctrl+V`（Windows）
- 将节点复制为文本 · Copy Nodes as Text：`⌘⇧C`（macOS）/ `Ctrl+Shift+C`（Windows）
- 撤销 · Undo：`⌘Z`（macOS）/ `Ctrl+Z`（Windows）

相关主题 · Related：脚本 · Scripts、界面上的值 · Values on a screen、游戏界面 · Game screens、变量 · Variables

详细说明 · Learn more：https://www.narraleaf.com/docs/studio/blueprint/nodes

### 脚本 · Scripts

页面、控件或故事行的逻辑是一份图层列表，每一层要么是蓝图，要么是脚本。蓝图是画布上的一张图；脚本是项目 scripts 目录下的一个 TypeScript 文件，在外部编辑器中编写。Studio 只在创建时写入该文件一次，此后不再改写

列表中的每一层都会运行，同一位置上脚本可以与蓝图并存，两者都会响应。「添加图层」时选择图层类型，列表的每一行标明该层的类型

- 脚本通过导出的函数进入。当前位置会调用哪些名称由它所处的位置决定，新文件开头列出了这些名称；故事行使用默认导出
- 「在编辑器中打开」打开整个 scripts 目录。脚本的类型来自它旁边的文件，只打开单个文件无法解析类型
- 资产面板的「脚本」分区列出 scripts 目录下的全部文件、每个文件由哪段逻辑运行，以及哪些文件没有被使用
- 编译失败的文件，以及没有导出当前位置会调用的名称的文件，均在开发模式中报告；开发模式的蓝图列表显示文件名及是否已加载
- 移除图层不会删除文件。删除文件请在文件管理器中进行

The logic of a page, a widget or a story row is a list of layers, and each layer is either a blueprint or a script. A blueprint is a graph on a canvas. A script is a TypeScript file under the project's scripts folder, written in an external editor. Studio creates the file once and never writes it again.

Every layer in the list runs, so a script can sit beside a graph in the same place and both answer. New layer asks which of the two it is, and each row says which one it holds.

- A script is entered through its exported functions. Which names this position calls follows from where it sits, and the first lines of a new file list them. A story row uses the default export instead.
- Open in editor opens the whole scripts folder. The types come from the files beside a script, so an editor opened on one file alone resolves none of them.
- The Scripts section of the Assets panel lists every file under the scripts folder, which logic runs each one, and which of them nothing runs.
- A file that fails to compile, and one that exports nothing this position calls, are reported in Dev Mode. The blueprint list there names the file and says whether it loaded.
- Removing a layer leaves its file on disk. Deleting the file is done in the file manager.

相关主题 · Related：蓝图 · Blueprints、游戏界面 · Game screens、变量 · Variables

### 界面上的值 · Values on a screen

控件可以显示运行时变化的值，而不是固定内容；文本、按钮文字、图片、滑块的值和开关的状态都可以由蓝图值提供

- 文本与按钮文字在「直接输入」「翻译键」「蓝图值」中选择；其他属性点击「蓝图值」
- 「打开蓝图值」编辑该蓝图，由图中的「返回值」节点输出结果
- 蓝图值直接读取本页面与应用逻辑的变量，以及存档变量和持久变量；其他变量通过「调用函数」读取
- 蓝图值读取的变量被写入后，控件显示的值随之更新
- 「翻译键文本」给出翻译键在玩家语言中的文本，「格式化」把值填入其中；玩家切换语言后控件随之显示新语言
- 列表行中的控件还可以在「字段」中选择该行数据的一个字段来显示
- 组件内的控件还可以在「参数」中选择组件的一个「文字」参数来显示，此时控件自身的文字是示例文字，只在编辑组件时显示
- 使用蓝图值、列表行的字段或组件的「文字」参数时，控件自身的文字是示例文字：只在编辑器中显示，不进入构建出的游戏，也不参与翻译
- 游戏运行时由蓝图通过「设置文本」「清空文本」「设置标签」写入文字的控件，在文本下方列出这些蓝图；其自身的文字是默认值，首次写入前游戏中以玩家的语言显示；「追加文本」接在屏幕上的文字之后
- 游戏运行时由蓝图写入的文字按写入的内容显示，在所有语言中优先于翻译键和蓝图值，直到页面重新打开；文本的「获取文本」与按钮的「获取标签」读取屏幕上显示的文字
- 脚本图层的写入不会列出

A widget can show a value that changes at run time instead of fixed content. Text, a button's label, an image, a slider's value and a switch's state can each be answered by a Blueprint Value.

- Text and button labels choose between Direct, Translation key and Blueprint Value. The other properties have a Blueprint Value button.
- Open Blueprint Value edits the graph, and a Return Value node hands back the result.
- A Blueprint Value reads the variables of its page and of App logic, and saved and persistent variables, directly. Other variables are read through Call Fn.
- When a variable the Blueprint Value read is written, the widget shows the new value.
- Translation Key Text gives a translation key's text in the player's language, and Format fills values into it. When the player changes language, the widget shows the new language.
- A widget inside a list row can also show one field of that row, chosen under Field.
- A widget inside a component can show one of the component's Text parameters, chosen under Parameter. Its own words are then sample text, drawn only while the component is edited.
- Under a Blueprint Value, a field of a list row or a Text parameter of a component, the widget's own words are sample text. They are drawn in the editor only, are not part of the built game and are not translated.
- A widget whose words a blueprint writes while the game runs, with Set Text, Clear Text or Set Label, lists those blueprints under its text. Its own words are the default value, which the game shows in the player's language until the first write. Append Text adds to the words on screen.
- Words a blueprint writes while the game runs are shown as written, in every language, ahead of a translation key and a Blueprint Value, until the page is opened again. Get Text and Get Label read the words on screen.
- Writes made by a script layer are not listed.

相关主题 · Related：蓝图 · Blueprints、游戏界面 · Game screens、变量 · Variables

### 网络请求 · Network requests

Fetch 节点在游戏运行时发起 HTTP 请求，用于在线公告、排行榜等内容；它有四个出口：请求成功、服务器返回错误、网络失败、请求超时

- Fetch 产出一个响应；用 Read Response Text 或 Read Response JSON 把它读成值
- 响应只能在发起它的那次运行中读取；需要保留的数据，读出后存入变量
- 项目设置中的「网络策略」决定这些节点是否可用；选择「不允许联网」时项目检查报告错误，构建被拒绝
- 只能请求 http 和 https 地址

The Fetch node makes an HTTP request while the game runs, for an online notice board or a leaderboard. It leaves by one of four paths: the request succeeded, the server answered with an error, the network failed, or the request timed out.

- Fetch produces a Response. Read Response Text or Read Response JSON turns it into a value.
- A Response is only readable during the run that fetched it. To keep the data, read it and store it in a variable.
- The network policy in project settings decides whether these nodes run. With no network access, the project reports an error and the build is refused.
- Only http and https addresses can be fetched.

相关主题 · Related：蓝图 · Blueprints、网络请求白名单 · Network request allowlist、资产保护 · Asset protection、项目检查 · Project checks

## 检查 · Checks

### 拼写 · Spelling

故事的原文会被检查拼写，译文不检查

检查所用的语言跟随项目的原文语言，也可以在设置中改为其他语言或不检查。某种语言在其拼写词典下载之后才会被检查，下载入口在设置的「拼写词典」中；在此之前不会标出任何内容

- 红色波浪线标出拼写错误。右键点击给出替换建议，并可将该词加入项目词典
- 中文与日语按词逐个对照该语言的词典读取。被标出的是切不出任何已知词的字串。若拼写错误恰为另一个有效词，则不会被检出

The source text of a story is checked for spelling. Translations are not.

The language follows the project's source language, and can be set to another one, or to none, in Settings. A language is checked once its dictionary has been downloaded, under Spelling dictionaries in the same place. Until then nothing is marked.

- A red wave marks a misspelling. Right-clicking it offers replacements, and offers to add the word to the project dictionary.
- Chinese and Japanese are read a word at a time against the dictionary of the language. What is marked is a run of characters that spells no word in it. A mistyped character that spells another word is not found.

相关主题 · Related：项目词典 · Project dictionary、词典标记 · Dictionary marks、Studio 设置 · Studio settings

### 项目检查 · Project checks

检查读取整个项目，报告无法运行的位置：引用了不存在的资产、跳转到未声明的标签、编译器不接受的行、所选平台不支持的媒体格式

「问题」面板列出检查结果，每次编辑后不久自动更新；状态栏显示错误与警告的数量

- 选中一条问题即打开对应位置；问题旁的「?」说明该规则的检查内容与修复方法
- 各规则按「项目 ▸ 项目 ▸ 项目检查」中设置的级别报告；次要警告列在面板中，不计入状态栏，也不会中止构建
- 「检查项目」重新读取所有文件，包括在 Studio 之外修改过的资产
- 检查不修改任何内容

Checks read the whole project and report what will not run: references to assets that no longer exist, jumps to labels that were never declared, rows the compiler will not accept, media formats the chosen platform cannot play.

The Problems panel lists the findings and updates them shortly after each edit. The status bar shows how many errors and warnings there are.

- Selecting a finding opens the place it is about. Its ? opens the rule: what it found and how to fix it.
- Each rule reports at the level set in Project ▸ Project ▸ Project check. A minor warning is listed in the panel, is not counted in the status bar, and never stops a build.
- Check Project reads every file again, including assets changed outside Studio.
- Running the checks modifies nothing.

相关主题 · Related：测试 · Tests、构建 · Builds

### 测试 · Tests

测试运行游戏并报告某个条件是否成立：能否到达某个结局、过程中是否出错

- 列表包含 Studio 自带的测试与插件提供的测试；有窗口的测试会打开游戏窗口，无窗口的测试不打开
- 部分测试在开始前需要一个值，例如到达哪个结局；控件保留本项目上次运行该测试时使用的值
- 当前无法开始的测试仍列在其中并禁用，旁边给出原因
- 开始测试后本对话框关闭，运行输出写入控制台，运行结束时打开报告
- 测试结论为通过、失败或已跳过；已取消与出错表示本次运行未完成，不表示游戏存在问题
- 报告保留上一次运行的结果，直到该测试再次运行

A test runs the game and reports whether a condition held: that an ending can be reached, that nothing failed during the run.

- The list contains Studio's own tests and the tests added by plugins. A windowed test opens a game window, a headless test runs without one.
- A test can ask for a value before it starts, such as which ending to play to. It opens on what that test was last run with in this project.
- A test that cannot start remains in the list, disabled, with the reason beside it.
- Starting a test closes this dialog. The output appears in the console, and the report opens when the run finishes.
- A test reports passed, failed or skipped. Cancelled and errored mean the run did not finish, not that the game failed the test.
- The report retains the findings of the last run until the test runs again.

相关主题 · Related：项目检查 · Project checks、运行游戏 · Running the game、构建 · Builds

### 项目统计 · Project statistics

仪表盘统计项目的内容量和近期增量：场景、对白行、字数、角色、资产，以及写作天数

- 字数只统计故事正文，因此只编辑界面、资产或蓝图的日期计为零
- 统计自该项目首次在支持统计的 Studio 版本中打开时开始，此前的内容不计入

The dashboard counts what the project holds and what was added recently: scenes, lines, words, characters, assets and the days with writing.

- Words are counted from story text, so a day spent only on screens, assets or blueprints records no words.
- Counting starts the first time the project is opened in a Studio version that records them. Work before that is not counted.

相关主题 · Related：场景与行 · Scenes and rows、语言 · Languages

### 恢复模式 · Recovery mode

项目有一部分无法读取时，Studio 提供只读且不加载插件的方式打开该窗口；该模式下不写入任何内容

- 面板列出全部失败项，每项附带对应的错误
- 加载检查逐部分读取项目并报告结果；可读取的部分照常浏览
- 项目存在版本历史时，可以从这里恢复到可用的版本
- 退出恢复模式后按常规方式重新打开项目

When part of a project cannot be read, Studio offers to open the window read-only and without plugins. Nothing is written in this mode.

- The panel lists every failure, each with the error it reported.
- The load checks read the project one part at a time and report the result. The parts that load can be browsed as usual.
- With a version history in the project, a working version can be restored from here.
- Leaving recovery mode reopens the project normally.

相关主题 · Related：恢复到某个版本 · Restoring a version、冻结的项目 · Frozen projects、项目检查 · Project checks

## 版本 · Versions

### 版本控制 · Version control

版本记录项目在某一时刻的状态，可随时恢复，历史保存在项目目录中。提交会产生新版本；Studio 还会自动记录检查点：按设置中的间隔记录，默认每 15 分钟一次且仅在有改动时；关闭工作区、构建和恢复之前也各记录一次

- 提交版本只向列表追加，不替换也不删除已有版本
- 变更不会自动检测，执行一次检查即可列出

A version is a point that can be returned to, and history is kept inside the project folder. Submitting creates a version, and Studio also records checkpoints of its own: at the interval set in Settings, every 15 minutes by default and only when something changed, and before the workspace closes, before a build and before a restore.

- Submitting a version appends to the list. It never replaces or removes an existing version.
- Changes are not detected automatically. Run a check to list them.

相关主题 · Related：改动内容 · Changes since the last version、查看历史版本 · Viewing an old version、恢复到某个版本 · Restoring a version、与服务器协作 · Working with a server

### 改动内容 · Changes since the last version

提交版本之前，Studio 可以列出当前项目与上一个版本的差异：哪些文件变化，以及文件中的哪些场景、行、角色和资产变化

- 差异在执行检查后才会计算；列表标明上次检查的时间
- 变化的行同时显示修改前和修改后的内容
- 查看差异不写入任何内容，项目不被修改

Before a version is submitted, Studio can list the differences from the last one: which files changed, and inside them which scenes, rows, characters and assets changed.

- Differences are computed when a check is run. The list states when it was last checked.
- A row that changed is shown with both sides, before and after.
- Viewing differences writes nothing. The project is not modified.

相关主题 · Related：版本控制 · Version control、合并冲突 · Merge conflicts

### 查看历史版本 · Viewing an old version

从列表中打开一个版本，编辑器显示该时间点的内容；项目中的文件不会被修改，查看期间也不会保存

- 退出历史查看后，当前的工作内容原样返回
- 查看期间输入的内容在退出时丢弃

Opening a version from the list shows the editors as they were at that point. The files in the project are not modified, and nothing is saved while a version is open.

- Stop Viewing History returns to the current work, unchanged.
- Anything typed while a version is open is discarded on leaving.

相关主题 · Related：版本控制 · Version control、恢复到某个版本 · Restoring a version、冻结的项目 · Frozen projects

### 恢复到某个版本 · Restoring a version

恢复把项目中的文件替换为该版本的内容；它是版本轨道中唯一修改磁盘内容的操作

- 当前状态会先记录为一个检查点，因此恢复本身可以撤销
- 不会删除任何版本，恢复结果作为新版本追加

Restoring replaces the files in the project with that version's contents. It is the only action in the version rail that modifies what is on disk.

- The current state is recorded as a checkpoint first, so a restore can itself be undone.
- No version is removed. The restored state is appended as a new one.

相关主题 · Related：版本控制 · Version control、查看历史版本 · Viewing an old version

### 合并冲突 · Merge conflicts

同一文件的同一处在本地和服务器上都被修改时，合并会中断并询问保留哪一边；所有冲突都有结论之前，项目保持冻结

- 两边并排显示，逐条选择保留其中一边
- 可以自动合并的部分已经就位，只有无法自动合并的部分需要选择
- 完成合并会提交一个版本，结果与其他版本一样保存在历史中

When the same part of a file changed locally and on the server, the merge stops and asks which side to keep. The project stays frozen until every conflict has an answer.

- Both sides are shown side by side, and one side is kept per item.
- Everything that merged automatically is already in place. Only the parts that could not be merged require an answer.
- Finishing the merge submits a version, and the result is stored in the history like any other.

相关主题 · Related：与服务器协作 · Working with a server、改动内容 · Changes since the last version、冻结的项目 · Frozen projects

### 与服务器协作 · Working with a server

项目可以连接到版本控制服务器，供多人协作；数据的发送和获取都由手动操作触发

- 发送把已提交的版本上传到服务器
- 获取把服务器上的版本下载下来，并合并到本地
- 两边都有新版本时，先获取，再发送
- 检查当前状态需要访问服务器
- 服务器与版本记录使用的账号，在窗口左下角的 NarraLeaf Team 中设置

A project can be connected to a version control server so that several people can work on it. Nothing is sent or fetched except by an explicit action.

- Send uploads submitted versions to the server.
- Get downloads the versions on the server and merges them into the local project.
- When both sides have new versions, Get first and Send afterwards.
- Checking the current state contacts the server.
- The server, and the account versions are recorded under, are set from NarraLeaf Team in the bottom-left corner of the window.

相关主题 · Related：版本控制 · Version control、合并冲突 · Merge conflicts、添加项目 · Adding a project

### 冻结的项目 · Frozen projects

冻结的项目不再被写入；编辑器照常打开，内容可以查看，修改不会保存到磁盘

- 查看历史版本时、以及合并未完成时，Studio 会自动冻结项目；也可以手动冻结
- 会写入的控件被禁用而不是隐藏，界面布局保持不变

A frozen project is not written to. Editors open and content can be read, but changes are not saved to disk.

- Studio freezes the project while an old version is open and while a merge is unfinished. It can also be frozen manually.
- Controls that would write are disabled rather than hidden, so the layout stays the same.

相关主题 · Related：查看历史版本 · Viewing an old version、运行游戏 · Running the game

## 发布 · Shipping

### 构建 · Builds

构建产出交付给玩家的文件；选择目标平台和格式后开始构建

- 所有平台在 Windows 和 Mac 上都可以构建。在 Windows 上，macOS 只能构建为 zip，Linux 可构建为 zip 或 AppImage
- 未签名的构建可以运行，但首次打开时 Windows 和 macOS 会显示安全提示
- 图标取自「项目 ▸ 应用」；某个平台的图标未生成时，该平台使用 NarraLeaf 的图标

A build produces the files delivered to players. Choose the target platforms and formats.

- Every platform builds on Windows and on a Mac. On Windows, macOS builds only as a zip, and Linux as a zip or an AppImage.
- An unsigned build runs, but the first launch shows a security prompt on Windows and macOS.
- Icons come from Project ▸ App. A platform whose icon has not been generated builds with the NarraLeaf icon.

相关主题 · Related：补丁 · Patches、图标 · Icons、给构建签名 · Signing a build、资产保护 · Asset protection

详细说明 · Learn more：https://www.narraleaf.com/docs/studio

### 存档放在哪里 · Where saves are kept

发布的桌面版游戏把玩家文件写在两处之一，Windows 与 Linux 一份答案，macOS 另一份

- 游戏文件夹内：玩家文件跟随游戏本体。将文件夹复制到其他设备时，进度随之转移；删除游戏时一并删除；同一设备上的所有用户共用一份
- 用户文件夹内：每个用户各有一份，删除游戏后仍保留在原位置。商店的存档同步只能指向这一处

A shipped desktop game writes the player's files to one of two places, answered here for Windows and Linux and again for macOS.

- The game's folder: the files travel with the player's copy of the game. Copying that folder to another machine carries their progress; removing the game removes them; everyone using that computer shares one set.
- The user folder: every person using the computer has their own, and removing the game leaves them in place. A storefront's save synchronisation can be pointed at this one.

相关主题 · Related：旧存档 · Older saves、补丁 · Patches

### 旧存档 · Older saves

玩家的存档分三种情况，本页两项设置决定其中两种

- 本次构建写入的存档：完整恢复，两项设置均不适用
- 同一故事、项目版本不同的存档：由第一项设置决定
- 故事变更前写入的存档：由第二项设置决定

不恢复的存档不出现在存档列表中，玩家不会得到无法读取的槽位

A player's save falls into one of three cases. The settings on this page decide two of them.

- Written by this build: restored in full. Neither setting applies.
- Same story, another project version: decided by the first setting.
- Written before the story changed: decided by the second setting.

A save that is not restored is absent from the save list. The player is never offered a slot that cannot be read.

相关主题 · Related：其他项目版本的存档 · Saves from another project version、故事变更前的存档 · Saves from before a story change、补丁 · Patches

### 其他项目版本的存档 · Saves from another project version

故事未变更，存档记录的行仍存在于故事中

- 恢复进度：从该行继续
- 不恢复进度：该槽位不出现在存档列表中，读取请求返回失败

The story is unchanged, and the line the save records is still in it.

- Restore progress: play continues from that line.
- Do not restore progress: the slot is absent from the save list, and a load request fails.

相关主题 · Related：旧存档 · Older saves、故事变更前的存档 · Saves from before a story change

### 故事变更前的存档 · Saves from before a story change

存档写入之后故事已变更，存档记录的行可能已不存在

- 强制载入：从该行继续；故事缺少存档所需的内容时返回失败
- 回到中断处：从该行重新开始；该行不存在时从其所在场景的开头开始；场景同样不存在时返回失败。变量与已访问场景予以保留，舞台与对话记录不保留
- 不恢复进度：该槽位不出现在存档列表中，读取请求返回失败

The story was edited after the save was written. The line the save records may no longer be present.

- Restore progress anyway: play continues from that line, and fails when the story lacks what the save requires.
- Return to where it stopped: play starts again on that line, at the start of its scene when the line is absent, and fails when the scene is absent as well. Variables and visited scenes are kept. The stage and the backlog are not.
- Do not restore progress: the slot is absent from the save list, and a load request fails.

相关主题 · Related：旧存档 · Older saves、其他项目版本的存档 · Saves from another project version、补丁 · Patches

### 补丁 · Patches

补丁向已安装的游戏交付后续改动：剧情、页面、译文、配音与资产。应用程序文件与引擎版本保持安装时那次构建产出的状态

- 补丁只能在所针对变体的构建中打开，且该构建须在项目创建分发密钥之后产出
- 所更新的构建可以在本次导出中构建，也可以指定此前构建产出的目录。前者比较项目当前状态下的两个变体，版本升级与 DLC 由此产出；后者比较该构建，已发布内容的修正由此产出
- 内容取自构建下方选定的变体，它不必与所更新的构建同一个变体。安装到试玩版、内容取自正式版的补丁，会将该试玩版变成正式版
- 补丁只包含与所更新的构建不同的文件，以及它对该构建内容所作的改动；既未指定也未构建时，补丁包含整份游戏，并覆盖层级低于它的补丁所改动的内容
- 同时安装的多个补丁各自生效。两个补丁改动同一个场景、页面、条目或文件时，层级更高的一方生效
- 导出产出一个名为 patch 的文件夹。将该文件夹放入游戏所在目录即安装补丁，删除该文件夹即恢复为安装时的构建。DLC 则写入名为 DLC 的文件夹，文件名取自它自己的记录
- 构建之前运行的检查，在导出之前同样运行，两者的结果都写入构建控制台
- 存在可比较的构建时，导出还会报告哪些存档在安装本补丁后无法读取。该报告为警告，不会中止导出

A patch delivers later changes to an installed game: the story, the pages, the translations, the voice lines and the assets. Application files and the engine version remain as the installed build produced them.

- A patch opens only in builds of the variant it was exported for, and only in builds produced after the project has a distribution key.
- The build a patch updates is either built as part of the export, or named as a build folder an earlier build produced. Building it compares two variants of the project as it stands now; an edition upgrade and a DLC are made this way. Naming a folder compares against that build; a fix to something already released is made this way.
- The content comes from the variant selected below the build, and it need not be the same variant. A patch that installs into the demo and carries the full game's content turns that demo into the full game.
- The patch is limited to the files that differ from the build it updates, and to the changes it makes to that build’s content. Where no build is named and none is built, the patch includes the whole game and replaces the content of any patch installed below it.
- Several patches installed together each apply. Where two of them change the same scene, page, entry or file, the higher layer applies over the lower one.
- The export produces a folder named patch. Placing that folder in the game's folder installs the patch, and deleting it restores the installed build. A DLC is written to a folder named DLC instead, under the name its own record states.
- The checks that precede a build also precede an export, and both report in the build console.
- Where there is a build to compare against, the export also reports which saves made against it will no longer load. That report is a warning and does not stop the export.

相关主题 · Related：构建 · Builds、变体 · Build variants、资产保护 · Asset protection、项目检查 · Project checks

详细说明 · Learn more：https://www.narraleaf.com/docs/studio

### 变体选择 · Variant selection

一次构建产出项目的一个变体。名为 main 的变体携带项目自身的应用名、标识符与项目版本，其他变体携带它自己填写的值

- 之后的每一页描述的都是所选变体
- 文件名中带有变体名，因此构建到同一目录的两个变体不会互相覆盖
- 项目在 main 之外有了其他变体，本页才出现

A build produces one variant of the project. The variant named main carries the project's own application name, identifier and version; another variant carries what it states instead.

- The pages after this one describe the selected variant.
- File names carry the variant, so two variants built into one folder do not replace each other.
- This page appears once the project has a variant beside main.

相关主题 · Related：变体 · Build variants、变体构建的内容 · Variant build contents、构建 · Builds

### 变体 · Build variants

变体是同一个项目的一种成品，例如试玩版。每个项目都有名为 main 的变体，在它旁边新增的变体一开始与 main 完全相同。名称 main 在各语言下相同

- 变体只保存与 main 不同的部分；留空的字段显示 main 的值，并跟随它
- 「恢复继承」删除该变体自己填写的值，该字段重新跟随 main
- 删除变体不会改写指向它的地方；这些地方从此按 main 读取，删除按钮旁的数字即为其数量

A variant is one edition of the project, such as a demo. Every project has the variant named main, and each variant added beside it begins identical to main. The name main is the same in every language.

- A variant stores only the values it changes. A field left empty shows the main value and follows it.
- Restore removes the variant's own value, and the field follows main again.
- Deleting a variant does not rewrite what pointed at it. Those places read main from then on, and the count beside Delete states how many.

相关主题 · Related：构建 · Builds、变体选择 · Variant selection、变体构建的内容 · Variant build contents、项目检查 · Project checks

### 变体构建的内容 · Variant build contents

截断点让指定变体的剧情在该行结束。该变体的构建不含这一行之后的内容，随之无法到达的场景整个不进包。其他变体的构建照原样保留这一行

- 截断点位于场景顶层。位于条件或分组内部的截断点会中止构建
- 比较 AppTag 的表达式在构建前判定，因此只有会执行的那一支进入构建。无法判定的比较会中止构建，并指出所在行
- 只被删去的行使用的文本、配音与图片一并不进包
- 变体可以指定剧情结束后显示的页面。未指定时，最后一帧留在屏幕上

A cut point row ends one variant's story at that row. A build of that variant carries nothing written after it, and a scene left unreachable is dropped from the package. Builds of every other variant carry the row as written.

- A cut point sits at the top level of a scene. One inside a condition or a group stops the build.
- A comparison against AppTag is settled before the build, so only the branch that runs is packaged. A comparison that cannot be settled stops the build and names the row.
- Text, voice and images used only by the removed rows are left out with them.
- A variant can name the page shown after its story ends. With no page named, the last frame stays on screen.

相关主题 · Related：变体 · Build variants、变体选择 · Variant selection、表达式 · Expressions、项目检查 · Project checks

### 图标 · Icons

一张源图作为应用图标，各平台的图标按各自要求的尺寸和形状从它生成；需要不同图像的平台可以单独指定

- 生成结果保存在项目中，其他设备上构建时使用同一套图标
- iOS 图标不能包含透明区域；它绘制在一个背景色上，默认为白色
- 某个平台未生成任何图标时，该平台使用 NarraLeaf 的图标

One image is the application icon, and each platform's icons are generated from it in the sizes and shapes that platform requires. A platform that needs a different image can be given its own.

- Generated icons are stored in the project, so a build on another machine uses the same set.
- An iOS icon cannot contain transparency. It is drawn on a background color, white by default.
- A platform with no generated icons builds with the NarraLeaf icon.

相关主题 · Related：构建 · Builds、资产 · Assets

### 给构建签名 · Signing a build

签名标明构建的来源；未签名的构建可以运行，但 Windows 和 macOS 首次打开时会显示安全提示；iOS 不安装未签名的包

- 凭据按平台各选一份，仅保存在本机，不随项目传递
- 构建开始之前，对话框会说明所选凭据在本机是否可用，不可用时缺少什么
- Android 未选择密钥时使用本机调试身份签名，应用商店不接受该签名

A signature states where a build came from. An unsigned build runs, but the first launch shows a security prompt on Windows and macOS, and iOS installs nothing unsigned.

- A credential is chosen per platform and stays on this machine. It does not travel with the project.
- Before the build starts, the dialog states whether the chosen credential can be used here and what is missing if it cannot.
- Android with no key chosen is signed with a local debug identity, which stores do not accept.

相关主题 · Related：构建 · Builds、资产保护 · Asset protection

详细说明 · Learn more：https://www.narraleaf.com/docs/studio

### 资产保护 · Asset protection

启用资产保护后，打包的游戏中的图片、音频、故事正文和插件代码都会加密；玩家的存档不加密；开发模式不受影响

- Web、Android 与 iOS 构建始终不启用资产保护
- 资产保护阻止用常规工具打开文件；从运行中的游戏读取仍然可行
- 本页的另一个开关决定游戏是否可以使用网络

With asset protection enabled, the images, audio, story text and plugin code inside a packaged game are encrypted. The player's saves are not. Dev Mode is unaffected.

- Web, Android and iOS builds always ship without it.
- It prevents the files from being opened with ordinary tools. Reading them from the running game is still possible.
- The other switch on this page decides whether the game may use the network.

相关主题 · Related：构建 · Builds、减小下载体积 · Reducing download size、插件 · Plugins、网络请求 · Network requests

### 网络请求白名单 · Network request allowlist

项目设置中的「网络策略」有三个位置：不允许联网、仅白名单内的地址、任意地址；选择中间一项时，可请求的范围收窄到项目列出的地址，其余请求会被拒绝，在编辑器预览与构建出的游戏中同样生效

- 只写主机表示该主机下的所有路径；要限定到主机的一部分，写 https://api.example.com/v1/*
- * 可以替换首个主机标签，例如 https://*.example.com/*
- 协议、主机与端口需完全一致；https://example.com 不覆盖 http://example.com
- 插件声明的地址列在白名单下方，同样可以请求；它们来自安装该插件时批准的内容
- Fetch 节点上直接填写、且不在白名单内的地址，会被项目检查报告，构建被拒绝；由蓝图计算得出的地址在游戏运行时被拒绝
- 插件附带的程序在游戏进程之外运行，不受白名单约束

The network policy in project settings has three positions: no network access, allowlisted addresses only, and any address. The middle one narrows the project to the addresses it lists; every other request is refused, in the editor preview and in the built game.

- A host written alone covers every path under it. Write https://api.example.com/v1/* to cover one part of a host.
- * can replace the first host label, as in https://*.example.com/*.
- The scheme, the host and the port must match exactly. https://example.com does not cover http://example.com.
- Addresses a plugin declared are listed under the allowlist and are also reachable. They are the addresses approved when the plugin was installed.
- A Fetch node whose address is written out and not covered is reported by project checks, and the build is refused. An address a blueprint computes is refused while the game runs.
- A program a plugin ships runs outside the game process. The allowlist does not cover it.

相关主题 · Related：网络请求 · Network requests、资产保护 · Asset protection、插件 · Plugins、项目检查 · Project checks

### 减小下载体积 · Reducing download size

每次构建都会在不损失画质的前提下将图像转换为更小的格式、清除文件中记录制作者的元数据，并为浏览器导出生成预压缩的文本文件。这些都不会改变游戏，也都不是设置

压缩会改变游戏，每一类素材各有一个开关

- 压缩是有损的，体积明显更小，损失的信息无法恢复
- 每个开关都对本项目构建的每一个包生效，所有平台一致
- 每一轨可以用一个质量值，也可以直接设置编码器参数；切过去时会先填入当前质量对应的值
- 项目里的文件保持导入时的样子，只有发布的副本被压缩
- 压缩后体积无明显减小的文件按原样发布，带透明通道的视频同理
- 预压缩的文本文件只有配置过的服务器会使用，其他主机发送原始文件

Every build converts images to a smaller format where that loses no detail, removes the metadata a file carries about who made it, and writes precompressed copies of the text files a browser export serves. None of that changes the game, and none of it is a setting.

Compression does change the game, and each kind of material has a switch of its own.

- Compression is lossy. It produces much smaller files, and what it drops cannot be recovered.
- Each switch applies to every package the project builds, on every platform.
- A track can be set by one quality or by the encoder's own values. Switching to the second starts from what the first was already producing.
- The project keeps the files as they were imported. Only the shipped copy is compressed.
- A file that would not come out meaningfully smaller ships unchanged, as does video carrying transparency.
- Precompressed text files are used only by a server configured to serve them. Every other host serves the originals.

相关主题 · Related：构建 · Builds、资产 · Assets

### 屏幕效果帧率 · Screen effect frame rate

雪、雨、樱花由项目烘焙生成，Project ▸ App 上的帧率决定它们每秒有多少帧

30 对下落的粒子已经足够平滑。帧率越高帧数越多，烘焙时间与占用的下载体积同比增加：120 是 30 的四倍

新的帧率在下一次烘焙时生效。已按其他帧率烘焙的效果保留在缓存中，改回该帧率时会被重新使用

作为资产导入的氛围特效素材保持原有帧率

Snow, rain and sakura are baked for the project, and the rate set on Project ▸ App is how many frames a second each one holds.

30 is smooth for falling particles. A higher rate is more frames, so the bake takes proportionally longer and the effect adds proportionally more to the download: 120 costs four times what 30 does.

A new rate applies to the next bake. Effects already baked at another rate stay in the cache and are used again if the rate is set back.

Ambience clips imported as assets keep the frame rate they were made at.

相关主题 · Related：构建 · Builds、减小下载体积 · Reducing download size、指令 · Commands

### 插件 · Plugins

插件为 Studio 添加功能：故事指令、蓝图节点、控件、测试，以及面板

- 插件声明所需权限，该清单在安装时批准
- 插件提供的内容出现在与内建同类相同的位置，并标明来源插件
- 项目记录自身依赖的插件；在未安装某个插件的设备上打开时，会说明缺少哪个插件，以及项目中哪些内容在使用它
- 已安装版本与项目所依赖版本的主版本号不同的插件在本项目中停用，直至在「项目 ▸ 应用」中点击「重新扫描」记录已安装的版本

A plugin adds capabilities to Studio: story commands, blueprint nodes, widgets, tests and panels.

- A plugin declares what it needs, and that list is approved at install time.
- What a plugin contributes appears in the same places as the built-in equivalents, marked with the plugin it came from.
- A project records the plugins it depends on. Opened on a machine that is missing one, it states which plugin is missing and what in the project uses it.
- A plugin installed at a different major version from the one the project was made with is off for the project until Rescan in Project ▸ App records the installed version.

相关主题 · Related：游戏界面 · Game screens、指令 · Commands、Studio 设置 · Studio settings

详细说明 · Learn more：https://www.narraleaf.com/docs/studio

## 检查规则 · Check rules

### 未使用的资产 · Unused asset

项目中没有任何故事中的行、页面、蓝图、角色、配音、字体列表或插件引用该资产

项目的某一部分无法读出所用的资产时，它可能用到的资产不会被列为未使用，问题改为指出该部分，包括：图片取自之前会话中粘贴的地址的控件、所属插件未加载的蓝图节点、无法打开的文档，以及带有脚本图层的蓝图。整个项目无法扫描时，重新运行检查

游戏不受影响，构建不会带上没有任何地方使用的文件；该文件仍占用项目的空间

- 删除该资产：在资产面板中右键它，选择「删除」
- 对于控件，从资产中重新选择它的图片；对于蓝图节点，安装或启用提供该节点的插件
- 需要保留暂未使用的资产时，在「项目 ▸ 项目 ▸ 项目检查」中将本规则设为「关闭」

No story row, page, blueprint, character, voice-over, font list or plugin in the project names this asset.

When part of the project cannot be read for the assets it uses, the unused assets it could be using are not listed, and a finding names that part instead: a widget whose picture was pasted as an address from an earlier session, a blueprint node whose plugin is not loaded, a document that would not open, or a blueprint with a script layer. If the whole project could not be scanned, run the check again.

Builds leave out files nothing uses, and the game is unaffected. The file still takes up space in the project.

- Delete the asset: right-click it in the Assets panel and choose Delete.
- For a widget, choose its picture again from the assets. For a blueprint node, install or switch on the plugin that provides it.
- To keep assets that are not used yet, set this rule to Off under Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 资产缺失 · Missing asset

项目中的某个位置引用了资产库中已不存在的资产，最常见的原因是该位置选定资产之后资产被删除。每个位置各报告一次，问题中写明该位置

游戏中该位置缺少该资产：图片不会绘制，声音不会播放

- 打开该位置，改选资产库中存在的资产，或删除引用缺失资产的内容
- 本次会话中删除的资产可以用「撤销」恢复，原先引用它的位置随之恢复正常
- 重新导入同一文件不能解决问题：导入得到的是新资产，该位置仍指向原来的资产

A place in the project names an asset the library no longer has. Most often the asset was deleted after the place chose it. Each place is reported once, and the finding names it.

In the game that place goes without the asset: a picture is not drawn and a sound does not play.

- Open the place and choose an asset the library has, or remove what names the missing one.
- An asset deleted earlier in this session comes back with Undo, and every place that named it works again.
- Importing the same file again does not help: an import is a new asset, and the place still names the old one.

相关主题 · Related：项目检查 · Project checks

### 无法读取的资产 · Unreadable asset

该资产的文件已不在项目文件夹中，或 Studio 没有读取它的权限；对于图片，还可能是文件已损坏，或不是 Studio 能打开的格式。只有图片会打开检查内容，模型不在检查范围内。在「属性」中显示「尚未下载」的远程资产没有文件

构建带上没有文件的资产时会出错中止；损坏的图片在使用它的位置不显示任何内容

- 为该资产换上可用的文件：在资产面板中右键它，选择「替换文件…」；使用它的位置继续有效
- 远程资产：选中后在「属性」中点击「检查更新」

The asset's file is missing from the project folder or Studio is not allowed to read it, or, for an image, the file is damaged or not in a format Studio can open. Only images are opened to check their contents, and models are not checked. A remote asset that shows Not downloaded yet in Properties has no file.

A build that carries an asset with no file stops with an error. A damaged image shows nothing where it is used.

- Give the asset a working file: right-click it in the Assets panel and choose Replace File…. Every place that uses it keeps working.
- For a remote asset, select it and choose Check for Updates in Properties.

相关主题 · Related：项目检查 · Project checks

### 过大的文件 · Large file

项目中有地方使用的文件，大小超过本项目设定的上限。上限默认为 64 MB，可在「项目 ▸ 项目 ▸ 项目检查」中本规则下方修改。检查的是项目中文件本身的大小，不计构建时的压缩；Studio 没有记录大小的文件不会被报告

不会造成故障，代价是安装包更大，玩家的下载时间更长

- 在 Studio 之外缩小文件，然后在资产面板中右键该资产，选择「替换文件…」；使用它的位置继续有效
- 「项目 ▸ 设置」中的压缩可以缩小构建中的副本，但本检查仍按项目中的文件计算
- 在「项目 ▸ 项目 ▸ 项目检查」中提高上限，或将本规则设为「关闭」

A file that something in the project uses, and that is larger than this project's limit. The limit is 64 MB unless changed under this rule on Project ▸ Project ▸ Project check. The size is that of the file in the project, before any compression a build applies, and a file whose size Studio has not recorded is not reported.

Nothing breaks. The cost is a larger package and a longer download for the player.

- Make the file smaller outside Studio, then right-click the asset in the Assets panel and choose Replace File…. Every place that uses it keeps working.
- Compression under Project ▸ Settings makes the copy in the build smaller. This check still measures the file in the project.
- Raise the limit, or set this rule to Off, under Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 播放后停止的立绘动画 · Sprite animation that stops

角色外观中使用的图片为动态 PNG（APNG），且声明了固定的播放次数。无限循环的动画（如眨眼、呼吸）不会被报告

舞台按浏览器播放图片的方式播放立绘动画，与剧情进度无关：立绘首次绘制时开始播放；立绘隐藏后再次显示时可能停在末帧而不重新播放

- 循环效果：将 APNG 导出为无限循环，然后在资产面板中右键该资产，选择「替换文件…」
- 一次性反应：改用静态图片作为角色的差分，或使用 Live2D、Spine 模型
- 如果需要画面停在末帧，可在「项目 ▸ 项目 ▸ 项目检查」中将本规则设为「关闭」

An image used in a character's appearance that is an animated PNG (APNG) declaring a fixed number of plays. Animations that loop forever, such as blinking or breathing, are not reported.

The stage plays a sprite's animation the way a browser plays an image, not in step with the story. It starts when the sprite is first drawn. When the sprite is hidden and shown again, it can stay on the last frame instead of playing again.

- For a looping effect, export the APNG with infinite loops, then right-click the asset in the Assets panel and choose Replace File….
- For a one-off reaction, use separate still images as a tag of the character, or a Live2D or Spine model.
- Set this rule to Off under Project ▸ Project ▸ Project check if the last frame is what should stay on screen.

相关主题 · Related：项目检查 · Project checks

### 未完成的资产集 · Unfinished asset set

资产集未能为每个取值恰好给出一个文件。没有自己文件的取值使用兜底取值的文件，因此只有兜底取值本身没有唯一的文件时，才会报告缺少文件。另外也会报告：对应到多个文件的取值、没有取值或没有兜底取值的资产集，以及位于按语言变化的资产集之下、按变体变化的资产集

构建要发布的内容用到该资产集、而所需的取值没有唯一的文件时，构建会中止

- 在资产面板中选中该资产集，在「属性」的「取值」下点击某个取值所在的行选择文件，或在「兜底取值」中改选一个有文件的取值
- 某行显示多个文件时，删除多余的文件，或在多余文件的「标签」中移除该取值的标签
- 在「按什么变化」中重新选择一项（包括当前项），会按项目的语言或变体重新读取取值；已删除的取值随之去掉，「兜底取值」回到第一个取值
- 位置不对的资产集：右键它，选择「解散资产集」，其中的文件保留在资产库中

An asset set that does not give exactly one file for each of its values. A value with no file of its own takes the fallback value's file, so a missing file is reported only while the fallback value has no single file. Also reported: a value more than one file answers to, a set with no values or no fallback, and a set varying by build variant placed under a set varying by language.

A build that ships something using the set stops when a value it needs has no single file.

- Select the set in the Assets panel. In Properties, click a value's row under Values to choose its file, or choose a value that has a file under Falls back to.
- Where a row shows several files, delete the extra files or remove that value's tag from them under Tags.
- Choosing an entry under Varies by, the current one included, reads the values again from the project's languages or build variants. A deleted value is dropped, and Falls back to returns to the first value.
- A set placed under the wrong kind of set: right-click it and choose Dissolve Set. Its files stay in the library.

相关主题 · Related：项目检查 · Project checks

### 无法播放的格式 · Unplayable format

Ogg 格式的音频或视频资产，按扩展名判断，并对照最近一次构建时在「构建发行包」中选择的平台检查。Ogg 音频（.ogg、.oga、.opus）针对 iOS 与 Web 报告，Ogg 视频（.ogv、.ogm、.ogx）针对所有平台报告。从未构建过的项目不做该检查

部分版本的 Safari 不播放 Ogg 音频，因此 iOS 构建、以及用 Safari 打开的 Web 构建中没有声音。Ogg 视频在所有平台上都只有声音，画面全黑

- 在 Studio 之外将 Ogg 音频转换为 .m4a 或 .mp3，再在资产面板中右键该资产，选择「替换文件…」；使用它的位置继续有效
- Ogg 视频在资产面板中标有「需要转换」，选择「转换文件…」会将它替换为可以播放的副本

An audio or video asset in the Ogg format, judged by its extension and checked against the platforms chosen in Build for distribution for the most recent build. Ogg audio (.ogg, .oga, .opus) is reported for iOS and Web, and Ogg video (.ogv, .ogm, .ogx) for every platform. A project that has never been built is not checked.

Some versions of Safari do not play Ogg audio, so the sound is silent in the iOS build and in a Web build opened in Safari. Ogg video plays its sound over a black picture on every platform.

- Convert Ogg audio to .m4a or .mp3 outside Studio, then right-click the asset in the Assets panel and choose Replace File…. Every place that uses it keeps working.
- An Ogg video is marked Needs converting in the Assets panel, and Convert File… replaces it with a copy that plays.

相关主题 · Related：项目检查 · Project checks

### 带透明通道的叠层素材 · Transparent overlay clip

氛围特效行（/vfx）所用的素材带有透明通道，且「混合模式」为「正常（不透明素材）」；仅在最近一次构建时于「构建发行包」中选择的平台包含 iOS 或 Web 时检查。设为其他混合模式的行不报告，本机无法检查的素材也不报告

iOS 以及 Web 构建中的 Safari 会忽略素材的透明度，素材的整个画面会盖住舞台。Studio、开发模式和其他平台都会显示透明效果，因此在电脑上测试时不会出现该问题

- 将素材在黑色背景上导出，并把该行的「混合模式」设为「滤色（黑底辉光素材）」；或在白色背景上导出，设为「正片叠底（白底阴影素材）」
- 所有像素都不透明的素材，可以不带透明通道重新导出；画面不变，该问题随之消失

An ambience row (/vfx) whose clip carries transparency and whose Blend is Normal (opaque clip), checked when the platforms chosen in Build for distribution for the most recent build include iOS or Web. Rows set to another blend mode are not reported, and neither are clips Studio cannot inspect on this computer.

iOS, and Safari in a Web build, ignore the clip's transparency, so its whole frame covers the stage. Studio, Dev Mode and the other platforms show the transparency, so the problem does not appear when testing on a computer.

- Export the clip on a black background and set the row's Blend to Screen (glow on black), or on white and set it to Multiply (shadow on white).
- A clip whose pixels are all opaque can be exported without transparency. The picture does not change, and the finding goes away.

相关主题 · Related：项目检查 · Project checks

### 不在白名单内的地址 · Address not on the allowlist

「网络策略」为「仅白名单内的地址」时，「发起请求」节点上写明的地址（直接填在 URL 中，或由「字符串」节点连入）不在「网络请求白名单」内。已安装插件声明的地址视为在白名单内。蓝图运行时生成的地址不在此检查，游戏发出请求时会被拒绝

存在此类节点时，无论本规则设为何种级别，构建都不会开始；游戏也会拒绝该请求

- 在「项目 ▸ 设置 ▸ 安全」的白名单中添加该地址，或添加能覆盖它的模式；协议、主机与端口需完全一致
- 地址输错时，在节点上改正
- 需要允许所有请求时，将「网络策略」设为「任意地址」

A Fetch node whose address is written out, typed into its URL or wired from a String node, and is not covered by the Network request allowlist, while Network policy is Allowlisted addresses only. Addresses declared by installed plugins count as covered. An address the blueprint assembles while it runs is not checked here, and is refused when the game requests it.

A build does not start while such a node remains, whatever this rule is set to, and the game refuses the request.

- Add the address, or a pattern covering it, to the allowlist under Project ▸ Settings ▸ Security. The scheme, host and port must match exactly.
- Correct the address on the node if it is mistyped.
- To allow every request, set Network policy to Any address.

相关主题 · Related：项目检查 · Project checks

### 无网络许可的网络节点 · Network node without network access

项目的「网络策略」为「不允许联网」时，蓝图中存在「发起请求」「读取响应文本」或「读取响应 JSON」节点。每个此类节点都会报告，没有任何连线的节点也包括在内

项目中存在此类节点时，无论本规则设为何种级别，构建都不会开始。开发模式中，「发起请求」节点的请求失败，执行转到「网络错误」输出

- 游戏不使用网络时，删除该节点
- 需要发起请求时，在「项目 ▸ 设置 ▸ 安全」中把「网络策略」设为「仅白名单内的地址」并添加地址，或设为「任意地址」

A Fetch, Read Response Text or Read Response JSON node in a blueprint, while the project's Network policy is No network access. Every such node is reported, including one nothing is connected to.

A build does not start while the project holds such a node, whatever this rule is set to. In Dev Mode a Fetch node fails and continues from its Network Error output.

- Delete the node if the game does not use the network.
- To allow requests, set Network policy under Project ▸ Settings ▸ Security to Allowlisted addresses only and add the addresses, or to Any address.

相关主题 · Related：项目检查 · Project checks

### 无法读取的故事 · Unreadable story

该故事的文件无法打开，消息中写明原因：故事格式早于当前版本 Studio 可打开的范围、由更新版本的 NarraLeaf Studio 写入，或文件已损坏、不完整

该故事无法编辑，其余检查也会跳过它，其中的问题不会列出。该问题始终为错误，在「项目 ▸ 项目 ▸ 项目检查」中没有对应的行

- 格式较新：用写入它的 NarraLeaf Studio 版本或更新的版本打开项目
- 格式较旧：在仍能读取该格式的较早版本 NarraLeaf Studio 中打开并保存该故事，再回到当前版本打开项目
- 文件损坏：用项目「版本历史」或备份中的完好副本替换它

The story's file could not be opened. The message says why: a story format older than this Studio opens, a format written by a newer NarraLeaf Studio, or a file that is damaged or incomplete.

The story cannot be edited, and the other checks skip it, so problems inside it are not listed. This problem is always an error and has no row in Project ▸ Project ▸ Project check.

- Newer format: open the project in the NarraLeaf Studio version that wrote it, or a later one.
- Older format: open and save the story in an earlier NarraLeaf Studio release that still reads it, then open the project here again.
- Damaged file: replace it with an intact copy from the project's version history or a backup.

相关主题 · Related：项目检查 · Project checks

### 无效指令 · Invalid command

以指令形式输入（以 / 或 # 开头）、提交时未能解析为指令的行。该行保留输入的原文，并注明缺少或错误的部分。已禁用的行，以及位于已禁用行之内的行，不报告

预览和开发模式会跳过该行。只要仍有未禁用的此类行，构建就会在打包前中止，与该规则的严重级别无关

- 点击该行重新打开原文，修正指令后按 Enter
- 需要保留原文时，在该行的右键菜单中选择「禁用」
- 不再需要时删除该行

A row typed as a command, starting with / or #, that did not resolve to a command when it was committed. The row keeps the text as typed, with a note saying what is missing or wrong. Disabled rows, and rows inside a disabled row, are not reported.

Preview and Dev Mode skip the row. A build stops before packaging while any such row is still enabled, whatever this rule's severity.

- Click the row to reopen its text, correct the command, and press Enter.
- To keep the text for later, choose Disable from the row's right-click menu.
- Delete the row if it is not needed.

相关主题 · Related：项目检查 · Project checks

### 标签缺失 · Missing label

/goto 行指向的标签，在同一场景中没有任何 /label 行声明。名称须完全一致，区分大小写。其他场景中的标签不计入，已禁用或位于已禁用行之内的 /label 行也不计入。未选择标签的 /goto 行同样会被报告

游戏中该 /goto 行被跳过，从下一行继续播放

- 在检查器的「跳到标签」中选择一个标签
- 在需要跳到的位置添加名称完全一致的 /label 行
- 需要前往其他场景时改用 /jump；/goto 只能在本场景内移动

A /goto row whose label no /label row in the same scene declares. Names must match exactly, letter case included. A label in another scene does not count, and neither does a /label row that is disabled or inside a disabled row. A /goto with no label chosen is reported too.

In the game the /goto is skipped, and play continues with the row after it.

- Choose a label in the row's Go to label field.
- Add a /label row with this exact name where play should land.
- To reach another scene, use /jump instead. A /goto only moves within its own scene.

相关主题 · Related：项目检查 · Project checks

### 标签重复 · Duplicate label

该 /label 行的名称已由同一场景中更早的 /label 行声明（区分大小写）。生效的是第一处声明，之后的每一处都会被报告

游戏中后面的标签行被忽略，所有指向该名称的 /goto 都跳到第一处。后面标签之下的行仍按顺序播放

- 两处应是不同的跳转目标时，在「标签名称」中为后面的标签改名，并把应跳到这里的 /goto 改为新名称
- 否则删除后面的 /label 行

A /label row whose name an earlier /label row in the same scene already declares, letter case included. The first declaration is the one that counts, and each later one is reported.

In the game the later row is dropped, and every /goto with that name lands on the first. The rows below the later label still play in order.

- If the two places are meant to be different targets, rename the later label in its Label name field and point the /goto rows meant for it at the new name.
- Otherwise delete the later /label row.

相关主题 · Related：项目检查 · Project checks

### 未使用的标签 · Unused label

同一场景中没有任何 /goto 行指向该 /label 行。标签只能由同一场景内的 /goto 到达，已禁用的 /goto 不计入。同一名称声明多次时只报告一次，位于第一处声明

游戏不受影响，该行留在场景中，不起作用

- 在需要返回或跳过的位置添加指向它的 /goto
- 标签已不再使用时删除该行
- 有意保留时，在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

A /label row that no /goto in the same scene names. Only a /goto in the same scene can reach a label, and a disabled /goto does not count. A name declared more than once is reported once, on its first row.

Nothing changes in the game. The row stays in the scene and has no effect.

- Add a /goto to it where play should go back or skip ahead.
- Delete the row if the label is left over.
- If it marks a place on purpose, set the rule to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 场景缺失 · Missing scene

/jump 行的「目标场景」未设置，或指向本故事中不存在的场景：已删除的场景，或其他故事中的场景。跳转只能到达所在故事中的场景

游戏中该跳转被跳过，从下一行继续播放

- 在检查器的「目标场景」中选择一个场景
- 需要转入其他故事时，用 /blueprint 行运行一个蓝图，由其中的「开始游戏」节点开始目标故事

A /jump row whose Target scene is not set, or names a scene this story does not have: one since deleted, or one in another story. A jump only reaches scenes of the story it is written in.

In the game the jump is skipped, and play continues with the row after it.

- Choose a scene in the row's Target scene field.
- To continue in another story, run a blueprint whose Start Game node starts that story from a /blueprint row.

相关主题 · Related：项目检查 · Project checks

### 空选择 · Empty choice

/menu 行下没有启用状态的选项，或某个选项的文本为空。选项文本中含有内联值时视为有文本

游戏中没有选项的菜单被跳过，不会显示。没有文本的选项照常列出，但上面没有文字

- 用菜单上的「添加选项」添加选项，或启用已禁用的选项
- 填写选项文本，或删除该选项
- 不需要该菜单时将其删除

A /menu row with no enabled option under it, or an option whose text is empty. An option whose text holds an inline value counts as having text.

In the game a menu with no option is skipped without being shown. An option with no text is offered with nothing written on it.

- Add options with Add option on the menu, or enable the disabled ones.
- Write the option's text, or delete the option.
- Delete the menu if it is not needed.

相关主题 · Related：项目检查 · Project checks

### 无子节点 · Dead end

该场景的最后一行不会离开场景，播放可能越过场景末尾。离开场景的行包括：不带「返回」的 /jump、/goto、/ending、/quit，以及所运行蓝图中含有「开始游戏」或「退出游戏」节点的 /blueprint 行；带「否则」的 /if 和 /menu，须每个分支都以这类行结束。被带「返回」的跳转调用的场景不报告；整个故事没有 /ending 行时，不含任何跳转的场景也不报告

播放越过末尾时故事结束，不记录结局。画面停在最后一帧，或打开「剧本结束后显示的页面」中选择的页面

- 需要继续时，在该路径末尾添加跳到下一场景的 /jump
- 故事在此结束时，以 /ending 或 /quit 结束该路径
- /if 没有「否则」分支，或某个菜单选项之后没有后续时，补上「否则」分支或结尾的行

The scene's last row does not leave the scene, so play can run past its end. A row leaves when it is a /jump without Return, /goto, /ending, /quit, or a /blueprint row whose blueprint has a Start Game or Quit Game node; an /if with Else, or a /menu, leaves only when every branch ends in one. Not reported: a scene that a jump with Return calls, and, in a story with no /ending row, a scene with no jump at all.

Where play runs off, the story ends and no ending is recorded. The last frame stays on screen, or the page chosen in Page shown when the story ends opens.

- To go on, end the path with a /jump to the next scene.
- To end the story here, end the path with /ending or /quit.
- In an /if without Else, or a menu option that runs out, add the Else branch or the closing row.

相关主题 · Related：项目检查 · Project checks

### 循环的调用 · Circular call

该 /jump 带「返回」，而它的目标场景能通过自身带「返回」的跳转，直接或经由其他场景再次调用本场景。场景调用自身同样计入。只报告闭合该循环的那一处跳转

正在等待调用返回的场景不能再次被调用，播放到该行时游戏会报错并停止

- 在该行或循环中另一处跳转上关闭「目标场景结束后返回」，使循环中有一处普通跳转
- 被调用的场景跳回本场景只是为了返回时，删除该跳转。被调用的场景播放到末尾即返回调用它的场景

A /jump with Return after the target scene, whose target can call this scene back through its own jumps with Return, directly or through other scenes. A scene that calls itself counts. Only the jump that closes the loop is reported.

A scene waiting for a call to return cannot be called again, so the game stops with an error when play reaches this row.

- Turn off Return after the target scene on this row, or on another jump in the loop, so that the loop contains a plain jump.
- If the called scene jumps back here only to return, delete that jump. A called scene returns to its caller when it reaches its end.

相关主题 · Related：项目检查 · Project checks

### 无法到达的场景 · Unreachable scene

从播放的起点出发，没有任何路径能到达该场景。播放从故事的入口场景，以及蓝图中「开始游戏」节点开始的场景出发，之后只沿未禁用的 /jump 行前进。既没有入口场景、也没有「开始游戏」进入的故事不做检查

玩家不会看到该场景

- 从可到达的场景添加一条跳到它的 /jump，或在「场景流程」中在两个场景之间拖拽
- 播放应从这里开始时，在故事面板的「场景操作」中选择「设为入口场景」，或让「开始游戏」节点指向它
- 有意保留的草稿场景，可在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

No path leads to this scene from where play begins. Play begins at the story's entry scene and at any scene a Start Game node in a blueprint starts, and goes on only through /jump rows that are not disabled. A story with no entry scene, which no Start Game starts either, is not checked.

No player sees the scene.

- Add a /jump to it from a scene play reaches, or drag between the two scenes in Scene Flow.
- If play should start here, choose Set as Entry Scene from Scene actions in the story panel, or point a Start Game node at it.
- If the scene is a draft kept on purpose, set the rule to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 空场景 · Empty scene

该场景没有会播放的行：场景为空，或其中所有行都已禁用

进入该场景后没有可执行的内容。普通跳转进入时故事随即结束，带「返回」的跳转进入时立即返回

- 编写场景内容，或启用其中的行
- 不需要该场景时，将它与跳到它的跳转一并删除
- 作为占位保留时，可在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

The scene has no rows that play: it is empty, or every row in it is disabled.

Play that arrives here has nothing to run. A plain jump to the scene ends the story there, and a jump with Return comes straight back.

- Write the scene, or enable its rows.
- If the scene is not needed, delete it together with the jumps that lead to it.
- To keep it as a placeholder, set the rule to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 未知的构建变体 · Unknown build variant

该行的某个表达式将 AppTag 与一个名称比较，例如 AppTag == "Demo" 或 AppTag != "Demo"，而项目中没有该名称的变体。名称须完全一致，区分大小写。变体改名或删除后，引用旧名称的行不会随之修改

该比较在所有构建中结果相同：== 恒为假，!= 恒为真。由 == 判断控制的内容不会进入任何构建

- 将名称改为「项目 ▸ 应用 ▸ 变体」中列出的变体
- 变体是有意删除的，则去掉该比较，或去掉依赖它的内容

An expression on this row compares AppTag with a name, as in AppTag == "Demo" or AppTag != "Demo", and no build variant has that name. Names must match exactly, letter case included. Renaming or deleting a variant does not change the rows that name it.

The comparison then has the same result in every build: == is always false and != always true. Content behind an == test is in no build.

- Change the name to a variant listed in Project ▸ App ▸ Build variants.
- If the variant was deleted on purpose, remove the comparison, or the content that depended on it.

相关主题 · Related：项目检查 · Project checks

### 结局之后的行 · Rows after an ending

该行写在同一层中的 /ending 或 /quit 行之后。同一层指场景的顶层，或某个分支、某个组的内部。每一层只报告一次，位于其后的第一行。写在内含结局的 /if 之后的行不报告，其是否播放取决于执行的分支

结局之后的行不会进入游戏，永远不会播放

- 应先播放的行，移到结局之前
- 故事只在部分情况下结束时，把结局放进 /if 的分支中
- 否则删除这些行

A row written after an /ending or /quit row in the same list, that is, the scene's top level or the inside of one branch or group. Each list is reported once, on the first such row. A row after an /if whose branch holds the ending is not reported, since whether it plays depends on the branch taken.

The rows after the ending are left out of the game and never play.

- Move the rows above the ending if they should play first.
- If the story should end only in some cases, put the ending inside an /if branch.
- Otherwise delete the rows.

相关主题 · Related：项目检查 · Project checks

### 没有页面的打开页面行 · Open page with no page

/page 行（打开页面）未指定页面，或指向本项目中已不存在的页面

该行不会打开任何页面，剧情也不会等待，因此结果变量不会被写入，读取它的 /if 总会走同一个分支

- 在该行上选择一个页面
- 页面已确定不再需要时，删除该行

A /page row (Open page) that names no page, or names a page this project no longer has.

The row opens nothing and the story does not wait, so its variable is never written and an /if that reads it always takes the same branch.

- Pick a page on the row
- Delete the row if the page is gone for good

相关主题 · Related：项目检查 · Project checks

### 没有页面的退出行 · Quit with no page

/quit 行（退出到页面）的「结束后显示的页面」未设置，或指向本项目中已不存在的页面

未设置页面时，该行不会打开任何页面，同一层中其后的行也不会播放。页面已删除时，本次游玩结束，且不会打开任何页面

- 在该行的「结束后显示的页面」中选择一个页面
- 需要结束故事并记录结局时，改用 /ending 行

A /quit row (Quit to page) whose Page shown afterwards is not set, or names a page this project no longer has.

With no page set, the row opens nothing, and the rows after it in the same list never play. With a deleted page, the playthrough ends and no page opens.

- Choose a page in the row's Page shown afterwards field.
- To end the story with an ending recorded, use an /ending row instead.

相关主题 · Related：项目检查 · Project checks

### 等待已删除的输入动作 · Wait for a missing input action

/waitinput、/hold 或 /mash 行指定的输入动作已从项目的输入设置中删除

任何输入都无法触发该动作。未设置时限时剧情停在此行；设置了时限时该行总是判定为失败

- 在该行的「输入动作」中选择一个现有动作
- 清空该字段以接受任意输入动作

A /waitinput, /hold or /mash row names an input action that has been deleted from the project's input settings.

No input can perform the action. With no time limit the story stops at this row. With a time limit the row always fails.

- Choose an existing action in the row's Input action field.
- Clear the field to accept any input action.

相关主题 · Related：项目检查 · Project checks

### 锁定段落中的对白 · Line inside a locked passage

/input lock 会使点击推进、推进键、自动播放与快进全部失效，直到执行 /input unlock 行；选项仍可正常选择

锁定段落中的对白或 /wait click 需要玩家推进，而玩家无法推进，剧情会停在该处

- 在该行之前添加 /input unlock 行
- 检查不会逐个分支分析：某个分支内的锁定或解锁也会作用于其后书写的行。在分支内锁定或解锁的段落可能被误报，也可能被漏报

/input lock stops clicking to advance, the advance key, auto-forward and skipping until an /input unlock row runs. Choices can still be picked.

A dialogue line or a /wait click inside a locked passage waits for an advance the player cannot give, and the story stops there.

- Add an /input unlock row before the line.
- Branches are not checked one at a time: a lock or unlock inside one branch also counts for the rows written after it. A passage that locks or unlocks inside a branch can be reported when it is fine, or missed.

相关主题 · Related：项目检查 · Project checks

### 同名的两个结局 · Two endings with one name

该 /ending 行的「结局名称」已被同一故事中更早的 /ending 行使用。报告的是后面的那一行，未命名的结局不参与比较

游戏仍区分这两个结局，并分别记录。重复的只是名称，列出结局的界面会显示两个相同的名称，无从区分

- 在「结局名称」中为后面的结局改名
- 两者确需同名时，可在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

An /ending row whose Ending name an earlier /ending row in the same story already uses. The later row is reported, and unnamed endings are not compared.

The game keeps the two endings apart and records each on its own. Only the name repeats, so a screen that lists endings shows it twice with no way to tell them apart.

- Give the later ending a different name in its Ending name field.
- If both should read the same, set the rule to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 没有对应变体的截断点 · Cut point with no variant

项目中没有任何变体，却存在截断点行。截断点只结束其所指变体的构建，因此该行没有可结束的构建。删除最后一个变体后，已有的截断点行即处于这种状态

该行不起作用，所有构建都包含它之后的行

- 在「项目 ▸ 应用 ▸ 变体」中添加变体，再在该行的「变体」字段中选择它
- 不需要在此结束任何变体时删除该行

A cut point row in a project that has no build variant. A cut point ends only the build of the variant it names, so this row has nothing to end. Deleting the last variant leaves existing cut point rows in this state.

The row has no effect, and every build contains the rows after it.

- Add a variant in Project ▸ App ▸ Build variants, then choose it in the row's Build variant field.
- Delete the row if no variant should end here.

相关主题 · Related：项目检查 · Project checks

### 无法到达的截断点 · Cut point out of reach

截断点行所在的场景，从播放起点出发没有任何路径能到达。播放起点为故事的入口场景，以及「开始游戏」节点开始的场景，之后沿未禁用的 /jump 行前进

没有任何一次游玩会经过该行，因此它所指变体的构建不会在此结束，该构建包含故事能到达的全部场景，与没有该行时相同

- 从可到达的场景添加跳到该场景的 /jump
- 或把截断点移到该变体应结束的场景中
- 不再需要时删除该行

A cut point row in a scene no path reaches from where play begins: the story's entry scene and any scene a Start Game node starts, followed through /jump rows that are not disabled.

No playthrough passes this row, so it never ends the build of the variant it names. That build contains every scene the story reaches, as if the row were not there.

- Make the scene reachable with a /jump from a scene play reaches.
- Or move the cut point into the scene where that variant should end.
- Delete the row if it is no longer needed.

相关主题 · Related：项目检查 · Project checks

### 不存在的舞台对象 · Missing stage object

该行操作的舞台对象，在本场景中没有任何行创建。只计算同一场景中的行，舞台对象不会从其他场景延续过来；名称须完全一致

游戏中该行没有可操作的对象，不起作用

- 在本场景中、该行之前添加创建它的行：/image、/text、/vfx、/play 或 /sound；角色用 /show 让其登场
- 图层在实时预览的「图层」视图中添加到场景的图层
- 该行本应操作已有的对象时，在检查器中改选该对象
- 名称拼写有误时改正

The row acts on a stage object that no row in this scene creates. Only rows in the same scene count, since stage objects do not carry over from another scene, and names must match exactly.

In the game the row has nothing to act on and does nothing.

- Add the row that creates it in this scene, above this one: /image, /text, /vfx, /play or /sound, or /show for a character.
- For a layer, add it to the scene's layers in the live preview's Layers view.
- If the row should act on an object that exists, choose that object in the row's inspector.
- Correct the name if it is misspelled.

相关主题 · Related：项目检查 · Project checks

### 未显示的舞台对象 · Unshown stage object

/image、/text 或 /vfx 行声明了一个对象，而本场景中没有任何 /show 行显示它。声明的对象保持隐藏，直到同一场景中的 /show 指定它。指定资产的 /show 与 /play 在同一行内声明并显示，不报告

玩家看不到该对象，该行没有可见的效果

- 在本场景中该对象应出现的位置，添加指定其名称的 /show
- 图片需要立即出现时，把该行换成指定该资产的 /show
- 不需要该对象时删除该行

An /image, /text or /vfx row declares an object, and no /show row in this scene reveals it. A declared object stays hidden until a /show in the same scene names it. /show naming an asset, and /play, declare and show in one row and are not reported.

The player never sees the object, and the row has no visible effect.

- Add a /show with the object's name in this scene, where it should appear.
- For an image that should appear at once, replace the row with a /show naming the asset.
- Delete the row if the object is not needed.

相关主题 · Related：项目检查 · Project checks

### 重复的舞台对象 · Duplicate stage object

该行以本场景中更早的行已创建过的名称创建舞台对象，对象为图片、文本、图层、氛围特效，或以不同文件播放的视频。角色与音效不报告，再次显示或播放它们属于常规用法

后面的行沿用第一行创建的对象，其自身的图片、文本和其他设置不会生效；视频播放的是第一行的文件

- 原本需要两个对象时，为该行改用其他名称
- 要更换第一个对象的图片或文本时，改用 /swap
- 否则删除该行

A row creates a stage object under a name that an earlier row in this scene already created: an image, a text, a layer, an ambience effect, or a video played from a different file. Characters and sounds are not reported, since showing or playing them again is ordinary.

The later row reuses the first object. Its own image, text and other settings are not applied, and for a video the first row's file plays.

- If two objects were meant, give this row a different name.
- To change the first object's image or text, use /swap on it instead.
- Otherwise delete this row.

相关主题 · Related：项目检查 · Project checks

### 已播放完毕的视频 · Video already finished

该 /pause、/resume、/seek 或 /stop 行操作的视频，在同一串行中更早的 /play 行会等待其播放结束，且两行之间没有再次播放它。位于 /parallel、/race、/repeat 或 /until 组内的行、位于不同分支中的行，以及中间隔着 /label 的行不报告

执行到该行时视频已播放完毕，该行不起作用

- 要让中间的行在视频播放时执行，在其 /play 行上关闭「等待播放结束」
- 视频本应先播放完毕时删除该行

A /pause, /resume, /seek or /stop row aimed at a video whose /play row, earlier in the same run of rows, waits for the video to finish, with nothing between them playing it again. Rows inside a /parallel, /race, /repeat or /until group, rows in different branches, and rows with a /label between them are not reported.

By the time this row runs the video has already finished, so the row does nothing.

- To let the rows in between run while the video plays, turn off Wait for the video on its /play row.
- If the video should play to its end first, delete this row.

相关主题 · Related：项目检查 · Project checks

### 不存在的角色 · Missing character

该行指定的角色不在本项目中：可能是 /show、/hide、/char 等角色行，也可能是文本中的「表情切换」。对白的说话人不在本规则检查范围内

游戏中该行找不到角色，不会出现任何显示或变化

- 在该行的「角色」字段中选择一个角色
- 文本中的「表情切换」，先删除，再为项目中已有的角色重新插入
- 不再需要时删除该行

The row names a character the project does not have: a character row such as /show, /hide or /char, or an Expression change inside a line of text. A dialogue line's speaker is not checked here.

In the game the row reaches no character, so nothing appears or changes.

- Choose a character in the row's Character field.
- For an Expression change inside a line, remove it and insert it again for a character the project has.
- Delete the row if it is not needed.

相关主题 · Related：项目检查 · Project checks

### 转场不可用 · Unavailable transition

该行指定的转场在当前版本的 Studio 中无法播放，消息中显示的是保存时的名称。这类行由更新版本的 Studio 保存，或指定了已移除的转场，或使用自定义转场

游戏中该处变化直接切换，不播放转场

- 在该行检查器的「转场」部分重新选择转场
- 该行由更新版本的 NarraLeaf Studio 保存时，改用该版本

The row names a transition this version of Studio cannot play, and the message shows the name as it is stored. Such a row was saved by a newer Studio, names a transition that has since been removed, or uses a custom transition.

In the game this change plays as a cut, with no transition.

- Choose a transition in the Transition section of the row's inspector.
- If a newer NarraLeaf Studio saved the row, use that version.

相关主题 · Related：项目检查 · Project checks

### 没有变化的背景 · Unchanged background

带转场的 /bg 行所设置的背景，与该行处画面上已显示的背景相同：同一张图片或同一种颜色，来自之前的 /bg 行或场景的「默认背景」。直接切换的行、背景经 /transform 改变之后的行，以及未指定图片或颜色的行不报告

玩家会看完整段转场，画面却没有任何变化

- 该行用于确定背景时（例如场景有多个入口），去掉它的转场，直接切换不占用时间
- 否则删除该行，或改选其他图片

A /bg row with a transition sets the background already on screen at this row: the same image or color, whether from an earlier /bg row or from the scene's Default background. Rows that change as a cut, rows after a /transform on the background, and rows naming no image or color are not reported.

The player watches the transition run its full length with no visible change.

- If the row is there to fix the background, for a scene entered from several places, remove its transition. A cut takes no time.
- Otherwise delete the row, or choose a different image.

相关主题 · Related：项目检查 · Project checks

### 多个轴上的同名标签 · Tag name on two axes

分层立绘角色有两个轴含有同名标签，例如「服装」与「发型」下都有「蓝」。比较名称时不区分大小写

/char 等以文本输入的行只按标签名指定外观，该名称只能指向靠前的轴上的标签；另一个标签只能在该行的「属性」中选择

- 在角色编辑器中重命名其中一个标签

A character with layered sprites has a tag of the same name on two of its axes, such as Blue under Outfit and under Hair. Names are compared ignoring case.

A typed row such as /char names a look by its tag alone, so the name reaches only the tag on the earlier axis. The other tag can be chosen only in the row's Properties.

- Rename one of the two tags in the character editor.

相关主题 · Related：项目检查 · Project checks

### 并行分支作用于同一对象 · One object in two parallel branches

同一个 /parallel 组的两个分支显示、隐藏、变换或修改同一个舞台对象。同一分支内的多行按顺序执行，不报告

各分支同时开始，但对象同一时间只执行一个动画，因此无法同时进行。运行时这些分支依次执行，组的总时长为各分支时长之和

- 将该行移出该组，放在组之前或之后
- 需要同时修改该对象的多项属性时，写在同一个 /transform 行中

Two branches of one /parallel group show, hide, transform or change the same stage object. Rows inside one branch run in order and are not reported.

The branches start at the same time, but the object takes one animation at a time, so they cannot run side by side. When the game plays, these branches run one after another, and the group takes as long as their durations added together.

- Move this row out of the group, before or after it.
- To change several properties of the object at once, write them on one /transform row.

相关主题 · Related：项目检查 · Project checks

### 目标缺失 · Missing target

节点选定的页面、故事、场景、选项、结局、角色、翻译键、DLC 或输入意图在项目中已不存在，通常是它已被删除，或节点是从另一个项目粘贴而来。只检查在节点上选定的值；同名输入已有连线、或未选定任何值的节点不报告

节点运行时找不到该对象：「前往页面」「叠加页面」中止且不打开页面，「开始游戏」不会开始，「DLC 是否已安装」这类判断始终为 false，「意图触发时」不会触发

- 在节点上改选项目中存在的对象
- 不再需要该节点时，将其删除

A node names a page, story, scene, choice, ending, character, translation key, DLC or input action that the project no longer has, usually after it was deleted, or after the node was pasted from another project. Only a value picked on the node is checked: a node whose input of the same name is wired, or that has nothing picked, is not reported.

When the node runs, it finds nothing under that name. Go Page and Show Layer stop without opening a page, Start Game does not start, a check such as Is DLC Installed answers false, and an On Action head never runs.

- Pick something the project has in the node's field.
- Delete the node if it is no longer needed.

相关主题 · Related：项目检查 · Project checks

### 控件缺失 · Missing widget

「元素」「元素点击」或「元素刷新」节点绑定的控件在项目中已不存在：删除控件时仍有蓝图指向它，或节点是从另一个项目粘贴而来

该绑定在游戏中不起作用：「元素点击」「元素刷新」不会触发，读取该元素的节点没有可操作的控件

- 把节点重新绑定到项目中存在的控件；在「元素」卡片上，点击显示「元素缺失」的方框
- 不再需要该节点时，将其删除

An Element, Element Click or Element Flush node is bound to a widget the project no longer has. The widget was deleted while blueprints still named it, or the node was pasted from another project.

The binding does nothing in the game: Element Click and Element Flush never run, and nodes that read the Element have no widget to act on.

- Bind the node to a widget the project has. On an Element card, click the box that reads Missing element.
- Delete the node if it is no longer needed.

相关主题 · Related：项目检查 · Project checks

### 函数缺失 · Missing function

「调用函数」节点调用的函数在该蓝图中无法访问：函数已被删除，或该调用是从能访问它的蓝图复制过来的。应用逻辑上的函数可被所有蓝图调用；页面或该页面控件上的函数只能在该页面内调用；组件内的函数只能在该组件内调用。未选择函数的「调用函数」节点不报告

执行到该调用时，整条链在此中止，其后连接的节点都不会执行

- 在「调用函数」节点的「函数」中重新选择；列表只列出该蓝图可以调用的函数
- 需要在多个页面中调用同一个函数时，在应用逻辑上创建该函数
- 不再需要该调用时，删除该节点

A Call Fn node calls a function this blueprint cannot reach: the function was deleted, or the call was copied from a blueprint that can reach it. A function on App logic can be called from every blueprint, one on a page or on a widget of that page only from that page, and one in a component only from inside that component. A Call Fn with no function picked is not reported.

When a chain reaches the call, it stops there, and nothing wired after it runs.

- On the Call Fn node, pick a function under Function. The list shows only the functions this blueprint can call.
- To call one function from several pages, create it on App logic.
- Delete the node if the call is no longer needed.

相关主题 · Related：项目检查 · Project checks

### 无法到达的节点 · Unreachable node

该节点带有执行输入，但所在图层中没有任何事件头或「函数」节点沿决定执行顺序的连线通向它。同一条链只报告第一个节点；只产出值的节点，以及完全没有事件头或「函数」节点的图层，不报告

该节点及其后连接的节点都不会执行

- 从事件头或会执行的节点引一条决定执行顺序的连线到该节点
- 该链是此前遗留的内容时，将其删除

A node with an execution input that nothing leads to: no event head or Fn node in its layer reaches it along the wires that set the order of execution. Only the first node of such a chain is reported. Nodes that only produce values, and layers with no event head or Fn node at all, are not reported.

The node and every node wired after it never run.

- Wire it into the order of execution from an event head or from a node that runs.
- Delete the chain if it is left over from earlier work.

相关主题 · Related：项目检查 · Project checks

### 没有守卫的 DLC 入口 · Unguarded DLC entrance

「开始游戏」节点选定的故事属于某个 DLC（故事的「所属」为该 DLC），而它所在的图层中没有选定该 DLC 的「DLC 是否已安装」节点。只检查「开始游戏」所在的图层；故事由连线传入时不检查

开发模式包含全部故事，该入口在开发模式中正常；在未安装该 DLC 的发布版游戏中，该故事不在游戏内，开始会失败

- 在同一图层中添加选定该 DLC 的「DLC 是否已安装」，在「开始游戏」之前判断它的结果，例如接入「如果」
- 已在其他位置检查时，例如 DLC 未安装时菜单隐藏该入口，在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

A Start Game node picks a story that belongs to a DLC (the story's Belongs to names the DLC), and its layer has no Is DLC Installed node set to that DLC. Only the layer the Start Game node is in is looked at, and a story passed in by a wire is not checked.

Dev Mode carries every story, so the control works there. In a released game without the DLC, the story is not in the game and starting it fails.

- In the same layer, add Is DLC Installed for that DLC and test its answer, for example with If, before Start Game.
- If the check is made elsewhere, such as a menu that hides the entry while the DLC is missing, set this rule to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 空事件 · Empty event

图层不会执行任何内容：图层中没有节点，或所有事件头之后都没有连接任何节点。有节点但没有事件头的图层由蓝图编辑器报告，不在此列

事件发生时不执行任何内容；「鼠标点击」图层为空的按钮，按下后没有任何反应

- 把要执行的节点连接到事件头之后
- 不需要该图层时，在「图层」列表中用「删除图层…」将其删除

A layer that runs nothing: it has no nodes, or nothing is wired to run after any of its event heads. A layer that has nodes but no event head is reported by the blueprint editor instead.

When the event happens, nothing runs. A button whose Mouse Click layer is empty does nothing when pressed.

- Wire the nodes that should run after the event head.
- Delete the layer with Delete layer… in the Layers list if it is not needed.

相关主题 · Related：项目检查 · Project checks

### 未知的节点类型 · Unknown node type

节点的类型来自本项目未加载的插件：插件未安装、已禁用、已为本项目停用或加载失败。画布将该节点显示为「未知节点」，并保留其设置与连线

该节点不会在游戏中运行，执行到它的链在此中止

- 在插件面板中安装或启用该插件；「项目 ▸ 应用 ▸ 依赖」列出本项目使用的插件及各自的状态
- 不再使用该插件时，删除该节点

A node's type comes from a plugin that is not loaded in this project: it is uninstalled, disabled, off for this project, or failed to load. The canvas shows the node as Unknown node and keeps its settings and connections.

The node does not run in the game, and a chain that reaches it stops there.

- Install or enable the plugin in the plugins panel. Project ▸ App ▸ Dependencies lists the plugins this project uses and the state of each.
- Delete the node if the plugin is no longer used.

相关主题 · Related：项目检查 · Project checks

### 运行时生成的资产名称 · Asset name assembled at run time

资产输入（节点上的引脚，或绑定到蓝图值的控件属性）收到的资产名称在游戏运行时生成：由「拼接」或「格式化」组成、由玩家输入或从服务器收到的文字，直接传入，或经由变量、列表行、函数、页面属性传入。名称来自所属插件未加载的节点时也会报告

游戏包只带项目中写明名称的资产，发布后的游戏中缺少该资产；开发模式包含全部资产，在开发模式中可以看到它。存在该问题时构建会被拒绝，与该规则的级别无关

- 在资产选择器中选择资产
- 资产需要变化时，把在资产选择器中选好的资产放进列表行或变量，再从那里读取
- 名称来自插件节点时，在插件面板中安装或启用该插件，然后重新构建

An asset input, on a node or on a widget property bound to a Blueprint Value, receives a name the game puts together while it runs: text built with Concat or Format, typed by the player, or received from a server, directly or through a variable, a list row, a function or page props. A name that comes from a node whose plugin is not loaded is reported too.

A game package carries only the assets whose names are written in the project, so the asset is missing from the released game. Dev Mode carries every asset and shows it. A build is refused while this stands, whatever this rule is set to.

- Choose the asset in the asset picker.
- Where the asset has to vary, keep assets chosen in the picker in a list row or a variable, and read the asset from there.
- For a name from a plugin's node, install or enable the plugin in the plugins panel, then build again.

相关主题 · Related：项目检查 · Project checks

### 无法到达的页面 · Unreachable page

没有任何位置打开该页面：它不是入口页面，没有蓝图节点选定它（例如「前往页面」「叠加页面」「退出游戏」），没有页面控件显示它，没有 /quit 或 /ending 行指定它，项目与各构建变体也未将它设为剧本结束后显示的页面。游戏 UI 不在检查范围内

玩家无法打开该页面

- 从蓝图打开：添加「前往页面」，或用「叠加页面」在当前页面之上显示，并选定该页面
- 用页面控件把它显示在另一个页面中
- 游戏应从该页面开始时，对它使用「设为入口页面」
- 不需要该页面时，将其删除

A page nothing opens: it is not the entry page, no blueprint node picks it (Go Page, Show Layer and Quit Game are examples), no Page widget shows it, no /quit or /ending row names it, and neither the project nor a build variant shows it when the story ends. Game UI is not checked.

No player can open the page.

- Open it from a blueprint: add Go Page, or Show Layer to show it over the current page, and pick this page.
- Show it inside another page with a Page widget.
- If the game should start on it, use Set as Entry Page on it.
- Delete the page if it is not needed.

相关主题 · Related：项目检查 · Project checks

### 未绑定行为的按钮 · Button with no handler

页面上的按钮按下后不执行任何内容。没有任何事件头响应它的点击：它自己或包含它的控件的蓝图中没有「鼠标点击」事件头，没有指向它的「元素点击」事件头，它所在的列表也没有「项点击」事件头。开启了「禁用交互」的按钮和组件中的按钮不检查

玩家可以按下该按钮，但没有任何反应

- 从属性中打开该按钮的蓝图，添加「鼠标点击」事件头，并在其后连接要执行的节点
- 按钮不应响应点击时，在「行为」中开启「禁用交互」

A button on a page that runs nothing when pressed. Nothing answers its click: no Mouse Click head in its own blueprint or in that of a widget containing it, no Element Click head naming it, and no Item Click head on a list it sits in. Buttons with Interaction disabled, and buttons inside a component, are not checked.

The player can press the button and nothing happens.

- Open the button's blueprint from its properties, add a Mouse Click head, and wire what should run after it.
- If the button should take no clicks, turn on Interaction disabled under Behavior.

相关主题 · Related：项目检查 · Project checks

### 未知的控件类型 · Unknown widget type

控件的类型来自本项目未加载的插件：插件未安装、已禁用、已为本项目停用或加载失败。画布将其显示为「未知控件」，并保留其设置

游戏中不绘制该控件，而是在其位置显示一个标明类型的警告框；其中的子控件仍会绘制

- 在插件面板中安装或启用该插件；「项目 ▸ 应用 ▸ 依赖」列出本项目使用的插件及各自的状态
- 不再使用该插件时，删除该控件

A widget's type comes from a plugin that is not loaded in this project: it is uninstalled, disabled, off for this project, or failed to load. The canvas draws it as Unknown widget and keeps its settings.

In the game the widget is not drawn. A warning box naming its type takes its place, and widgets inside it are still drawn.

- Install or enable the plugin in the plugins panel. Project ▸ App ▸ Dependencies lists the plugins this project uses and the state of each.
- Delete the widget if the plugin is no longer used.

相关主题 · Related：项目检查 · Project checks

### 缺失的组件 · Missing component

组件放置处对应的组件不在组件库中：删除组件时仍有放置处，或放置处是从另一个项目粘贴而来

该放置处在画布和游戏中都显示为占位框，而不是组件

- 删除该放置处，再从组件库放置一个组件代替它
- 组件是误删时，撤销该删除

A placement of a component that is not in the Component Library: the component was deleted while placements remained, or the placement was pasted from another project.

The placement draws a placeholder box instead of the component, on the canvas and in the game.

- Delete the placement, and place a component from the Component Library in its place.
- If the component was deleted by mistake, undo the deletion.

相关主题 · Related：项目检查 · Project checks

### 缺失的嵌入页面 · Missing embedded page

页面控件的「页面」指向项目中不存在的页面：删除页面时该控件仍在显示它，或该控件是从另一个项目粘贴而来。未选择页面的页面控件不报告；组件内的页面控件在该组件下报告一次

该页面控件在画布和游戏中都显示占位框，而不是页面

- 选中该页面控件，在「页面」中选择页面
- 此处不需要显示内容时，删除该页面控件

A Page widget's Page names a page the project does not have: the page was deleted while this widget still showed it, or the widget was pasted from another project. A Page widget with no page chosen is not reported. One inside a component is reported once, under the component.

The Page widget draws a placeholder box instead of a page, on the canvas and in the game.

- Select the Page widget and choose a page under Page.
- Delete the Page widget if nothing should be shown there.

相关主题 · Related：项目检查 · Project checks

### 循环的嵌入页面 · Circular embedded page

页面控件显示的页面，经由其中的页面控件或放置的组件，又会绘制该页面控件。环路上的每个页面控件都在各自所在处报告

游戏在环路闭合处显示占位框；出现在哪个页面控件上，取决于玩家先打开哪个页面

- 在环路上任一页面控件的「页面」中改选其他页面；页面选择器中标有「会绕回此处」的页面仍会构成环路
- 也可以删除环路上的一个页面控件

A Page widget shows a page that, through its own Page widgets or the components placed on it, draws this Page widget again. Every Page widget on the loop is reported where it is.

The game draws a placeholder box where the loop closes. Which Page widget gets it depends on which page the player opens first.

- On one Page widget of the loop, choose another page under Page. In the page picker, a page marked leads back here would close the loop again.
- Or delete one Page widget of the loop.

相关主题 · Related：项目检查 · Project checks

### 缺失的条目字段 · Missing item field

控件显示的条目字段未在绘制它的列表中声明：该字段已从列表的「字段」中删除，列表换成了其他字段，或控件是从字段不同的列表粘贴而来。不在任何列表中、却绑定了条目字段的控件也会报告

控件显示其原本写入的值，而不是每一行的值，因此每一行都显示相同的内容

- 选中该控件，在「字段」中选择列表已有的字段，或选择「不绑定字段」
- 也可以在「编辑内容」中把该字段加回列表的「字段」
- 控件已不在任何列表中时，把它移回列表的「项模板」后在「字段」中修改，或将其删除

A widget shows an item field that the list drawing it does not declare: the field was removed from the list's Fields, the list was given other fields, or the widget was pasted from a list with different fields. A widget bound to an item field that is not inside any list is reported too.

The widget shows the value it was written with instead of each row's, so every row shows the same thing.

- Select the widget and choose a field the list has under Field, or No field.
- Or add the field to the list's Fields, under Edit content.
- A widget outside every list: move it back into a list's Item template, where Field can be changed, or delete it.

相关主题 · Related：项目检查 · Project checks

### 未声明的页面参数 · Undeclared page param

列表的运行时项目来自页面属性，所用的名称不在页面属性「参数」中。打开该页面的节点和页面控件只为已声明的参数传值，不会传入这一项，因此游戏中该列表没有任何行

- 在页面属性的「参数」中声明同名参数
- 或在列表的「内容」中改选页面已声明的参数

A list whose runtime items come from a page prop names a prop the page does not list under Params in its properties. The nodes and Page widgets that open the page give a value for each declared param and none for this one, so the list shows no rows in the game.

- Declare a param with this name under Params in the page's properties.
- Or pick one of the page's params in the list's Content section.

相关主题 · Related：项目检查 · Project checks

### 未知的页面参数 · Unknown page param

该控件显示的页面声明了参数，而控件传入的值所用的名称不在其中，通常是页面上的参数改了名或被移除。这个值不会被读取，原本要传给的参数取默认值

- 在控件的「参数」中按参数的当前名称重新填写
- 或从控件的属性中移除这个值

The page this widget shows declares its params, and the widget gives a value under a name that is not one of them, usually because the param was renamed or removed on the page. The value reaches nothing, and the param it was meant for reads its default.

- Give the value again under the param's current name, in the widget's Params.
- Or remove it from the widget's props.

相关主题 · Related：项目检查 · Project checks

### 不存在的页面文字参数 · Missing page text param

文本或按钮在「页面参数」中选择的参数，页面没有声明为「文字」参数：该参数已删除或改为其他类型，或控件是从另一个页面复制过来的。不在页面上的控件（组件内、游戏 UI 上）没有页面参数可显示

游戏中此处不显示文字，页面的编辑画布中仍绘制其示例文字

- 在页面属性的「参数」中添加「文字」参数，或把该参数的「类型」改为「文字」
- 选中该控件，在「页面参数」中选择一个「文字」参数，或选择「不绑定参数」以显示控件自己的文字

A text or button shows a param, chosen under Page param, that the page does not declare as a Text param: it was removed or changed to another type, or the widget was copied from another page. A widget that is not on a page - inside a component, on a Game UI - has no page params to show.

The game shows no words there, while the page's canvas still draws the widget's sample text.

- In the page's Params, add a Text param, or set the param's Type to Text.
- Select the widget and choose a Text param under Page param, or No param to show the widget's own words.

相关主题 · Related：项目检查 · Project checks

### 与页面参数不符的列表 · List not matching its page param

列表的运行时项目来自页面参数，而该参数的类型既不是「列表」也不是「JSON」，或者其「行结构」缺少列表「编辑内容」中的字段（名称和类型都须一致）

参数不是列表时，游戏中该列表没有任何行；缺少字段时，「项模板」中绑定这些字段的控件在每一行都显示其原本写入的值

- 在页面属性的「参数」中把该参数的「类型」改为「列表」，并选择与列表一致的「行结构」
- 或在列表的「编辑内容」中把「结构」改为该参数的行结构

A list whose runtime items come from a page param reads one whose Type is neither List nor JSON, or whose Row struct lacks fields the list's content declares (same name and type).

If the param is not a list, the list shows no rows in the game. If fields are missing, the widgets in the Item template bound to them show the value they were authored with in every row.

- In the page's Params, set the param's Type to List and pick the Row struct the list uses.
- Or, in the list's Edit content, set Struct to the param's row struct.

相关主题 · Related：项目检查 · Project checks

### 不存在的文字参数 · Missing text parameter

组件内的文本或按钮在「参数」中选择的参数，组件没有声明为「文字」参数：该参数已删除或改为「字符串」，或控件是从另一个组件复制过来的。页面上显示组件参数的文本或按钮（通常是从组件中粘贴出来的）也会报告

该组件的每个放置处在此控件中都不显示文字，而组件编辑器中仍绘制其示例文字；在页面上，游戏中此处不显示文字

- 在组件的「参数」中添加「文字」参数，或把该参数的「类型」改为「文字」
- 选中该控件，在「参数」中选择一个「文字」参数，或选择「不绑定参数」以显示控件自己的文字
- 页面上没有可显示的参数：删除该控件，放置一个带有自己文字的新控件

A text or button inside a component shows a parameter, chosen under Parameter, that the component does not declare as a Text parameter: it was removed or changed to String, or the widget was copied from another component. A text or button on a page that shows a component parameter, usually pasted out of a component, is reported too.

Every placement of the component shows no words in that widget, while the component editor still draws its sample text. On a page, the game shows no words there.

- In the component's Params, add a Text parameter, or set the parameter's Type to Text.
- Select the widget and choose a Text parameter under Parameter, or No parameter to show its own words.
- On a page there is no parameter to show: delete the widget and place a new one with words of its own.

相关主题 · Related：项目检查 · Project checks

### 不会翻译的列表内容 · Untranslated list content

项目有第二种语言时，页面上的列表显示写在自身内容中的行，其「项模板」中的文本显示行中的文字，而行中的文字在译表中没有对应的行。每个列表只报告一次，并给出其中第一段文字。「运行时项」不是「列表内容」的列表，以及由蓝图填充或被蓝图引用的列表，不报告

各行在所有语言中都按原文显示

- 文字需要随语言变化时，在列表的蓝图中用「设置列表内容」填充各行，文字取自「翻译键文本」
- 文字在所有语言中都相同时（例如角色名），在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

In a project with a second language, a List on a page shows rows written into its own content, and a text in its Item template shows words from those rows. Those words have no row in the translation table. Each list is reported once, with its first such words. Lists whose Runtime items is not List content, and lists that a blueprint fills or refers to, are not reported.

The rows show the words as written, in every language.

- For words that should follow the language, fill the rows from the list's blueprint with Set List Content, taking the words from Translation Key Text.
- For words that read the same in every language, such as character names, set this rule to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 不存在的翻译键 · Missing translation key

控件的文字来源为「翻译键」，而它指定的键不在项目中。在 Studio 中删除键时，使用该键的控件会改为持有键的文字，因此该问题通常出现在项目文件于 Studio 之外被修改之后。检查范围包括页面和组件中的文本、按钮，以及组件放置处的「文字」参数

游戏中该控件在文字的位置显示键名

- 在「翻译键」中选择项目已有的键
- 也可以用「新建键…」创建同名的键，并填写其「源文本」
- 或者选择「直接输入」，在控件上输入文字

A widget's words are set to Translation key, and the key it names is not in the project. Removing a key in Studio gives its widgets the key's words, so this usually follows a change made to the project's files outside Studio. Texts, buttons and the Text parameters of component placements are checked, on pages and inside components.

In the game the widget shows the key's name in place of its words.

- Under Translation key, pick a key the project has.
- Or use Create new key… to create a key with this name, and write its source text.
- Or choose Direct and write the words on the widget.

相关主题 · Related：项目检查 · Project checks

### 被响应两次的手势 · Gesture answered twice

该页面响应一个绑定到鼠标手势（单击、双击、右键单击或滚轮）的输入意图，而页面上的某个控件用自己的事件头响应同一手势：「鼠标点击」「鼠标双击」「右键点击」或「鼠标滚轮」。该控件不是按钮这类可操作的控件，也不在其中；在可操作的控件之上，页面的意图不会触发

在该控件上执行该手势时，控件自己的事件头和页面的意图都会执行。这可能是有意为之，例如点击时控件播放音效、页面同时推进

- 只应由控件响应时，把它放进一个按钮，或改用按钮
- 只应由页面响应时，从控件的蓝图中删除该事件头
- 两者都应响应时，在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

The page answers an input action bound to a mouse gesture (click, double click, right click or the wheel), and a widget on the page answers the same gesture with a head of its own: Mouse Click, Mouse Double Click, Right Click or Mouse Wheel. The widget is not a control such as a button, and is not inside one. Over a control, the page's action does not fire.

One gesture on the widget runs both its own head and the page's action. That can be intended, such as a click that plays a sound on the widget and also advances the page.

- If only the widget should answer, place it inside a Button, or use a Button in its place.
- If only the page should answer, remove the head from the widget's blueprint.
- If both should answer, set this rule to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 未填写的存档字段 · Empty save field

会执行的「保存游戏」节点上，项目的某个存档字段为空：节点上该字段的引脚既没有连线，也没有在卡片上填写值。卡片上填写的值即使是空文本也算已填写。存档字段在存档节点卡片上的「存档字段」中声明，每个「保存游戏」节点都为每个字段提供一个引脚

本次存档写入该字段的默认值；通过「获取存档元数据」读取该字段的存档界面，会为该存档槽显示默认值

- 把值连接到「保存游戏」上该字段的引脚，或在卡片上填写
- 不再使用该字段时，在「存档字段」中将其删除

A Save Game node that will run leaves one of the project's save fields empty: the field's pin on the node has no wire and no value typed on the card. A value typed on the card counts even when it is empty text. Save fields are declared under Save fields on a save node's card, and every Save Game node has a pin for each of them.

The save is written with the field's default, and a save screen that reads the field through Get Save Metadata shows the default for that slot.

- Wire the value into the field's pin on Save Game, or type it on the card.
- If the field is no longer used, remove it under Save fields.

相关主题 · Related：项目检查 · Project checks

### 未连接的输入 · Empty input

会执行的节点上，有必填输入既没有连线，也没有在卡片上填写值。事件头通向的节点会执行，输出被会执行的节点读取的节点也会执行。节点标为可选的输入不报告；两个输入任填其一即可时，只报告一次。消息中的节点名与引脚名为英文

节点执行时该输入没有值：视节点而定，或者没有任何效果，例如未连接元素的「设置文本」，或者整条链在此中止

- 给该引脚连接一个值，或在卡片上填写
- 该节点不应执行时，将其从链上断开或删除

A node that will run has a required input with no wire and no value typed on the card. A node will run when an event head leads to it, or when a node that runs reads its output. Inputs the node marks optional are not reported, and where either of two inputs will do, the pair is reported once.

When the node runs, the input has no value. Depending on the node, it does nothing, as Set Text with no Element does, or the chain stops at it.

- Wire a value into the pin, or type one on the card.
- If the node should not run, disconnect it from the chain or delete it.

相关主题 · Related：项目检查 · Project checks

### 字段不存在 · Field not in shape

「获取字段」使用的字段不在它读取的结构中，或「数组按键筛选」「数组按键排序」「数组按键查找」的「键」不是数组中各项的字段。删除列表的字段，或手动填写键之后会出现这种情况。只检查会执行的节点，并且只检查值的结构已知的节点

节点执行时读不到值：「获取字段」得到空值，「数组按键筛选」不保留任何项，「数组按键排序」不改变顺序

- 在节点的「字段」列表中重新选择字段
- 数组节点在卡片的「键」列表中选择

A Get Field node names a field that the struct it reads does not have, or the Key of Array Filter By Key, Array Sort By Key or Array Find By Key names a field the items do not have. This happens after a list's field is deleted, or when a key is typed by hand. Only nodes that will run are checked, and only where the shape of the value is known.

When the node runs, it reads nothing: Get Field gives an empty value, Filter By Key keeps no items, and Sort By Key leaves the order as it was.

- Pick the field again from the node's Field list.
- On an array node, pick the key from the Key list on the card.

相关主题 · Related：项目检查 · Project checks

### 缺失的页面参数 · Missing page param

「获取页面参数」节点所选的参数，不在该蓝图所属页面声明的参数中：参数已被移除，或节点是从另一个页面的蓝图复制过来的。只检查会执行的节点

该节点读不到任何值

- 在节点上改选页面已声明的参数
- 或在页面属性的「参数」中重新声明该参数

A Get Page Param node names a param that the page its blueprint belongs to does not declare: the param was removed, or the node was copied from another page's blueprint. Only nodes that will run are checked.

The node reads nothing.

- Pick one of the page's params on the node.
- Or declare the param again under Params in the page's properties.

相关主题 · Related：项目检查 · Project checks

### 列表字段不一致 · List fields do not match

「设置列表内容」「追加列表项」等列表节点收到的行缺少列表声明的字段，或字段类型不同，例如把存档连入「结构」为「结局」的列表。只检查会执行的节点，并且只检查两边结构都已知的节点

列表按自己的字段显示每一行，行中没有的字段显示为空

- 在「编辑内容」中把列表的「结构」改为连入的结构
- 或连入与列表结构相同的行

Set List Content, Append List Item or another list node is given rows that lack fields the list declares, or carry them as another type - for example saves wired into a list whose Struct is Ending. Only nodes that will run are checked, and only where both shapes are known.

The list draws each row from its own fields, so the fields the rows do not carry show empty.

- Set the list's Struct, under Edit content, to the shape wired in.
- Or wire in rows of the list's shape.

相关主题 · Related：项目检查 · Project checks

### 来自另一个故事的场景 · Scene from another story

「开始游戏」节点选定的场景属于另一个故事，而不是节点选定的故事，例如在已选好场景的节点上更换了故事。故事或场景由连线传入的节点不检查；项目中已不存在的故事或场景按「目标缺失」报告

节点执行时无法从该场景开始故事，游戏不会开始

- 在「开始游戏」节点上重新选择场景；列表只列出所选故事中的场景
- 也可以把故事改为消息中指出的、包含该场景的故事

A Start Game node's Scene belongs to another story than the one its Story names, for example after the Story was changed on a node whose Scene was already picked. A node with a wire into Story or Scene is not checked, and a story or scene the project no longer has is reported as a missing target instead.

When the node runs, the story cannot start from that scene, and the game does not start.

- On the Start Game node, pick the Scene again. The list shows only the scenes of the chosen Story.
- Or pick, as the Story, the one the message names as holding the scene.

相关主题 · Related：项目检查 · Project checks

### 未声明的变量 · Undeclared variable

某一行读取或设置的变量，在该行所在的位置没有声明。场景变量须在同一场景中由 /local 行声明；存档变量与持久变量须存在于「变量」面板中。已禁用的行不检查

游戏中该变量在此处没有值：设置它的行被跳过，读取它的位置得到空值

- 变量已被删除：撤销该删除；或重新声明一个变量，并在每一处使用它的行中重新选择。新建的同名变量不会被自动采用
- 该行来自其他场景：/local 变量只属于声明它的场景。在本场景中用 /local 声明，或改用存档变量，再在该行中重新选择

A row reads or sets a variable that is not declared where the row is. A scene variable needs a /local row in the same scene; a saved or persistent variable needs an entry in the Variables panel. Disabled rows are not checked.

In the game the variable has no value there: a row that sets it is skipped, and anything that reads it gets no value.

- The variable was deleted: undo the deletion, or declare a new one and select it again in each row that uses it. A new variable with the same name is not picked up by itself.
- The row came from another scene: a /local variable belongs to its own scene. Declare one here with /local, or use a saved variable, and select it again in the row.

相关主题 · Related：项目检查 · Project checks

### 未使用的变量 · Unused variable

该变量已声明，但没有任何行或蓝图读取或设置它，已禁用的行也算在内。/local 变量只统计所在场景的行；存档变量与持久变量统计所有故事。「变量」面板中定义的变量按项目报告

游戏中没有任何内容依赖该变量

- 不再需要时，删除它的 /local 行，或在「变量」面板中使用「删除变量」
- 其他场景的行无法使用 /local 变量；多个场景共用的值应改用存档变量
- 若是为尚未编写的行预先声明，可在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

No row and no blueprint reads or sets this declared variable, disabled rows included. A /local variable counts only the rows of its own scene; a saved or persistent variable counts every story. A variable from the Variables panel is reported against the project.

Nothing in the game depends on it.

- If it is left over, remove its /local row, or use Delete variable in the Variables panel.
- Rows in other scenes cannot use a /local variable. For a value several scenes share, use a saved variable.
- If it is declared ahead of rows still to be written, set the rule to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 变量重名 · Variable name collision

同一名称属于两个不同的存档变量（或两个不同的持久变量）：一个在「变量」面板中定义，另一个由故事中的某一行声明

使用该名称的每一行各自绑定其中之一，名称本身无法区分，因此看似共用一个值的几行，实际可能在读写两个不同的值

- 为其中一个改名：「变量」面板中的变量，或故事中的声明行
- 若两者本应是同一个变量，删除该声明行，并在原先使用它的行中重新选择保留下来的变量

One name belongs to two different saved variables, or two different persistent variables: one defined in the Variables panel and one declared by a row in a story.

Each row that uses the name is bound to one of the two, and the name does not say which, so rows that seem to share a value can read and write separate ones.

- Rename one of them: the variable in the Variables panel, or the declaration row.
- If they are meant to be one variable, delete the declaration row and select the remaining variable again in the rows that used it.

相关主题 · Related：项目检查 · Project checks

### 没有路径能满足的条件 · Condition no path can satisfy

在该行处，变量所有可能的取值都无法使条件成立。只检查数字变量与写明的数字之间的比较，例如 affection >= 50。持久变量的值从上一局延续，不做检查。问题中给出的范围由变量的默认值，以及到达该行之前故事可能做出的全部改动得出

游戏中该条件始终不成立：/if 分支永远不会执行，/until 永远不会因它结束循环，选项永远不会因它被隐藏或禁用

- 修改条件要求的数值，或修改通往此处的路线所增加的量，使条件可以成立
- 在「场景流程」中，从显示「不聚焦变量」的列表里选择该变量：各场景会显示到达时的取值范围，各分支会显示它带来的改动
- 若该条件有意永不成立，可在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

No value the variable can have at this row makes the condition true. Only comparisons of a number variable with a written number are checked, such as affection >= 50. Persistent variables carry their value over from the previous run and are not checked. The range in the finding counts the variable's default and every change the story can make before this row.

In the game the condition is always false: an /if branch never runs, an /until never ends its loop, and an option is never hidden or disabled by it.

- Change the number the condition asks for, or what the routes leading here add, so that the condition can hold.
- In Scene Flow, choose the variable in the list showing No variable focus: each scene then shows the range it is reached with, and each branch what it adds.
- If the condition is meant never to hold, set the rule to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 永远不会变的条件 · Condition nothing can change

条件判断读取的变量，在整个项目中没有任何地方设置：任何故事中都没有设置它的 /set、/inc、/dec 或 /toggle 行（已禁用的行也没有），也没有设置它的蓝图节点。条件指 /if、/until，以及选项的「隐藏条件」与「禁用条件」；问题标在第一处条件上，并给出条件总数

该变量在整个游戏中始终保持默认值，这些条件每次判断的结果都相同

- 在剧情需要的位置添加设置它的行，例如在介绍该角色的场景之后写 /set met true
- 若应由蓝图设置，在该蓝图中为它添加「设置场景变量」「设置存档变量」或「设置持久变量」节点
- 若该变量是只通过默认值切换的开关（例如调试开关），可在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

A condition tests a variable that nothing in the project sets: no /set, /inc, /dec or /toggle row in any story, even a disabled one, and no blueprint node that sets it. Conditions are /if, /until, and a choice option's Hidden when and Disabled when; the finding is on the first and counts them all.

The variable keeps its default value throughout the game, so every one of these conditions gives the same answer every time.

- Add the row that sets it where the story calls for it, for example /set met true after the scene that introduces the character.
- If a blueprint is meant to set it, add Set Scene Var, Set Saved Var or Set Persistent for it there.
- If the variable is a switch changed only through its default value, such as a debug flag, set the rule to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 赋值之外的随机数 · Random outside an assignment

random() 或 randomInt() 位于每次使用都会重新计算的位置：/if 的条件、选项的「隐藏条件」或「禁用条件」，以及旁白、对白、提示语或选项文本之中。/set、/inc、/dec 右侧与 /until 中的调用不报告

游戏中结果会不断变化：/if 每次判断都可能进入不同的分支，菜单显示期间选项会闪烁，文本中显示的数字在每次重绘时改变

- 在该行之前先取值到变量，例如先写 /local roll 0，再写 /set roll randomInt(1, 6)，然后在原先调用的位置使用 roll。结果需要保留到场景之外时，改用存档变量
- 若有意让值在每次重绘时变化，可在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

random() or randomInt() is called where its result is worked out again each time it is used: an /if condition, a choice option's Hidden when or Disabled when, or the text of a line, prompt or option. Calls on the right of /set, /inc and /dec, and in /until, are not reported.

In the game the result keeps changing: an /if can take a different branch each time it is tested, an option flickers while the menu is shown, and a shown number changes whenever the line is redrawn.

- Roll once into a variable above the row, for example /local roll 0 then /set roll randomInt(1, 6), and use roll where the call was. Use a saved variable instead when the result must outlast the scene.
- If a value that changes on every redraw is intended, set the rule to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 过长的行 · Overlong line

该行文本的宽度超过项目设定的上限，默认为 120 列。按整行计算，与对话框如何折行无关：中文、日文、韩文字符计 2 列，其他字符计 1 列，插入的值、暂停与行内事件不计。只检查源语言的旁白、对白、提示语与选项文本

超过上限的行在游戏中可能无法完整显示在对话框、菜单或选项按钮中

- 将该行拆成两行，或缩短
- 若项目的对话框能容纳的宽度不同，在「项目 ▸ 项目 ▸ 项目检查」中修改该规则下的「最大宽度」；其下的「计数方式」可改为所有字符计 1 列

The line is wider than the project's maximum, 120 columns unless changed. The whole line is counted, however the box wraps it: a Chinese, Japanese or Korean character is two columns and any other character one, while inserted values, pauses and inline events count as nothing. Only source-language narration, dialogue, prompts and options are checked.

A line over the maximum may not fit the dialogue box, menu or choice button it appears in.

- Split it into two rows, or shorten it.
- If the dialogue box holds a different amount, change Maximum width under this rule in Project ▸ Project ▸ Project check. Counting, below it, can count every character as one column.

相关主题 · Related：项目检查 · Project checks

### 空行 · Empty line

旁白、对白或选项行中没有文本：仅含空格或为空，也没有插入的值和行内事件。没有提示语的选择不报告，已禁用的行也不报告

游戏中空白的旁白或对白行会被跳过，不显示任何内容；空白的选项仍会出现在菜单中，按钮上显示占位文字 Option，或不显示任何文字

- 写上该行应有的文本，或删除该行

A narration, dialogue or choice option row has no text: nothing but spaces, with no inserted value and no inline event. A choice without a prompt is not reported, nor is a disabled row.

In the game a blank narration or dialogue row is skipped and shows nothing. A blank choice option is still offered, labeled with the placeholder Option or with nothing.

- Write the text the row was meant to have, or delete the row.

相关主题 · Related：项目检查 · Project checks

### 文本效果未安装 · Text effect not installed

旁白、对白或选项行中的文本设置了行内效果（例如抖动），但没有已安装并启用的插件提供该效果。效果 ID 以提供它的插件 ID 开头

游戏中该文本按无效果显示。构建会被拒绝，因为无法打包绘制该效果的插件

- 安装或启用效果 ID 所指的插件
- 或选中该文本，在文本工具栏中打开「效果」并选择「无」

Text in a narration, dialogue or choice row is set in an inline effect, such as shaking text, and no installed and enabled plugin provides it. The effect's id begins with the id of the plugin that provides it.

The game draws the text without the effect. A build is refused, because the plugin that draws the effect cannot be packaged.

- Install or enable the plugin named by the effect's id.
- Or select the text, open Effects in the text toolbar and choose None.

相关主题 · Related：项目检查 · Project checks

### 缺少翻译 · Missing translation

某一行或某段界面文本，在项目的某种语言中没有译文。「本地化」面板中除源语言外的每种语言都会检查：旁白、对白、提示语、选项文本，以及翻译表中的界面文本。翻译键无论被多少控件使用，都只报告一次

该语言的玩家看到回退语言的译文；没有回退语言或回退语言也没有译文时，看到源语言原文

- 在「本地化」面板中打开该语言并填写译文。「未翻译」筛选列出全部缺少译文的条目；界面文本位于「范围」列表的「界面文本」中
- 需要在外部翻译时，使用该语言「更多」菜单中的「导出翻译…」，范围选「未翻译与待复查」，完成后用「导入翻译…」导回
- 若某种语言不要求完整翻译，可在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

A line or a piece of interface text has no translation in one of the project's languages. Every language in the Localization panel other than the source language is checked, against narration, dialogue, prompts, options and the interface text of the translation table. A translation key is reported once, however many widgets use it.

Players of that language see the fallback language's translation, or the source text when there is none.

- Open the language in the Localization panel and write the translation. The Untranslated filter lists every missing one; interface text is under Interface text in the Source list.
- To translate elsewhere, use Export translations… in the language's More menu with Include set to Untranslated and to review, then Import translations… with the result.
- If a language is not meant to be complete, set the rule to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 译文过期 · Stale translation

某条译文写成之后，原文又被修改过。各语言中已有译文的行与界面文本都会检查。只改样式、暂停或行内事件不算修改；改动文字，或增删插入的值，才算修改

该语言的玩家仍看到旧译文，其内容可能已与原文不符

- 在该语言的翻译表中，「待复查」筛选列出这些条目。按需修改译文；修改后即标记为最新
- 译文仍然正确时，在「审校」模式中点击「通过」，同样会标记为最新

A translation was written before its source text last changed. Each language is checked against the lines and interface text it has translations for. Changing only styling, pauses or inline events does not count; changing the words, or adding or removing an inserted value, does.

Players of that language still see the old translation, which may no longer match the source.

- In the language's translation table, the To review filter lists these. Edit the translation where needed; an edit marks it current.
- If the translation is still right, Approve it in Review mode, which also marks it current.

相关主题 · Related：项目检查 · Project checks

### 译文未带样式 · Translation drops styling

该行带有样式、暂停或行内事件，而它在某种语言中的译文没有全部带上，或带有该行并不存在的标记。只检查已有译文的故事行

该语言的玩家看到的相应文字没有样式；缺少标记的暂停、表情切换或音效不会发生

- 在该语言的翻译表中修改译文。「标记」中以正常亮度显示的是译文缺少的标记：选中文字后点击样式标记，或将光标放在相应位置后点击暂停或事件标记
- 若译文有意省略样式，无需修改；也可在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

The line has styling, a pause or an inline event, and its translation in one language does not carry all of them, or carries a tag the line does not have. Only translated story lines are checked.

Players of that language see those words unstyled, and a pause, expression change or sound effect whose tag is missing does not happen.

- Edit the translation in that language's translation table. Under Tags, a tag at full strength is one the translation lacks: select the words and choose a styling tag, or place the caret and choose a pause or event tag.
- If the translation leaves styling out on purpose, nothing needs to change; the rule can be set to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 孤立的译文 · Orphan translation

某种语言中留有一些译文，它们对应的故事行已不在任何故事中：所在行已被删除、剪切后粘贴到别处或已禁用，以及粘贴后又被撤销的行。每种语言报告一条，给出数量。界面文本与翻译键不计入

游戏中不会显示这些译文，但它们仍留在该语言中，并可能被带入构建

- 误删的行：在故事编辑器中撤销删除，其译文即重新生效。已禁用的行：右键该行并选择「启用」
- 不再需要的译文：在该语言翻译表的「范围」中选择「孤立的译文」，逐条或全部删除
- 不需要这一计数时，可在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

A language holds translations of story lines that are no longer in any story: lines whose rows were deleted, cut and pasted elsewhere, or disabled, and lines a paste added before it was undone. One finding per language gives the count. Interface text and translation keys are not counted.

Nothing in the game shows these translations, but they stay in the language and can be carried into builds.

- A row deleted by mistake: undo the deletion in the story editor, and its translation applies again. A disabled row: right-click it and choose Enable.
- Translations no longer needed: in the language's translation table, choose Orphan translations under Source, then delete them one at a time or all at once.
- If the count is not wanted, set the rule to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 缺少语音 · Missing voice

某一需要配音的行，在项目的某种配音语言中没有录音。检查旁白与对白行；开启「为选项配音」时也检查选项。提示语、空白行与已禁用的行不检查

选择该配音语言的玩家听不到该行的语音

- 在「配音」面板中打开该配音语言，「缺失」筛选列出这些行；使用「指派音频」，或将音频拖到行上，即可关联录音
- 该语言「更多」菜单中的「导入音频…」按「录音文件名规则」一次关联多个文件；「导出录音脚本」列出待录制的行
- 若部分行本就不配音（例如旁白），可在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

A spoken line has no recording in one of the project's voice languages. Narration and dialogue rows are checked, and choice options too while Voice choice options is on. Prompts, blank lines and disabled rows are not.

Players who choose that voice language hear no voice for the line.

- Open the voice language in the Voice panel: the Missing filter lists these lines, and Assign audio, or dropping audio on a row, links a recording.
- Import audio… in the language's More menu links many files at once by Recording filename pattern; Export recording script lists the lines to record.
- If some lines are meant to stay silent, such as narration, set the rule to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 语音过期 · Stale voice

某段录音关联之后，对应行的文本有改动。比较的是该语言配音演员所读的文本：项目有该语言的译文时为译文，否则为源语言原文

玩家听到的是旧录音，可能与屏幕上的文字不符

- 重新录制该行，在配音表中用「替换音频」关联新文件；「待更新」筛选列出这些行
- 该语言「更多」菜单中的「导出补录脚本（仅待更新）」只导出这些行，供补录使用
- 若旧录音仍适用于新文本，打开「替换音频」并确认同一段音频，即标记为最新

A recording was linked to a line whose text has changed since. The text compared is what that language's actor reads: the translation into that language if the project has one, otherwise the source line.

Players hear the old recording, which may not match the words on screen.

- Record the line again and link the new file with Replace audio in the voice table, where the Outdated filter lists these lines.
- Export pickup script (outdated only) in the language's More menu lists only these lines for a recording session.
- If the recording still fits the new text, open Replace audio and confirm the same clip; that marks it current.

相关主题 · Related：项目检查 · Project checks

### 孤立的语音 · Orphan voice

某种配音语言中留有一些录音，它们关联的行已不在任何故事中：所在行已被删除、剪切后粘贴到别处或已禁用，以及粘贴后又被撤销的行。每种配音语言报告一条，给出数量

游戏中不会播放这些录音，但它们仍关联在该语言中，其音频可能被带入构建

- 误删的行：在故事编辑器中撤销删除，其录音即重新生效。已禁用的行：右键该行并选择「启用」
- 不再需要的录音：在该配音语言配音表的「故事」中选择「孤立的语音」，逐条或全部移除；音频文件仍保留在资产库中
- 不需要这一计数时，可在「项目 ▸ 项目 ▸ 项目检查」中将该规则设为「关闭」

A voice language holds recordings linked to lines that are no longer in any story: lines whose rows were deleted, cut and pasted elsewhere, or disabled, and lines a paste added before it was undone. One finding per voice language gives the count.

Nothing in the game plays these recordings, but they stay linked in the language, and their audio can be carried into builds.

- A row deleted by mistake: undo the deletion in the story editor, and its recording applies again. A disabled row: right-click it and choose Enable.
- Recordings no longer needed: in the voice language's table, choose Orphan voice under Story, then remove them one at a time or all at once. The audio files stay in the asset library.
- If the count is not wanted, set the rule to Off in Project ▸ Project ▸ Project check.

相关主题 · Related：项目检查 · Project checks

### 断开的颜色链接 · Broken color link

页面本身，或页面上、组件中的某个控件，使用了无法解析的项目颜色：配色方案中没有该颜色，最常见的原因是它已在「项目 ▸ 设计」中被删除；或者该颜色沿一串颜色链接下去，最终指向不存在的颜色，或绕回自身。问题依次写出页面或组件、控件和字段。角色的颜色不在检查范围内

该处改用自身的默认颜色绘制。游戏照常运行，颜色与选定的不同

- 打开该页面或组件，选中控件，为该字段重新选择颜色
- 链接断开时，打开「项目 ▸ 设计」，将控件所用的颜色改为跟随一个存在的颜色，或单独指定颜色

A page, or a widget on a page or in a component, uses a project color that cannot be resolved: the color is not in the palette, most often after being deleted on Project ▸ Design, or it follows a chain of colors that ends at a missing one or leads back to itself. The finding names the page or component, then the widget, then the field. Character colors are not checked.

That place is painted in its own default color instead. The game runs, with a color other than the one chosen.

- Open the page or component, select the widget, and choose a color for that field again.
- For a chain, open Project ▸ Design and point the color the widget uses at an existing color, or give it a color of its own.

相关主题 · Related：项目检查 · Project checks

### 缺少字形 · Missing glyphs

项目文本中有字符是字体列表中任何字体都无法绘制的。故事文本、角色与场景名称、翻译键以及页面上的文本按每一种语言检查，有译文时检查译文；控件按其每个状态所用的字体检查。空格与表情符号不检查，系统界面字体等内置字体视为不含任何字符，未列出任何字体的项目不做该检查

每个字符在每种语言中只报告一次，位置为它首次出现的地方；超出本规则下方设定的数量（默认 20 个）后，其余字符合并为一条。无法读取的字体会使检查停止，直到它被修复；.ttc、.otc、.eot 或 .svg 字体在游戏中无法绘制任何文字

游戏中，缺失的字符以玩家设备上的字体显示，设备上没有可用字体时显示为空白方框

- 在「项目 ▸ 设计 ▸ 字体」中添加含有该字符的字体；或点击列表中某个字体所在行的语言按钮，勾选问题中写出的语言
- 问题写出了状态时，为控件的该状态选择含有该字符的字体
- 无法读取或格式不可用的字体：在资产面板中右键它，选择「替换文件…」，换成 .ttf 或 .otf 文件
- 字符本不该出现时，在问题写出的位置改正文本

A character in the project's text that no font on its font list can draw. Story text, character and scene names, translation keys and text on pages are checked in every language, translated where a translation exists, and a widget is checked in the font of each of its states. Spaces and emoji are skipped, a built-in font such as System UI counts as drawing nothing, and a project with no fonts listed is not checked.

Each character is reported once per language, at the first place it appears; past the number set under this rule, 20 unless changed, the rest are counted in one finding. A font that could not be read stops the check until it is fixed, and a .ttc, .otc, .eot or .svg font draws nothing in the game.

In the game a missing character is drawn in a font from the player's device, or as an empty box where the device has none.

- On Project ▸ Design ▸ Typography, add a font that has the character, or open a listed font's languages with the button on its row and tick the language the finding names.
- For a finding that names a state, choose a font with the character for that state of the widget.
- Replace a font that could not be read, or one in an unusable format, with a .ttf or .otf file: right-click it in the Assets panel and choose Replace File….
- A character that should not be there is corrected in the text at the place the finding names.

相关主题 · Related：项目检查 · Project checks

### 语言没有字体 · Language with no font

字体列表中的每个字体都限定于其他语言，该语言没有可用的项目字体。未列出任何字体的项目不做该检查

该语言的文本使用玩家设备上的字体显示，不同设备之间会有差异；除指定了自身字体的控件外，该语言中缺失的字符也不会被报告

- 在「项目 ▸ 设计 ▸ 字体」中点击某个字体所在行的语言按钮，勾选该语言；或取消全部勾选，使该字体用于所有语言
- 也可以为该语言在列表中添加一个字体
- 语言按钮只在项目有两种及以上语言时显示；只有一种语言时，从列表中移除该字体后重新添加

Every font on the project's font list is limited to other languages, so this language has no project font. A project with no fonts listed is not checked.

Text in this language is set in fonts from the player's device, which differ from one device to the next, and missing characters in it are not reported except in widgets that choose their own font.

- On Project ▸ Design ▸ Typography, open a font's languages with the button on its row and tick this language, or untick them all so the font serves every language.
- Or add a font for this language to the list.
- The button appears only while the project has two or more languages. With one, remove the font from the list and add it again.

相关主题 · Related：项目检查 · Project checks
