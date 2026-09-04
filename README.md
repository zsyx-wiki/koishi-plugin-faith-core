<div align="center">
  <img src="./assets/coconut-water.png" width="168" alt="椰子水">

  <h1>CoCoFaith Core</h1>

  <p><strong>CoCoFaith v3 的数据与基础服务</strong></p>

  <p>
    <img alt="Koishi" src="https://img.shields.io/badge/Koishi-4.16%2B-60a5fa?style=flat-square">
    <img alt="Version" src="https://img.shields.io/badge/version-3.0.0--alpha.2-a78bfa?style=flat-square">
    <img alt="License" src="https://img.shields.io/badge/license-GPL--3.0-52b788?style=flat-square">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white">
  </p>
</div>

---

CoCoFaith Core 是 CoCoFaith v3 的基础插件，负责保存公共数据并向玩法层提供稳定服务。它不注册签到、抽卡、商店或游戏命令，具体玩法由 CoCoFaith Business 实现。

插件需要 Koishi 数据库服务。加载 CoCoFaith Business 和平台 Adapter 时，应将 Core 放在它们之前。

## 基础能力

- 使用独立 UID 处理玩家数据，可将不同平台身份绑定到同一名玩家
- 保存玩家数值、信仰、职业、背包等公共数据
- 提供金币、登神分等通用经济操作
- 管理物品、信仰、职业和加成定义
- 提供事务、权限、生命周期和 Hook
- 为 Business 提供受限接口，避免玩法直接操作其他业务的数据

Core 创建的数据库表统一使用 `faith_core_` 前缀。删除某个平台身份不会同时删除玩家资产，已经分配的 UID 也不会重新使用。

## 安装

```bash
npm install @mueo/koishi-plugin-cocofaith-core
```

在 Koishi 中启用数据库插件后加载 CoCoFaith Core。

仅使用 Core 不会产生面向玩家的命令。

## 配置

默认以 `Asia/Shanghai` 时区的每日 `07:30` 作为游戏日分界。

| 配置 | 默认值 | 说明 |
| --- | ---: | --- |
| `registration.initialGold` | `300` | 新用户初始金币 |
| `gameDay.enabled` | `true` | 是否运行游戏日调度 |
| `gameDay.timezone` | `Asia/Shanghai` | 游戏日时区 |
| `gameDay.rolloverHour` | `7` | 切换小时 |
| `gameDay.rolloverMinute` | `30` | 切换分钟 |
| `gameDay.checkIntervalSeconds` | `60` | 检查间隔 |
| `gameDay.lockTimeoutSeconds` | `1800` | 跨实例锁超时 |

配置可以在运行时重新加载。涉及游戏日时间的修改会在 reload 后应用，不需要重启整个 Koishi 实例。

## 开发

插件通过 `faithCore` 服务提供能力

普通玩法应依赖 CoCoFaith Business，并通过 Business Scope 使用 Core

平台 Adapter 只使用身份解析与绑定接口。

```ts
const uid = await ctx.faithCore.adapter.resolve(identity)
const user = await ctx.faithCore.users.require(uid)
const inventory = await ctx.faithCore.items.getInventory(uid)

await ctx.faithCore.economy.reward(uid, { gold: 100 }, {
  source: 'signin.reward',
})
```

需要同时修改数值、背包或业务数据时，应使用 Business Scope 提供的原子事务，不要拆成多次独立写入。

示例：

```ts
await core.transaction.run(uid, async (tx) => {
  const cost = { gold: 100 }
  if (!await tx.economy.canAfford(cost)) {
    throw new Error('金币不足')
  }

  const data = await tx.data.get()
  const purchaseCount = Number(data.private.purchaseCount ?? 0)

  await tx.economy.pay(cost)
  await tx.items.give(rewardItemId, 1)
  await tx.data.set({
    private: {
      ...data.private,
      purchaseCount: purchaseCount + 1,
    },
  })
}, {
  source: 'shop.purchase',
  idempotencyKey: `shop:${eventId}`,
})
```

```bash
npm run build
```

数据结构和公开接口仍可能在正式版前调整，生产环境升级前请先备份数据库。

版本记录见 [CHANGELOG.md](./CHANGELOG.md)。项目采用 GPL-3.0-or-later 许可证。
