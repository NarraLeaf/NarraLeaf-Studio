# Broadcast 节点

## Send Broadcast

`blueprint.broadcast.send` - 发送广播事件

向当前运行中的 UI 发送一个广播事件。传入：
- `event` - 广播事件名
- `data` - 广播数据

## Get Listener Count

`blueprint.broadcast.getListenerCount` - 获取注册的监听器数量

获取当前广播事件名下已经注册的监听器数量。传入：
- `event` - 广播事件名

传出：
- `count` - 监听器数量
