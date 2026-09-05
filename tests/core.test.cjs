const test = require('node:test')
const assert = require('node:assert/strict')
const core = require('../lib/index.js')

test('atomic business tables stay owner-scoped and reject primary-key changes and escaped scopes', async () => {
  const calls = []
  const database = {
    get: async (table) => { calls.push(table); return [] },
    create: async (table, row) => { calls.push(table); return row },
    set: async (table) => { calls.push(table); return { matched: 1 } },
    remove: async (table) => { calls.push(table); return {} },
  }
  const service = new core.FaithBusinessTransactionService(
    { run: async (task) => task(database) }, new core.KeyedLockService(),
    { emit: async () => {} }, { require: async (uid) => ({ uid }) }, {}, {},
    { begin: async () => 'tx', entry: async () => {} }, {},
  )
  let saved
  await service.run('rooms', 10000000, async (scope) => {
    saved = scope
    await scope.table.create({ key: 'room' })
    await scope.table.set({ key: 'room' }, { version: 2 })
    assert.throws(() => scope.table.set({ key: 'room' }, { key: 'other' }))
    assert.throws(() => scope.table.remove({}))
  }, {}, { name: 'faith_business_rooms', primary: ['key'] })
  assert.deepEqual(calls, ['faith_business_rooms', 'faith_business_rooms'])
  assert.throws(() => saved.table.get())
  await assert.rejects(() => service.run('rooms', 10000000, async () => {}, {}, { name: 'faith_core_users', primary: ['id'] }))
})

test('atomic user scope keeps its latest snapshot across consecutive writes', async () => {
  let row = { uid: 10000000, faiths: ['旧信仰'], profession_id: '', gold: 100, ascension_score: 2000, audience_score: 10, audience_rank: 0, abandon_count: 0, status: 'active' }
  const writeQueries = []
  const database = {
    get: async (table) => table === 'faith_core_users_data' ? [{ ...row, faiths: [...row.faiths] }] : [],
    set: async (table, query, patch) => {
      writeQueries.push(query)
      if (table !== 'faith_core_users_data' || Object.entries(query).some(([key, value]) => JSON.stringify(row[key]) !== JSON.stringify(value))) return { matched: 0 }
      row = { ...row, ...patch }; return { matched: 1 }
    },
    create: async (_table, value) => value,
  }
  const service = new core.FaithBusinessTransactionService(
    { run: async (task) => task(database) }, new core.KeyedLockService(), { emit: async () => {} },
    { require: async () => ({ ...row, faiths: [...row.faiths] }) }, {}, { require: () => ({}) },
    { begin: async () => 'tx', entry: async () => {} },
    { require: () => ({}), adjustBelieverCount: async () => 1, refreshCount: async () => {} },
  )
  await service.run('faith', row.uid, async (tx) => {
    await tx.economy.pay({ ascension_score: 1200 })
    await tx.users.change({ audience_score: -2 })
    const after = await tx.users.abandonFaith('新信仰')
    assert.equal(after.ascension_score, 800)
    assert.equal(after.audience_score, 8)
    assert.equal(after.abandon_count, 1)
    const leaked = await tx.users.get(); leaked.faiths[0] = '篡改'
    assert.equal((await tx.users.get()).faiths[0], '新信仰')
  })
  assert.equal(row.faiths[0], '新信仰')
  assert.equal(row.ascension_score, 800)
  assert.equal(row.audience_score, 8)
  assert.ok(writeQueries.every((query) => !Object.hasOwn(query, 'faiths')), 'JSON 数组不能作为 Minato 乐观锁查询条件')
  row.ascension_score = -5
  await service.run('faith', row.uid, async (tx) => {
    assert.equal(await tx.economy.canAfford({ gold: 10 }), true)
    await tx.economy.pay({ gold: 10 })
    await tx.users.change({ gold: -200, ascension_score: -10 })
  })
  assert.equal(row.gold, -110)
  assert.equal(row.ascension_score, -15)
  row.ascension_score = 100
  await service.run('faith', row.uid, async (tx) => {
    assert.equal(await tx.economy.canAfford({ ascension_score: 10 }), true)
    await tx.economy.pay({ ascension_score: 10 })
  })
  assert.equal(row.ascension_score, 90)
})

test('KeyedLock serializes the same key', async () => {
  const locks = new core.KeyedLockService()
  const order = []
  await Promise.all([
    locks.run('uid:1', async () => { order.push(1); await new Promise((r) => setTimeout(r, 10)); order.push(2) }),
    locks.run('uid:1', async () => { order.push(3) }),
  ])
  assert.deepEqual(order, [1, 2, 3])
  assert.equal(locks.size, 0)
})

test('Faith transactions reuse nested context and serialize SQLite roots', async () => {
  let begins = 0, active = 0, maximum = 0
  const database = {
    drivers: [{ constructor: { name: 'sqlite' } }],
    transact: async (task) => {
      begins++; active++; maximum = Math.max(maximum, active)
      try { await new Promise((resolve) => setTimeout(resolve, 5)); return await task(database) }
      finally { active-- }
    },
  }
  const service = new core.FaithTransactionService({ database })
  await Promise.all([
    service.run(async () => service.run(async () => 'nested')),
    service.run(async () => 'parallel'),
  ])
  assert.equal(begins, 2)
  assert.equal(maximum, 1)
})

test('item levels have stable rarity ordering', () => {
  const levels = new core.FaithItemLevelRegistry()
  levels.registerMany(core.CORE_ITEM_LEVELS, { owner: 'core' })
  assert.ok(levels.compare('彩蛋', 'SSS') > 0)
  assert.ok(levels.compare('SP', 'D') > 0)
  assert.ok(levels.compare('UR', '彩蛋') > 0)
  assert.ok(levels.compare('URE', 'UR') > 0)
  assert.ok(levels.compare('SP', 'URE') > 0)
  assert.ok(levels.compare('EX', 'SP') > 0)
  assert.equal(levels.get('LT'), undefined)
  assert.throws(() => levels.require('LT'))
  assert.throws(() => levels.register({ id: 'D', name: 'D', rank: 1 }, { owner: 'other', replace: true }))
})

test('business records reject prototype pollution and circular data', () => {
  assert.throws(() => core.cloneBusinessRecord(JSON.parse('{"__proto__":{"polluted":true}}')))
  const value = {}; value.self = value
  assert.throws(() => core.cloneBusinessRecord(value))
})

test('game day follows v2 07:30 Asia/Shanghai boundary', () => {
  const ctx = { logger: () => ({ error() {} }) }
  const service = new core.FaithGameDayService(ctx, {
    enabled: true, timezone: 'Asia/Shanghai', rolloverHour: 7, rolloverMinute: 30,
    checkIntervalSeconds: 60, lockTimeoutSeconds: 1800, runOnStartup: false,
  }, {}, new core.KeyedLockService(), {})
  assert.equal(service.getDate(new Date('2026-09-02T23:29:00.000Z')), '2026-09-02')
  assert.equal(service.getDate(new Date('2026-09-02T23:30:00.000Z')), '2026-09-03')
})

test('Core errors retain stable machine-readable codes', () => {
  const error = new core.FaithCoreError('INSUFFICIENT_BALANCE')
  assert.equal(error.code, 'INSUFFICIENT_BALANCE')
  assert.equal(error.name, 'FaithCoreError')
})

test('identity normalization enforces QQ Bot group scope', () => {
  assert.throws(() => core.normalizeIdentity({ adapter: 'qqbot', type: 'qqbot_member_openid', value: 'member', scope: 'group_chat' }))
  assert.deepEqual(core.normalizeIdentity({ adapter: 'qqbot', type: 'qqbot_member_openid', value: 'member', scope: 'group_chat', scopeValue: 'group' }), {
    adapter: 'qqbot', type: 'qqbot_member_openid', value: 'member', scope: 'group_chat', scopeValue: 'group',
  })
  assert.throws(() => core.normalizeIdentity({ adapter: 'onebot', type: 'qq_account', value: '1', scope: 'private_chat' }))
})

test('bonus providers run concurrently while preserving priority order', async () => {
  const hooks = new core.FaithHooksService({ logger: () => ({ error() {} }) })
  const users = { require: async () => ({ uid: 10000000, faiths: [] }) }
  const bonuses = new core.FaithBonusService(users, hooks)
  bonuses.registerProvider(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return { source: 'slow', type: 'gold', fixedBonus: 1 } }, { id: 'slow', priority: 1 })
  bonuses.registerProvider(async () => ({ source: 'fast', type: 'gold', fixedBonus: 2 }), { id: 'fast', priority: 2 })
  const result = await bonuses.calculate({ uid: 10000000, type: 'gold', baseValue: 10 })
  assert.deepEqual(result.contributions.map((item) => item.source), ['slow', 'fast'])
  assert.equal(result.finalValue, 13)
})

test('hooks preserve priority and once semantics', async () => {
  const hooks = new core.FaithHooksService({ logger: () => ({ error() {} }) })
  const order = []
  hooks.on('test/event', () => order.push(2), { priority: 2, once: true })
  hooks.on('test/event', () => order.push(1), { priority: 1 })
  await hooks.emit('test/event', {})
  await hooks.emit('test/event', {})
  assert.deepEqual(order, [1, 2, 1])
})

test('critical hooks propagate failures', async () => {
  const hooks = new core.FaithHooksService({ logger: () => ({ error() {} }) })
  hooks.on('test/critical', () => { throw new Error('boom') })
  await assert.rejects(() => hooks.emitStrict('test/critical', {}), AggregateError)
})

test('persistent registries allow an identical same-owner reload', () => {
  const levels = new core.FaithItemLevelRegistry()
  const level = { id: 'X', name: 'X', rank: 1 }
  assert.equal(levels.register(level, { owner: 'business:test' }), levels.register(level, { owner: 'business:test' }))
  const professions = new core.FaithProfessionRegistry()
  const profession = { id: 'test', name: 'Test', type: 'base', faith: 'Test' }
  assert.equal(professions.register(profession, { owner: 'business:test' }), professions.register(profession, { owner: 'business:test' }))
})

test('inventory mutation rejects shortage and item cap with stable codes', () => {
  const item = { item_id: 'test', name: 'Test', type: 'item', level: 'D', description: '', max_quantity: 2, marketable: false, price: 0, obtainable: true }
  assert.equal(assertCode(() => core.createInventoryMutation(10000000, item, 0, -1)), 'ITEM_INSUFFICIENT')
  assert.equal(assertCode(() => core.createInventoryMutation(10000000, item, 1, 3)), 'ITEM_LIMIT_EXCEEDED')
})

test('bulk operations require an idempotent operation id and report skips', async () => {
  const users = { list: async ({ offset }) => offset ? [] : [{ uid: 10000000 }, { uid: 10000001 }] }
  const items = { require: () => ({ item_id: 'gift' }) }
  const transactions = {
    run: async (_business, uid, task) => {
      if (uid === 10000001) throw new core.FaithCoreError('IDEMPOTENCY_CONFLICT')
      return task({ users: { change: async () => ({}) }, items: { give: async () => ({}) } })
    },
  }
  const operations = new Map()
  const ctx = { database: {
    get: async (_table, query) => operations.has(query.operation_id) ? [operations.get(query.operation_id)] : [],
    create: async (_table, value) => { operations.set(value.operation_id, value); return value },
  } }
  const bulk = new core.FaithBulkOperationsService(ctx, users, items, transactions)
  await assert.rejects(() => bulk.changeValuesForAll({ gold: 1 }, { operationId: '' }))
  const result = await bulk.changeValuesForAll({ gold: 1 }, { operationId: 'event-2026' })
  assert.deepEqual({ total: result.total, succeeded: result.succeeded, skipped: result.skipped }, { total: 2, succeeded: 1, skipped: 1 })
  await bulk.changeValuesForAll({ gold: -10, ascension_score: -5 }, { operationId: 'event-negative' })
})

test('economy distinguishes bonus rewards from fixed payments and refunds', async () => {
  let user = { uid: 10000000, gold: 100, ascension_score: 50 }
  const scope = { users: {
    get: async () => ({ ...user }),
    change: async (delta) => { user = { ...user, gold: user.gold + (delta.gold || 0), ascension_score: user.ascension_score + (delta.ascension_score || 0) }; return { ...user } },
  } }
  const transactions = { run: async (_business, _uid, task) => task(scope) }
  const users = { require: async () => ({ ...user }) }
  const calculate = async ({ uid, type, baseValue, source }) => ({ uid, type, baseValue, source, multiplier: 2, fixedBonus: 0, finalValue: baseValue * 2, contributions: [], failures: [] })
  const bonuses = { calculate, calculateForUser: async (_user, request) => calculate(request) }
  const economy = new core.FaithEconomyService(users, bonuses, transactions)
  await economy.pay(user.uid, { gold: 10, ascension_score: 5 }, { source: 'shop.buy' })
  assert.deepEqual({ gold: user.gold, score: user.ascension_score }, { gold: 90, score: 45 })
  const reward = await economy.reward(user.uid, { gold: 10 }, { source: 'prayer.daily' })
  assert.equal(reward.applied.gold, 20)
  assert.equal(user.gold, 110)
  await economy.refund(user.uid, { gold: 10 }, { source: 'game.refund' })
  assert.equal(user.gold, 120)
  user.ascension_score = -10
  assert.equal(await economy.canAfford(user.uid, { gold: 10 }), true)
  await economy.pay(user.uid, { gold: 10 }, { source: 'shop.buy' })
  assert.equal(user.gold, 110)
  user.gold = -10
  user.ascension_score = 20
  assert.equal(await economy.canAfford(user.uid, { ascension_score: 5 }), true)
  await economy.pay(user.uid, { ascension_score: 5 }, { source: 'shop.buy' })
  assert.equal(user.ascension_score, 15)
  await assert.rejects(() => economy.pay(user.uid, { gold: 999 }, { source: 'shop.buy' }), (error) => error.code === 'INSUFFICIENT_BALANCE')
  await assert.rejects(() => economy.reward(user.uid, { gold: 1 }, { source: 'invalid' }), (error) => error.code === 'VALIDATION_FAILED')
})

test('core config normalization validates and freezes reload snapshots', () => {
  const config = core.normalizeCoreConfig({
    registration: { initialGold: 300 },
    gameDay: { enabled: true, timezone: 'Asia/Shanghai', rolloverHour: 7, rolloverMinute: 30, checkIntervalSeconds: 60, lockTimeoutSeconds: 1800, runOnStartup: true },
  })
  assert.equal(Object.isFrozen(config), true)
  assert.equal(Object.isFrozen(config.gameDay), true)
  assert.throws(() => core.normalizeCoreConfig({ ...config, gameDay: { ...config.gameDay, timezone: 'invalid/timezone' } }), (error) => error.code === 'VALIDATION_FAILED')
})

test('openable items are classified as items and roll only obtainable non-openable rewards', () => {
  const service = new core.FaithItemsService({}, {}, {}, {}, {}, {})
  service.registerMany(core.CORE_OPENABLE_ITEMS, { owner: 'core' })
  service.register({ item_id: 'reward_d', name: 'D 奖励', type: '道具', level: 'D', description: '', max_quantity: 0, marketable: true, price: 1, obtainable: true }, { owner: 'core' })
  const container = service.require('破烂的背包')
  assert.equal(container.type, '物品')
  assert.equal(service.isOpenable(container.item_id), true)
  const result = service.rollOpenable(container.item_id, () => 0)
  assert.equal(result.currencies.gold, 20)
  assert.deepEqual(result.items, { reward_d: 1 })
})

function assertCode(callback) {
  try { callback() } catch (error) { return error.code }
  assert.fail('expected callback to throw')
}
