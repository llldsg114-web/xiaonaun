/**
 * pkce.ts — PKCE(S256) 与随机令牌工具（无状态，零依赖）。
 *
 * 所有密码学原语来自 Node 内置 `node:crypto`：
 * - generateVerifier / challengeS256 / verify 实现 RFC7636 PKCE(S256)
 * - randomToken / jti 生成不可预测的不透明串与唯一标识
 *
 * 协议：MIT。100% 自研。
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** 将 Buffer 转为 URL-safe Base64（无填充）。 */
function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * PKCE / 随机令牌工具类。无状态，可安全构造多个实例。
 */
export class PkceUtil {
  /**
   * 生成 PKCE code_verifier（RFC7636 建议 43~128 字符）。
   * 使用 32 字节随机 → 43 字符 base64url。
   */
  generateVerifier(): string {
    return toBase64Url(randomBytes(32));
  }

  /**
   * 计算 S256 code_challenge = BASE64URL(SHA256(verifier))。
   * @param verifier PKCE code_verifier
   */
  challengeS256(verifier: string): string {
    return toBase64Url(createHash('sha256').update(verifier).digest());
  }

  /**
   * 校验 code_verifier 是否匹配 code_challenge（S256）。
   * @returns true 表示匹配
   */
  verify(verifier: string, challenge: string): boolean {
    if (!verifier || !challenge) return false;
    try {
      return this.challengeS256(verifier) === challenge;
    } catch {
      return false;
    }
  }

  /**
   * 生成指定字节数的 URL-safe 随机不透明串（用于 auth code / refresh token）。
   */
  randomToken(bytes = 32): string {
    return toBase64Url(randomBytes(bytes));
  }

  /** 生成 RFC4122 v4 UUID（用作 JWT jti 或唯一标识）。 */
  jti(): string {
    return randomUUID();
  }
}
