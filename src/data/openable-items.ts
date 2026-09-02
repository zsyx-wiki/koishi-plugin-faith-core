import type { FaithItemDefinition, FaithOpenableDefinition } from "../types";

const genericRules: Record<string, FaithOpenableDefinition> = {
  D: random([20, 40], [["D", 60], ["C", 35], ["B", 5]]),
  C: random([35, 65], [["D", 30], ["C", 40], ["B", 25], ["A", 5]]),
  B: random([70, 150], [["C", 50], ["B", 35], ["A", 15]]),
  A: random([130, 220], [["B", 50], ["A", 30], ["S", 15], ["SS", 5]]),
  S: random([200, 400], [["A", 50], ["S", 30], ["SS", 15], ["SSS", 5]]),
  SS: random([200, 400], [["SS", 1]]),
  SSS: random([200, 400], [["SSS", 1]]),
  SP: random([200, 400], [["SP", 1]]),
};

const genericNames: Record<string, readonly string[]> = {
  D: ["破烂的背包", "破烂的钱包", "破烂的垃圾袋"],
  C: ["普通的箱子", "普通的背包", "普通的快递盒", "普通的档案袋", "普通的木柜子"],
  B: ["崭新的首饰盒", "崭新的收纳盒", "崭新的存钱罐", "崭新的钱包"],
  A: ["高贵的钱包", "高贵的存钱罐", "保险柜", "小金库"],
  S: ["奢侈的首饰盒", "藏品柜", "大金库"],
};

let sequence = 0;
const genericItems = Object.entries(genericNames).flatMap(([level, names]) => names.map((name) => item(
  `faith_openable_${level.toLowerCase()}_${++sequence}`,
  name,
  level,
  `一个从虚空中捞出来的${name}，里面似乎装着什么。`,
  genericRules[level],
)));

export const CORE_OPENABLE_ITEMS: readonly FaithItemDefinition[] = Object.freeze([
  ...genericItems,
  item("faith_openable_2025_christmas", "2025圣诞礼盒", "LT", "一个装饰精美的礼盒，充满了节日的惊喜。", {
    guaranteed: { ascension_score: 20, gold: 200 },
    independentDrops: [
      { item: "藏品柜", chance: .15 }, { item: "藏品柜", chance: .05 },
      { item: "保险柜", chance: .1 }, { item: "被遗忘的圣诞袜", chance: .01 },
    ],
  }),
  item("faith_openable_mysterious_invitation", "神秘请柬", "LT", "一个神秘的请柬。", {
    guaranteed: { ascension_score: 10, gold: 100 },
    independentDrops: [
      { item: "藏品柜", chance: .15 }, { item: "保险柜", chance: .2 },
      { item: "流光剧院的过期邀请", chance: .02 },
    ],
  }),
  item("faith_openable_void_gift", "虚空馈赠", "SS", "散发着浓烈虚空能量的宝匣，其中必定包含一件 SS 级奇物。", genericRules.SS),
  item("faith_openable_fantasy_casket", "奇幻圣匣", "SSS", "封印着不可名状之物的匣子，开启后可获得 SSS 级奇物。", genericRules.SSS),
  item("faith_openable_divine_cube", "神遗魔方", "SP", "触碰它时，仿佛能听到宇宙诞生的轰鸣。", genericRules.SP),
]);

export const CORE_JUNK_PICKABLE_ITEM_IDS = Object.freeze(genericItems.map((entry) => entry.item_id));

function random(goldRange: readonly [number, number], entries: readonly (readonly [string, number])[]): FaithOpenableDefinition {
  return { randomDrop: { goldRange, itemCount: 1, itemPool: entries.map(([level, weight]) => ({ level, weight })) } };
}

function item(item_id: string, name: string, level: string, description: string, openable: FaithOpenableDefinition, obtainable = false): FaithItemDefinition {
  return { item_id, name, type: "物品", level, description, max_quantity: 0, marketable: false, price: 0, obtainable, actions: ["open"], openable };
}
