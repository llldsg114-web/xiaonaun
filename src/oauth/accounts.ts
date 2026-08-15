/**
 * accounts.ts — v2 ② 本地自托管账户（scrypt 口令哈希，零新依赖）。
 *
 * 落盘于 STORAGE_DIR / ACCOUNT_STORE_FILE（JSONL，每行一条 AccountRecord）。
 * 仅用 node:crypto（scryptSync / randomBytes / timingSafeEqual），不引入任何
 * 第三方依赖。首跑引导创建默认 owner 账户。
 *
 * 协议：MIT。100% 自研。
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { JsonlStore } from '../storage/jsonlStore.js';
import {
  ACCOUNT_STORE_FILE,
  OWNER_USERNAME,
  STORAGE_DIR,
  XY_OWNER_PASSWORD,
} from '../config.js';
import type { AccountRecord } from '../types/index.js';

/**
 * AccountStore — 本地账户存储（scrypt 口令哈希）。
 */
export class AccountStore {
  private readonly store: JsonlStore;

  constructor(store?: JsonlStore) {
    this.store = store ?? new JsonlStore(STORAGE_DIR);
  }

  /** 读取全部账户记录。 */
  private all(): AccountRecord[] {
    return this.store.readAll(ACCOUNT_STORE_FILE) as AccountRecord[];
  }

  /** 账户是否已存在。 */
  exists(username: string): boolean {
    return this.all().some((r) => r.username === username);
  }

  /** 创建账户（重复用户名抛错）。 */
  create(username: string, password: string): AccountRecord {
    if (this.exists(username)) {
      throw new Error(`account already exists: ${username}`);
    }
    const pwSalt = randomBytes(16).toString('hex');
    const pwHash = scryptSync(password, pwSalt, 64).toString('hex');
    const record: AccountRecord = {
      username,
      pwHash,
      pwSalt,
      createdAt: new Date().toISOString(),
    };
    this.store.append(ACCOUNT_STORE_FILE, record);
    return record;
  }

  /** 校验口令（timingSafeEqual 恒定时间比较；账户不存在返回 false）。 */
  verify(username: string, password: string): boolean {
    const record = this.all().find((r) => r.username === username);
    if (!record) return false;
    const candidate = scryptSync(password, record.pwSalt, 64);
    const expected = Buffer.from(record.pwHash, 'hex');
    if (expected.length !== candidate.length) return false;
    return timingSafeEqual(candidate, expected);
  }

  /** 列出全部账户。 */
  list(): AccountRecord[] {
    return this.all();
  }

  /**
   * 首跑引导：若无 owner 账户则创建。
   * - 口令取 XY_OWNER_PASSWORD；未设则随机生成并打印「FIRST RUN OWNER PASSWORD」横幅。
   * @returns 是否本次新建（generated=true 表示随机口令，需人工捕获）。
   */
  ensureOwner(): { username: string; password: string; generated: boolean } {
    if (this.exists(OWNER_USERNAME)) {
      return { username: OWNER_USERNAME, password: '', generated: false };
    }
    const generated = XY_OWNER_PASSWORD === undefined;
    const password = XY_OWNER_PASSWORD ?? randomBytes(16).toString('hex');
    this.create(OWNER_USERNAME, password);
    if (generated) {
      const banner = [
        '',
        '='.repeat(64),
        '  FIRST RUN OWNER PASSWORD',
        `  username : ${OWNER_USERNAME}`,
        `  password : ${password}`,
        '  请将此口令妥善保存（仅本次打印；可经 XY_OWNER_PASSWORD 环境变量覆写）',
        '='.repeat(64),
        '',
      ].join('\n');
      // 仅首跑随机口令时打印一次（控制台捕获）。
      console.log(banner);
    }
    return { username: OWNER_USERNAME, password, generated };
  }
}
