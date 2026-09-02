import type { CoreDatabase } from "./transaction";
import { UID_MAX, UID_MIN } from "../types";
import { FaithCoreError } from "../errors";

export class FaithUidService {
  async initialize(database: CoreDatabase) {
    const [sequence] = await database.get("faith_core_uid_sequence", { id: 1 });
    if (!sequence) {
      try { await database.create("faith_core_uid_sequence", { id: 1, next_uid: UID_MIN }); }
      catch (error) {
        if (!(await database.get("faith_core_uid_sequence", { id: 1 })).length) throw error;
      }
    }
  }

  async allocate(database: CoreDatabase) {
    for (let attempt = 0; attempt < 16; attempt++) {
      let [sequence] = await database.get("faith_core_uid_sequence", { id: 1 });
      if (!sequence) {
        await this.initialize(database);
        [sequence] = await database.get("faith_core_uid_sequence", { id: 1 });
        if (!sequence) continue;
      }
      const uid = sequence.next_uid;
      if (uid > UID_MAX) throw new FaithCoreError("UID_EXHAUSTED");
      const result = await database.set("faith_core_uid_sequence", { id: 1, next_uid: uid }, { next_uid: uid + 1 });
      if (result.matched === 1) return uid;
    }
    throw new FaithCoreError("TRANSACTION_CONFLICT", "UID 分配发生持续并发冲突，请重试");
  }
}
