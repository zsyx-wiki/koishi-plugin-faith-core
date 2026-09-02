# Faith Core

![椰子水](./assets/coconut-water.png)

Faith v3 的数据与基础服务。

## 能力

- 永不复用的八位 UID 与多平台身份映射
- 用户数值、信仰、职业和背包
- 金币与登神分经济服务
- 原子事务、幂等流水和 UID 锁
- 物品、职业、信仰与加成注册表
- 权限、持久效果、Hook 和游戏日生命周期
- 面向 Business 的受限 Scope

数据库表统一使用 `faith_core_` 前缀

## 配置

配置定义集中在根目录 [`config.ts`](./config.ts)。默认游戏日为 `Asia/Shanghai 07:30`。

| 配置 | 默认值 | 说明 |
| --- | ---: | --- |
| `registration.initialGold` | `300` | 新用户初始金币 |
| `gameDay.enabled` | `true` | 是否运行游戏日调度 |
| `gameDay.timezone` | `Asia/Shanghai` | 游戏日时区 |
| `gameDay.rolloverHour` | `7` | 切换小时 |
| `gameDay.rolloverMinute` | `30` | 切换分钟 |
| `gameDay.checkIntervalSeconds` | `60` | 检查间隔 |
| `gameDay.lockTimeoutSeconds` | `1800` | 跨实例锁超时 |

## 示例

```ts
const uid = await ctx.faithCore.adapter.resolve(identity)
const user = await ctx.faithCore.users.require(uid)
const bag = await ctx.faithCore.items.getInventoryStacks(uid)

await ctx.faithCore.economy.reward(uid, { gold: 100 }, {
  source: 'signin.reward',
})
```

组合更新应使用 Business Scope 的 `transaction.run()`。SQLite 根事务串行执行，嵌套调用复用当前事务。

```bash
npm run build
```

版本变化见 [CHANGELOG.md](./CHANGELOG.md)。
