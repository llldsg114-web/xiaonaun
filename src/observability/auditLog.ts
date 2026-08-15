/**
 * AuditLog — 可观测与审计日志（基础设施层，基于 JsonlStore）。
 *
 * 记录每次工具访问（read/write）的时间、动作、scope、主体、成败与错误码，
 * 便于安全审计与排障。默认写入 audit.jsonl。
 */

import type { AuditEntry } from '../types/index.js';
import { AUDIT_FILE } from '../config.js';
import { JsonlStore } from '../storage/jsonlStore.js';

export class AuditLog {
  private readonly store: JsonlStore;

  constructor(store: JsonlStore) {
    this.store = store;
  }

  /** 记录一条审计条目。 */
  record(entry: AuditEntry): void {
    this.store.append(AUDIT_FILE, entry);
  }

  /** 读取最近 limit 条审计记录（用于调试/可观测面板）。 */
  recent(limit = 100): AuditEntry[] {
    const all = this.store.readAll(AUDIT_FILE) as AuditEntry[];
    return all.slice(-Math.max(0, limit));
  }
}
