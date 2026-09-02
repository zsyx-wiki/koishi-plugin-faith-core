import type { FaithDefinition } from "../types";

export const FAITH_CAMPS = Object.freeze({
  生命: ["诞育", "繁荣", "死亡"], 沉沦: ["污堕", "腐朽", "湮灭"], 文明: ["秩序", "真理", "战争"],
  混沌: ["混乱", "痴愚", "沉默"], 存在: ["记忆", "时间"], 虚无: ["欺诈", "命运"],
} as const);

export const CORE_FAITHS: readonly FaithDefinition[] = Object.freeze(
  Object.entries(FAITH_CAMPS).flatMap(([path, names]) => names.map((name) => Object.freeze({
    name, path, type: "fixed" as const, believer_count: 0,
  }))),
);
