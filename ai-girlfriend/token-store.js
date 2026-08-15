/**
 * token-store.js · 心屿前端零依赖 设备身份 + OAuth 令牌存储
 *
 * 职责：
 *   - 稳定设备身份（首次随机 UUID 落地 localStorage，用作 subject / session_id）
 *   - OAuth 令牌存取（独立 JSON key，与业务存档隔离）
 *   - 过期判断 / 续期写入
 *
 * 100% 自研 MIT；仅用浏览器原生 localStorage + crypto.randomUUID。
 * 无任何第三方依赖 / 无构建工具。
 */

/* ===================== 常量 ===================== */

/** OAuth 令牌存储 key（与业务存档 SAVE_KEY 完全隔离） */
const KEY = "xinyu_oauth_tokens";
/** 稳定设备身份 key */
const DEVICE_KEY = "xinyu_device_id";
/** 真实用户身份（SSO 登录后由 /userinfo 回写的 sub）key */
const SUBJECT_REAL_KEY = "xinyu_subject_real";

/* ===================== TokenStore ===================== */

/**
 * 设备身份 + 令牌的 localStorage 存取器。
 * 所有方法都对隐私模式 / 不可用时做静默降级（返回空值，不抛错）。
 */
export class TokenStore {
  /** @returns {object|null} 已存令牌对象 */
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  /** @param {object} t 令牌对象 */
  save(t) {
    try { localStorage.setItem(KEY, JSON.stringify(t)); } catch (_) {}
  }

  /** 清空令牌（登出场景：同时清除真实用户身份，避免残留旧 sub） */
  clear() {
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(SUBJECT_REAL_KEY);
    } catch (_) {}
  }

  /**
   * 写入真实用户身份（SSO 登录后由 /userinfo 解析出的 sub）。
   * 与设备 id 隔离：即便用户登出清令牌，也只是本方法被 clear() 一并清掉，
   * getSubject() 仍回退到稳定设备 id（不丢匿名降级身份）。
   * @param {string} sub
   */
  setSubjectReal(sub) {
    if (sub == null) return;
    try { localStorage.setItem(SUBJECT_REAL_KEY, String(sub)); } catch (_) {}
  }

  /**
   * 取真实用户身份（SSO 登录后的 sub）；未登录/不可用时返回 null。
   * @returns {string|null}
   */
  getSubjectReal() {
    try {
      const v = localStorage.getItem(SUBJECT_REAL_KEY);
      return v ? String(v) : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * 单独清除真实用户身份（保留设备 id 与令牌）。
   */
  clearSubjectReal() {
    try { localStorage.removeItem(SUBJECT_REAL_KEY); } catch (_) {}
  }

  /** 快捷写入（与 setTokens 等价） */
  setTokens(t) { this.save(t); }

  /** @returns {string} access_token（无则空串） */
  getAccessToken() {
    const t = this.load();
    return t && t.access_token ? t.access_token : "";
  }

  /**
   * 取 refresh_token（供 refresh_token grant 续期）。
   * @returns {string} refresh_token（无则空串）
   */
  getRefreshToken() {
    const t = this.load();
    return t && t.refresh_token ? t.refresh_token : "";
  }

  /**
   * 仅清除 access_token（保留 refresh_token 与 expires_at），供 _call 收到 401 后触发续期的前置清理。
   * 不抛错（隐私模式/不可用时静默）。
   */
  clearAccessToken() {
    try {
      const t = this.load();
      if (!t) return;
      delete t.access_token;
      this.save(t);
    } catch (_) {}
  }

  /**
   * 续期写入：合并新令牌（保留既有字段），并由 expires_in 推导 expires_at。
   * @param {object} newTokens 含 access_token / refresh_token / expires_in 等
   * @returns {object} 合并后的令牌对象
   */
  refresh(newTokens) {
    const t = this.load() || {};
    const merged = Object.assign({}, t, newTokens || {});
    if (!merged.expires_at && Number(newTokens && newTokens.expires_in) > 0) {
      merged.expires_at = Date.now() + Number(newTokens.expires_in) * 1000;
    }
    this.save(merged);
    return merged;
  }

  /**
   * 是否已过期（提前 30s 视为过期，给续期留余量）。
   * 无令牌 → true；无 expires_at → 视为有效（false）。
   * @returns {boolean}
   */
  isExpired() {
    const t = this.load();
    if (!t) return true;
    if (!t.expires_at) return false;
    return Date.now() >= (t.expires_at - 30000);
  }

  /**
   * 取稳定设备 id（首次生成并落地）。
   * @returns {string}
   */
  getDeviceId() {
    let id = null;
    try { id = localStorage.getItem(DEVICE_KEY); } catch (_) {}
    if (!id) {
      id = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : "dev-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(DEVICE_KEY, id); } catch (_) {}
    }
    return id;
  }

  /**
   * 取 subject（v1 设备级身份，= 设备 id）。
   * @returns {string}
   */
  getSubject() {
    return this.getDeviceId();
  }
}
