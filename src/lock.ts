export class KeyedLockService {
  private tails = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    if (!key || key.length > 1024) throw new Error("锁 Key 长度必须为 1-1024");
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.tails.set(key, current);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }

  async runMany<T>(keys: string[], task: () => Promise<T>): Promise<T> {
    const ordered = [...new Set(keys)].sort();
    const acquire = (index: number): Promise<T> =>
      index >= ordered.length ? task() : this.run(ordered[index], () => acquire(index + 1));
    return acquire(0);
  }

  async drain() {
    await Promise.all([...this.tails.values()]);
  }
  get size() { return this.tails.size; }
}
