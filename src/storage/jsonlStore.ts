/**
 * JsonlStore — 零依赖 JSONL 读写（基础设施层）。
 *
 * 仅使用 Node `fs` 同步 API（v1 落地，确定性好、易于测试）。
 * 每条记录独占一行 JSON；支持追加、全量读、按谓词读、过期 GC。
 *
 * 预留升级位：未来可替换为 better-sqlite3(MIT)+向量，不改变调用契约。
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export class JsonlStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /** 将相对路径解析为绝对路径（绝对路径原样返回）。 */
  private filePath(relative: string): string {
    return path.isAbsolute(relative) ? relative : path.join(this.dir, relative);
  }

  /** 追加一条记录（JSON 单行）。 */
  append(relative: string, record: object): void {
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(this.filePath(relative), JSON.stringify(record) + '\n', 'utf8');
  }

  /** 读取全部记录；文件不存在返回空数组。 */
  readAll(relative: string): object[] {
    const fp = this.filePath(relative);
    if (!existsSync(fp)) return [];
    const raw = readFileSync(fp, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as object);
  }

  /** 按谓词过滤读取。 */
  readWhere(relative: string, pred: (record: object) => boolean): object[] {
    return this.readAll(relative).filter(pred);
  }

  /**
   * 过期 GC：删除 expires_at 早于 now 的记录（就地重写文件）。
   * 无 expires_at 字段的记录视为永久保留。
   * @returns 被清理的记录数。
   */
  gcExpired(relative: string, now: Date = new Date()): number {
    const all = this.readAll(relative);
    const remaining = all.filter((record: object) => {
      const exp = (record as { expires_at?: string }).expires_at;
      if (typeof exp !== 'string') return true;
      return new Date(exp).getTime() > now.getTime();
    });
    const removed = all.length - remaining.length;
    if (removed > 0) {
      mkdirSync(this.dir, { recursive: true });
      const content =
        remaining.map((r) => JSON.stringify(r)).join('\n') + (remaining.length ? '\n' : '');
      writeFileSync(this.filePath(relative), content, 'utf8');
    }
    return removed;
  }
}
