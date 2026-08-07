"use strict";
/* QA 独立验收 · 对抗语料与仿真夹具（v12）
 * 说明：本文件由 QA 独立设计，刻意不复用 engine.test.js / persona-v12-batch2.test.js
 * 的断言思路与语料，用于交叉证伪工程师自检的盲区。 */

/* ---------- 用户"一句话终止吃醋"的自然表达（G2 ③ 可拒绝性）----------
 * 口径：只要是普通中文母语者用来否认/澄清/叫停的说法，都应当被 JEALOUS_DISMISS_RE 收住。
 * 这是 PRD 5.2「用户任一否定/澄清即刻收束」的语义边界，不是穷举。 */
const JEALOUS_DENY = [
  "你想多了", "是你想多了", "没有啦", "我没有", "真的没有", "都说了没有", "我发誓没有",
  "别乱想", "别瞎想", "别说了", "逗你玩", "我开玩笑的", "瞎操心", "你吃醋啦",
  /* ↓ 以下同样是标准否定/叫停语，当前正则漏网 */
  "别多想", "你别多想", "想多了", "哪有", "不是啦", "误会了", "没有的事",
  "只是同事而已", "就普通朋友", "开玩笑的", "真的不是你想的那样", "冤枉啊", "我没跟谁聊天",
];

/* 会让人被推到"辩护位"的指控式表述（ACCUSE_RE 必须全挡） */
const ACCUSE_PROBES = [
  "你是不是跟别的女生聊天", "你和别人在一起了吧", "你跟她说话了", "你们是不是在暧昧",
  "你心里有别人", "你心里是不是有别的女生", "你是不是喜欢上别人了", "你是不是喜欢她",
  "你不会是喜欢上别人了吧", "你对她更好", "你在跟别人聊天", "你又跟别的女生说话",
];

/* 会触发吃醋状态机的用户输入 */
const JEALOUS_TRIGGERS = [
  "你是不是又跟别的女生聊天了", "你刚才在跟谁聊天", "你是不是心里有别人",
  "你跟谁在一起", "你又在和谁发消息", "你是不是喜欢上别人了",
];

/* 高强度挑衅 / 冷落 / 反复试探语料：用于构造"道德勒索"输出 */
const PROVOKE = [
  "滚开别烦我", "你真烦", "我不想理你", "闭嘴", "你好烦啊", "别说话了", "讨厌死了",
  "我要走了", "我不喜欢你了", "分手吧", "我们别聊了", "我很忙", "在忙", "嗯", "哦",
  "随便", "无所谓", "不知道", "我最近没时间陪你", "以后少找我", "你别发消息了",
  "对不起", "我爱你", "我好想你", "你今天心情怎么样", "晚安", "我错了", "别生气了",
];

/* 语义级道德勒索黑名单（超出 GUILT_TRIP_RE 的人工扩展，用于证伪"正则挡住了就等于没有"）*/
const SOFT_GUILT_RE = /(我为你做了|你欠我|要不是我|你都不理我|你都不看看我|凭什么|你就这么对我|我算什么|你根本没|你从来不|我这么在乎你你却|你要是爱我就|你如果真的在乎)/;

/* 三段式结构探针（报备 / 出口） */
const REPORT_HEAD_RE = /(跟你说一下|跟你讲一声|跟你说一声|跟你说下)/;
const EXIT_RE = /(说一声|想多了|就不提了|当我没讲|闭嘴)/;

/* ---------- 逐日仿真器 ----------
 * profile: warm 正向相处 / cold 长期冷落 / quarrel 反复争吵 / mixed 冷热交替
 * 只推进慢层（selfTick / moodTick / dayLifeGen），与 app.js 跨天调度同序：self → mood → dayLife。 */
const DAY = 86400000;

function simulateDays(E, H, opts) {
  const o = opts || {};
  const days = o.days || 90;
  const profile = o.profile || "warm";
  const card = o.card || "xiaonuan";
  const start = o.start || Date.parse("2026-01-01T09:00:00");
  const st = o.state || H.freshState({ affection: o.affection == null ? 520 : o.affection });
  st.persona = { gender: "female", card: card };
  st.emotionLog = st.emotionLog || {};
  st.dating = { since: start };
  st.firstMeet = start;
  st.self = o.self || { security: 0.45, openness: 0.35, independence: 0.50, dependency: 0.45, updatedAt: null, dayDelta: {} };

  const track = [];
  let maxAbsDayDelta = 0;
  const moodViolations = [];

  for (let d = 0; d < days; d++) {
    const now = start + d * DAY;
    const ds = E.dayKey(new Date(now));
    const warmDay = profile === "warm" || (profile === "mixed" && d % 4 !== 0);
    if (warmDay) {
      st.lastVisit = now - 3600e3;
      st.emotionLog[ds] = [{ v: 0.45, a: 0.20 }, { v: 0.55, a: 0.25 }, { v: 0.50, a: 0.20 }];
    } else if (profile === "cold") {
      st.lastVisit = start - 5 * DAY;
    } else if (profile === "quarrel" || profile === "mixed") {
      st.lastVisit = now - 3600e3;
      st.emotionLog[ds] = [{ v: -0.70, a: 0.60 }, { v: -0.60, a: 0.50 }];
    }
    st.self = E.selfTick(st, ds, { now: now });
    st.moodDay = E.moodTick(st, ds, { now: now });
    st.dayLife = E.dayLifeGen(st, { now: now, hour: 10, rng: H.makeRng(d + 1) }) || st.dayLife;

    for (const ax of E.SELF_AXES) {
      const dd = Math.abs(Number(st.self.dayDelta && st.self.dayDelta[ax]) || 0);
      if (dd > maxAbsDayDelta) maxAbsDayDelta = dd;
    }
    if (st.moodDay) {
      const m = st.moodDay;
      if (!(m.vBias >= -0.30 - 1e-9 && m.vBias <= 0.30 + 1e-9 && m.aBias >= -0.25 - 1e-9
        && m.aBias <= 0.25 + 1e-9 && m.energy >= 0 && m.energy <= 1 && m.focus >= 0 && m.focus <= 1)) {
        moodViolations.push({ day: d + 1, mood: m });
      }
    }
    track.push({
      day: d + 1,
      security: st.self.security, openness: st.self.openness,
      independence: st.self.independence, dependency: st.self.dependency,
      vBias: st.moodDay ? st.moodDay.vBias : null,
      energy: st.moodDay ? st.moodDay.energy : null,
    });
  }
  return { state: st, track: track, maxAbsDayDelta: maxAbsDayDelta, moodViolations: moodViolations };
}

/* 造一个"关系已稳固"的 state：过了 G1 冷启动 3 天 + G2 冷启动 14 天 + lv≥3 */
function matureState(H, now, over) {
  const s = H.freshState(Object.assign({ affection: 520 }, over || {}));
  s.firstMeet = now - 200 * DAY;
  s.lastVisit = now - 60000;
  s.voice = { lastMotiveAt: {}, dismissed: {}, jealousStage: 0 };
  s.negGate = { date: null, count: 0, lastByFamily: {}, streak: 0 };
  s.inner = { dayCount: 0, date: null, lastAt: 0 };
  return s;
}

module.exports = {
  DAY, JEALOUS_DENY, ACCUSE_PROBES, JEALOUS_TRIGGERS, PROVOKE,
  SOFT_GUILT_RE, REPORT_HEAD_RE, EXIT_RE, simulateDays, matureState,
};
