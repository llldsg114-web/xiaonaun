/**
 * IdempotencyStore — event_id 幂等落盘（基础设施层，基于 JsonlStore）。
 *
 * 保障「同一 event_id 重复调用返回历史结果，不二次改写状态」（P0-2）。
 *
 * v2 ① 多会话隔离：构造函数新增可选 `file?: string`（缺省回退 `IDEM_FILE`），
 * 向后兼容 `new IdempotencyStore(store)`。
 */

import type { EventResult, IdempotencyRecord } from '../types/index.js';
import { IDEM_FILE } from '../config.js';
import { JsonlStore } from './jsonlStore.js';

export class IdempotencyStore {
  private readonly store: JsonlStore;
  private readonly idemFile: string;

  constructor(store: JsonlStore, file?: string) {
    this.store = store;
    this.idemFile = file ?? IDEM_FILE;
  }

  /** 是否已处理过该 event_id。 */
  seen(event_id: string): boolean {
    return this.get(event_id) !== null;
  }

  /** 读取历史处理结果；未命中返回 null。 */
  get(event_id: string): EventResult | null {
    const records = this.store.readWhere(
      this.idemFile,
      (r: object) => (r as IdempotencyRecord).event_id === event_id,
    ) as IdempotencyRecord[];
    return records.length > 0 ? records[0].result : null;
  }

  /** 标记已处理并落盘。 */
  mark(event_id: string, result: EventResult): void {
    const record: IdempotencyRecord = {
      event_id,
      result,
      created_at: new Date().toISOString(),
    };
    this.store.append(this.idemFile, record);
  }
}
