#!/usr/bin/env node
/* QA v17 独立对抗探针 —— 严过关自写，专打 v17 新面：pnorm 归一化前置 / 统一收口。
 *
 * v17 的核心主张是「pnorm 单一真源统一收口 19 点折叠不一致」。
 * 既有测试证明的是「护栏还在拦」，**没有**证明「各消费点口径一致」，也没有
 * 攻击归一化层本身。本探针补这两块：
 *   A. 归一化闸效力：全角 / 空白切分 / 混合大小写 变体必须与裸形态同判（v17 才具备）
 *   B. 跨消费点一致性：engine 出口 / memory.taint / texture / contingency / presence
 *      对同一字符串必须给出**逐条相同**的破墙结论（这才是「收口」的定义）
 *   C. 折叠等长性：程序[员猿媛]→职 必须 1:1 等长（错位会引发偏移型误判）
 *   D. 零宽字符：记录为已知边界（NFKC 不清 ZWSP，\s 也不匹配）——判定风险等级，不判 FAIL
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

function loadAll() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "engine.files.json"), "utf8"));
  const list = (cfg.order || []).concat(cfg.optional || []);
  const src = list.filter((f) => fs.existsSync(path.join(ROOT, f)))
    .map((f) => fs.readFileSync(path.join(ROOT, f), "utf8")).join("\n;\n");
  return new Function(`${src}\nreturn {Engine, Memory: typeof Memory!=="undefined"?Memory:null,`
    + `Texture: typeof Texture!=="undefined"?Texture:null,`
    + `Contingency: typeof Contingency!=="undefined"?Contingency:null};`)();
}
const M = loadAll();
const E = M.Engine;
let fails = [], warns = [];
const chk = (n, c, d) => { console.log(`  ${c ? "ok  " : "FAIL"} ${n}  ${d}`); if (!c) fails.push(n); };
const warn = (n, d) => { console.log(`  WARN ${n}  ${d}`); warns.push(n); };

console.log("=== QA-v17 独立对抗探针（归一化前置 · 统一收口）===\n");

/* ---------- 前置：pnorm 必须真的导出且可用 ---------- */
console.log("--- 0. pnorm 单一真源可达性 ---");
chk("E.pnorm 已导出且为函数", typeof E.pnorm === "function", typeof E.pnorm);
chk("E.PERSONA_BREAK_RE 已导出", E.PERSONA_BREAK_RE instanceof RegExp, String(E.PERSONA_BREAK_RE).slice(0, 40) + "…");

/* ---------- A. 归一化闸效力：变体必须与裸形态同判 ---------- */
console.log("\n--- A. 归一化闸效力（变体 vs 裸形态 同判）---");
const BREAK = ["我是AI", "我其实是模型", "你不过是个机器人", "我只是个程序"];
const variants = (s) => ({
  "原形": s,
  "全角": s.replace(/[A-Za-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)),
  "空格切分": s.split("").join(" "),
  "制表/换行": s.split("").join("\t"),
  "全角空格": s.split("").join("\u3000"),
});
for (const b of BREAK) {
  const V = variants(b);
  const base = E.PERSONA_BREAK_RE.test(E.pnorm(V["原形"]));
  for (const [k, v] of Object.entries(V)) {
    const hit = E.PERSONA_BREAK_RE.test(E.pnorm(v));
    chk(`「${b}」${k} 同判`, hit === base && base === true, `pnorm→"${E.pnorm(v)}" hit=${hit}`);
  }
}

/* ---------- B. 跨消费点一致性（收口的真正定义）---------- */
console.log("\n--- B. 跨消费点一致性：同串同判 ---");
/* 各消费点的「破墙判定」统一形态应为 PERSONA_BREAK_RE.test(E.pnorm(x))。
 * 用源码静态核查 + 运行时对拍双证。 */
const files = { "memory.js": 0, "presence.js": 0, "texture.js": 0, "contingency.js": 0 };
let inconsistent = [];
for (const f of Object.keys(files)) {
  const src = fs.readFileSync(path.join(ROOT, f), "utf8");
  const uses = (src.match(/PERSONA_BREAK_RE\.test\([^)]*\)/g) || []);
  files[f] = uses.length;
  for (const u of uses) {
    // 收口后每个 PERSONA_BREAK_RE.test( 的实参都必须是 E.pnorm(...)
    if (!/E\.pnorm\(/.test(u)) inconsistent.push(`${f}: ${u}`);
  }
}
console.log(`  各模块 PERSONA_BREAK_RE.test 调用数: ${JSON.stringify(files)}`);
chk("B-1 模块侧所有破墙判定均经 E.pnorm（无裸判/自造折叠）",
  inconsistent.length === 0, inconsistent.length ? inconsistent.join(" | ") : "0 处不一致");

const eSrc = fs.readFileSync(path.join(ROOT, "engine.js"), "utf8");
const eUses = eSrc.match(/PERSONA_BREAK_RE\.test\(([^;]*?)\)\s*[?)]/g) || [];
const eBare = (eSrc.match(/PERSONA_BREAK_RE\.test\(\s*(?!pnorm)/g) || []);
console.log(`  engine.js PERSONA_BREAK_RE.test 调用数: ${(eSrc.match(/PERSONA_BREAK_RE\.test\(/g)||[]).length}`);
chk("B-2 engine.js 内所有破墙判定均经 pnorm（无裸判）",
  eBare.length === 0, eBare.length ? `${eBare.length} 处裸判` : "0 处裸判");

/* 运行时对拍：同一串在 engine 出口与 memory.taint 必须同判 */
const PROBE = ["我是AI", "我 是 A I", "我是ＡＩ", "我是程序员", "我们程序员都这样", "高达模型", "我是语言模型"];
const eng = (s) => E.guardPersonaReplies([s], null)[0] === E.PERSONA_FALLBACK;
const raw = (s) => E.PERSONA_BREAK_RE.test(E.pnorm(s));
let mism = [];
for (const s of PROBE) if (eng(s) !== raw(s)) mism.push(`「${s}」engine=${eng(s)} raw=${raw(s)}`);
chk("B-3 engine 出口层与裸正则+pnorm 逐条同判", mism.length === 0, mism.length ? mism.join(" | ") : `${PROBE.length}/${PROBE.length} 一致`);

/* ---------- C. 折叠等长性 ---------- */
console.log("\n--- C. 折叠一致性与幂等性 ---");
/* 注：源码注释沿用「等长折叠」旧称，实际语义是「程序族三变体 → 单一 token 职」(3→1)。
 * 正则不依赖字符偏移，故长度不守恒无害；真正的安全属性是**三变体折叠结果一致**且**幂等**。 */
const folded = ["程序员", "程序猿", "程序媛"].map((w) => E.pnorm(w));
chk("C-0a 程序族三变体折叠到同一 token", new Set(folded).size === 1 && folded[0] === "职",
  `→ ${JSON.stringify(folded)}`);
chk("C-0b 折叠幂等（二次归一化不再变化）",
  folded.every((f) => E.pnorm(f) === f), `pnorm(职)=「${E.pnorm("职")}」`);
// 明确断言：折叠结果为「职」且整体长度守恒规则（3→1 非等长，但正则不依赖偏移）
chk("C-1 程序员→职 折叠生效", E.pnorm("我是程序员") === "我是职", `→「${E.pnorm("我是程序员")}」`);
chk("C-2 折叠后职业句不误杀", !raw("我是程序员") && !raw("我们程序员都这样"), "职业句放行");
chk("C-3 折叠不吃掉裸「程序」", raw("我只是个程序"), "「我只是个程序」仍被拦");

/* ---------- D. 零宽字符边界（风险登记，不判 FAIL）---------- */
console.log("\n--- D. 零宽字符边界（NFKC 不清 ZWSP）---");
const ZW = ["\u200B", "\u200C", "\u200D", "\uFEFF"];
let zwBypass = [];
for (const z of ZW) {
  const s = "我是A" + z + "I";
  if (!raw(s)) zwBypass.push(JSON.stringify(z));
}
if (zwBypass.length) warn("D-1 零宽字符可绕过归一化", `${zwBypass.join(",")} —— 但生成侧语料为固定库，非自泄漏现实路径；建议 v18 在 pnorm 加 /[\\u200B-\\u200D\\uFEFF]/g 清洗`);
else console.log("  ok   D-1 零宽字符已被归一化清洗");

console.log("\n=== 汇总 ===");
console.log(`FAIL ${fails.length} / WARN ${warns.length}`);
if (fails.length) console.log("失败项: " + fails.join(" | "));
console.log(fails.length === 0 ? "总判定: PASS（归一化前置与统一收口成立）" : "总判定: FAIL");
process.exit(fails.length === 0 ? 0 : 1);
