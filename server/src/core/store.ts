import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 轻量 JSON 文件存储（Repository 实现，可替换为 Prisma/PG）
// 写入用 temp+rename 保证原子性；单进程内串行化。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '../../data');

export interface Table<T> {
  all(): T[];
  find(pred: (row: T) => boolean): T | undefined;
  filter(pred: (row: T) => boolean): T[];
  insert(row: T): T;
  update(pred: (row: T) => boolean, patch: Partial<T> | ((row: T) => Partial<T>)): number;
  remove(pred: (row: T) => boolean): number;
}

export class JsonStore {
  private data = new Map<string, unknown[]>();
  private nextId = new Map<string, number>();

  constructor(dir = DATA_DIR) {
    fs.mkdirSync(dir, { recursive: true });
    this.dir = dir;
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.json')) {
        const name = f.slice(0, -5);
        const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        this.data.set(name, raw.rows ?? []);
        this.nextId.set(name, raw.nextId ?? 1);
      }
    }
  }
  private dir: string;

  table<T extends { id: number }>(name: string): Table<T> {
    if (!this.data.has(name)) this.data.set(name, []);
    if (!this.nextId.has(name)) this.nextId.set(name, 1);
    const self = this;
    const flush = () => {
      const tmp = path.join(self.dir, name + '.json.tmp');
      fs.writeFileSync(tmp, JSON.stringify({ nextId: self.nextId.get(name), rows: self.data.get(name) }, null, 1));
      fs.renameSync(tmp, path.join(self.dir, name + '.json'));
    };
    return {
      all: () => (self.data.get(name) as T[]).slice(),
      find: (pred) => (self.data.get(name) as T[]).find(pred),
      filter: (pred) => (self.data.get(name) as T[]).filter(pred),
      insert(row) {
        (row as any).id = self.nextId.get(name)!;
        self.nextId.set(name, self.nextId.get(name)! + 1);
        (self.data.get(name) as T[]).push(row);
        flush();
        return row;
      },
      update(pred, patch) {
        const rows = self.data.get(name) as T[];
        let n = 0;
        for (let i = 0; i < rows.length; i++) {
          if (pred(rows[i])) {
            const p = typeof patch === 'function' ? patch(rows[i]) : patch;
            rows[i] = { ...rows[i], ...p };
            n++;
          }
        }
        if (n) flush();
        return n;
      },
      remove(pred) {
        const rows = self.data.get(name) as T[];
        const keep = rows.filter((r) => !pred(r));
        const n = rows.length - keep.length;
        self.data.set(name, keep);
        if (n) flush();
        return n;
      },
    };
  }

  exists(): boolean {
    return fs.readdirSync(this.dir).some((f) => f.endsWith('.json'));
  }
}
