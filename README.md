<div align="center">
  <img src="./assets/coconut-water.png" width="168" alt="椰子水">

  <h1>Faith Core</h1>

  <p><strong>Faith v3 的数据与基础服务</strong></p>

  <p>
    <img alt="Koishi" src="https://img.shields.io/badge/Koishi-4.16%2B-60a5fa?style=flat-square">
    <img alt="Version" src="https://img.shields.io/badge/version-3.0.0--alpha.1-a78bfa?style=flat-square">
    <img alt="License" src="https://img.shields.io/badge/license-GPL--3.0-52b788?style=flat-square">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white">
  </p>
</div>

---

## 能力

- 永不复用的八位 UID 与多平台身份映射
- 用户数值、信仰、职业和背包
- 金币与登神分经济服务
- 原子事务、幂等流水和 UID 锁
- 物品、职业、信仰与加成注册表
- 权限、持久效果、Hook 和游戏日生命周期
- 面向 Business 的受限 Scope

数据库表统一使用 `faith_core_` 前缀

## 源码结构

```text
src/
├── config/             # 配置校验与运行时快照
├── database/           # Core 数据表定义与业务表注册
├── data/               # 内置信仰、职业和物品数据
├── lifecycle/          # 生命周期、游戏日与资源回收
├── services/
│   ├── identity/       # UID 分配、身份校验与绑定
│   ├── users/          # 用户资料与批量操作
│   ├── transaction/    # 原子事务、审计与幂等
│   └── business/       # 提供给 Business 的受限 Scope
├── bonus/ economy/     # 加成与经济能力
├── faith/ professions/ # 信仰与职业注册服务
├── items/              # 物品注册、背包与开启逻辑
├── service.ts          # FaithCoreService 组装入口
└── index.ts            # Koishi 插件入口与公开导出
```

根目录 `config.ts` 只负责 Koishi 配置 Schema；运行代码统一位于 `src`。`services` 内按数据边界划分，不再按新增顺序堆放文件。

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
