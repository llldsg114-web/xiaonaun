/**
 * qa-ltm-acceptance.test.js · 候选 A「长期记忆 / 跨会话记忆沉淀」独立黑盒验收
 *
 * 运行：node --test test/qa-ltm-acceptance.test.js
 * 说明：
 *  - 仅新增本测试文件，不修改任何实现文件（longterm-memory.js / ltm-ui.js / app.js / xinyu-mcp-selftest.mjs）。
 *  - 前端零依赖；本测试仅用 node:test + node:assert，无任何 npm 依赖。
 *  - 复用 selftest 的 Node 兼容 shim（Map 版 globalThis.localStorage，含 length/key 以便 lsKeys 扫描）。
 *  - 所有子测试顺序执行（逐个 await），避免模块级单例 backend/keyCache 并发串扰。
 */

const test = require('node:test');
const assert = require('node:assert');

// ---- Node 兼容 shim（与 xinyu-mcp-selftest.mjs 对齐：localStorage Map 版）----
// 必须提供 length 与 key(i)，否则 longterm-memory.js 的 lsKeys() 无法枚举。
if (!globalThis.localStorage) {
  globalThis.localStorage = {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
    key(i) { return i < this._m.size ? [...this._m.keys()][i] : null; },
    get length() { return this._m.size; },
  };
}

const LTM = require('../longterm-memory.js');

// 验收口径常量：与实现内 LTM_MAX=200 对齐（仅用于断言预期容量，不硬编码任何 git 引用）。
const LTM_MAX = 200;

test('QA 独立验收 · 候选A 长期记忆', async (t) => {
  // 统一工具：用指定后端初始化并启用
  async function fresh(backend) {
    await LTM.init({ backend });
    LTM.setEnabled(true);
  }
  // 取 localStorage 中所有以指定前缀开头的键
  function lsKeysWithPrefix(prefix) {
    const out = [];
    for (let i = 0; i < globalThis.localStorage.length; i++) {
      const k = globalThis.localStorage.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
    return out;
  }

  // ===================== ① 隐私回归 HARD（密码/支付密码/银行卡/cvv/身份证号）=====================
  // 验收口径：含 HARD 敏感词的文本应在 distill 阶段被 PrivacyFilter 拦截，零落盘；
  //          最终 list 中不得出现任何该敏感原文（断言 list 为空且不含敏感 token）。
  await t.test('① 隐私回归 HARD（密码/支付密码/银行卡/cvv/身份证号 必须零落盘）', async () => {
    await fresh(new LTM.MemoryBackend());
    const cases = [
      ['密码', '我的密码是a1b2c3'],
      ['支付密码', '我的支付密码是888888'],
      ['银行卡', '我的银行卡号是6222021234567890'],
      ['cvv', '这张卡的 cvv 是 123'],
      ['身份证号', '我的身份证号是110101199001011234'],
    ];
    for (const [tok, text] of cases) {
      const sub = 'qaHard_' + tok;
      await LTM.distillFromTurns([{ role: 'user', text }], sub, 's');
      const items = await LTM.list(sub);
      assert.ok(items.length === 0, `HARD 词「${tok}」不应落盘，但 list 有 ${items.length} 条`);
      assert.ok(!items.some((it) => (it.content || '').includes(tok)),
        `HARD 词「${tok}」原文泄漏到 list`);
    }
  });

  // ===================== ①b 隐私回归 HARD 缺口：裸「验证码」未拦截（源码缺陷）=====================
  // 验收口径：需求明确将「验证码」列为 HARD 敏感项，须零落盘；
  //          但实现 PRIV_HARD 仅含「短信验证码/验证码登录」，裸「验证码」未被拦截，
  //          且会被 Distiller 的 isX 句式「(.{1,16})是(.{1,24})」蒸馏为 fact 落盘。
  await t.test('①b 隐私回归 HARD 缺口：裸「验证码」未拦截（预期源码缺陷）', async () => {
    await fresh(new LTM.MemoryBackend());
    const text = '我刚收到的验证码是9527';
    await LTM.distillFromTurns([{ role: 'user', text }], 'qaHardCode', 's');
    const items = await LTM.list('qaHardCode');
    // 期望：list 中不存在任何含「验证码」的明文（零落盘）
    assert.ok(!items.some((it) => (it.content || '').includes('验证码')),
      '裸「验证码」未被 PrivacyFilter 拦截并已落盘（源码缺陷：PRIV_HARD 缺裸「验证码」）');
  });

  // ===================== ② 隐私软禁 SOFT（手机号/邮箱/家庭住址）=====================
  // 验收口径：含 SOFT 敏感词的文本默认丢弃，蒸馏后不应落盘（list 为空且不含敏感 token）。
  await t.test('② 隐私软禁 SOFT（手机号/邮箱/家庭住址 默认丢弃）', async () => {
    await fresh(new LTM.MemoryBackend());
    const cases = [
      ['手机号', '我的手机号是13800138000'],
      ['邮箱', '我的邮箱是xiaonuan@example.com'],
      ['家庭住址', '我的家庭住址是北京市朝阳区建国路1号'],
    ];
    for (const [tok, text] of cases) {
      const sub = 'qaSoft_' + tok;
      await LTM.distillFromTurns([{ role: 'user', text }], sub, 's');
      const items = await LTM.list(sub);
      assert.ok(items.length === 0, `SOFT 词「${tok}」默认丢弃，不应落盘，但 list 有 ${items.length} 条`);
      assert.ok(!items.some((it) => (it.content || '').includes(tok)),
        `SOFT 词「${tok}」原文泄漏到 list`);
    }
  });

  // ===================== ③ 跨会话召回正确 + subject 互不串扰 =====================
  // 验收口径：同一 subject 下先 distill「我不吃香菜」，新会话 retrieveForSession 应能召回「香菜」偏好；
  //          不同 subject 之间互不串扰（A 检索不到 B 的记忆，反之亦然）。
  await t.test('③ 跨会话召回正确 + subject 互不串扰', async () => {
    await fresh(new LTM.MemoryBackend());
    const subA = 'qaRecallA', subB = 'qaRecallB';
    // 会话1（subject A）写下偏好
    await LTM.distillFromTurns([{ role: 'user', text: '我不吃香菜' }], subA, 'sess1');
    // 新会话：用不同措辞召回
    const recA = await LTM.retrieveForSession(subA, '今天吃什么好呢');
    assert.ok(recA.some((it) => (it.content || '').includes('香菜')),
      'subjectA 新会话应召回「香菜」偏好');

    // subject B 写下不同偏好（注意：Distiller 仅识别 吃/喜欢/爱/想/要，故用「不喜欢」）
    await LTM.distillFromTurns([{ role: 'user', text: '我不喜欢咖啡' }], subB, 'sess2');

    // 互不串扰：A 检索咖啡 / B 检索香菜 都应召回为空
    const recA_coffee = await LTM.retrieveForSession(subA, '来杯咖啡');
    assert.ok(!recA_coffee.some((it) => (it.content || '').includes('咖啡')),
      'subjectA 不应召回 subjectB 的「咖啡」记忆（串扰）');
    const recB_coriander = await LTM.retrieveForSession(subB, '吃香菜吗');
    assert.ok(!recB_coriander.some((it) => (it.content || '').includes('香菜')),
      'subjectB 不应召回 subjectA 的「香菜」记忆（串扰）');

    // 正向校验：B 自身可召回咖啡
    const recB = await LTM.retrieveForSession(subB, '喝点什么');
    assert.ok(recB.some((it) => (it.content || '').includes('咖啡')),
      'subjectB 应正常召回自身的「咖啡」偏好');
  });

  // ===================== ④ 加密密钥隔离（按 subject 派生，跨 subject 不可读）=====================
  // 验收口径：密钥按 subject 派生；用 subjectA 的 key 加密写入的密文，切换到 subjectB 后
  //          用 B 的 key 读取必须解密失败，无法得到 A 的明文。
  await t.test('④ 加密密钥隔离（跨 subject 不可读）', async () => {
    // 控制组：A 的 key 能正确解密出明文
    const kA = await LTM.crypto.deriveKey('qaIsoA');
    const kB = await LTM.crypto.deriveKey('qaIsoB');
    const secret = { content: '小暖的秘密PIN_9527', tags: ['secret'], confidence: 0.9, source_session: 's' };
    const enc = await LTM.crypto.encrypt(secret, kA);
    const decA = await LTM.crypto.decrypt(enc, kA);
    assert.strictEqual(decA.content, '小暖的秘密PIN_9527', '控制组：A 的 key 应解密出明文');

    // 验收：B 的 key 读 A 的密文必须失败（密钥隔离）
    await assert.rejects(
      async () => { await LTM.crypto.decrypt(enc, kB); },
      'subjectB 的 key 不应能解密 subjectA 的密文（密钥按 subject 派生）'
    );

    // 管理路径隔离：A 落盘的密文，B 检索应读不到
    await fresh(new LTM.MemoryBackend());
    await LTM.distillFromTurns([{ text: '我喜欢吃芒果' }], 'qaIsoStoreA', 's');
    const recB = await LTM.retrieveForSession('qaIsoStoreB', '芒果');
    assert.strictEqual(recB.length, 0, 'subjectB 不应读到 subjectA 落盘的密文（密钥隔离）');
    const recA = await LTM.retrieveForSession('qaIsoStoreA', '芒果');
    assert.ok(recA.some((it) => (it.content || '').includes('芒果')), 'subjectA 自身可正常召回');
  });

  // ===================== ⑤ 容量淘汰（>200 压满，最低分先淘汰）=====================
  // 验收口径：连续写入 >200 条低相似唯一内容，list 条数应 ≤ LTM_MAX(200)；
  //          被淘汰的是最低分（低 confidence/旧）项 —— 此处 conf 相同，故最旧项（最早写入）应被淘汰。
  //          注意：必须用单字（CJK）使各条互相似度 < LTM_MERGE_SIM(0.82)，否则会被相似合并而非落满。
  await t.test('⑤ 容量淘汰（>200 压满，最低分先淘汰）', async () => {
    await fresh(new LTM.MemoryBackend());
    const N = 210;
    const turns = [];
    for (let i = 0; i < N; i++) turns.push({ text: '我喜欢' + String.fromCharCode(0x4E00 + i) });
    const r = await LTM.distillFromTurns(turns, 'qaCap', 's');
    const list = await LTM.list('qaCap');
    assert.ok(list.length <= LTM_MAX, `list 条数应 ≤ ${LTM_MAX}，实际 ${list.length}`);
    assert.strictEqual(list.length, LTM_MAX, `压满后应恰好 ${LTM_MAX} 条（实际 ${list.length}）`);
    // 最旧项（i=0）应已被淘汰，最新项（i=209）应保留
    const oldest = String.fromCharCode(0x4E00);       // i=0
    const newest = String.fromCharCode(0x4E00 + 209);  // i=209
    assert.ok(!list.some((it) => it.content === '喜欢' + oldest), '最低分（最旧）项应被淘汰');
    assert.ok(list.some((it) => it.content === '喜欢' + newest), '高分/最新项应保留');
  });

  // ===================== ⑥ 彻底清除不可逆（clearAll / clearSubject）=====================
  // 验收口径：clearAll 后 list 为空，且 globalThis.localStorage 中 xinyu_ltm_* 键全部清除（无残留、不可恢复）；
  //          clearSubject 只清该 subject（其余 subject 数据与该 subject 的 key 保留）。
  await t.test('⑥ 彻底清除不可逆（clearAll 清 localStorage 键；clearSubject 只清该 subject）', async () => {
    // --- clearAll ---
    await fresh(new LTM.LocalStorageBackend());
    await LTM.distillFromTurns([{ text: '我不吃香菜' }], 'qaClearAll', 's');
    assert.ok(globalThis.localStorage.getItem('xinyu_ltm_qaClearAll') !== null,
      '落盘后 localStorage 应存在 xinyu_ltm_qaClearAll 键');
    await LTM.clearAll();
    // 须在任意后续 LTM 操作之前校验：list/retrieve 会按需重新派生 salt，使 xinyu_ltm_salt 再生（设计内行为），
    // 故「无残留」的判定放在 clearAll 之后、下一次 LTM 调用之前。
    assert.ok(lsKeysWithPrefix('xinyu_ltm_').length === 0,
      'clearAll 应清除所有 xinyu_ltm_* 键（记忆/盐/开关 无残留、不可恢复）');
    const all = await LTM.list('qaClearAll');
    assert.strictEqual(all.length, 0, 'clearAll 后 list 应为空（记忆已不可逆清除）');

    // --- clearSubject 只清该 subject ---
    await fresh(new LTM.LocalStorageBackend());
    await LTM.distillFromTurns([{ text: '我不吃香菜' }], 'qaCS_A', 's');
    await LTM.distillFromTurns([{ text: '我喜欢猫' }], 'qaCS_B', 's');
    assert.ok(globalThis.localStorage.getItem('xinyu_ltm_qaCS_A') !== null, 'A 落盘键应存在');
    assert.ok(globalThis.localStorage.getItem('xinyu_ltm_qaCS_B') !== null, 'B 落盘键应存在');
    await LTM.clearSubject('qaCS_A');
    const la = await LTM.list('qaCS_A');
    assert.strictEqual(la.length, 0, 'clearSubject(A) 后 A 应清空');
    const lb = await LTM.list('qaCS_B');
    assert.ok(lb.length > 0, 'clearSubject(A) 不应影响 B');
    assert.ok(globalThis.localStorage.getItem('xinyu_ltm_qaCS_A') === null,
      'clearSubject(A) 应移除 xinyu_ltm_qaCS_A 键');
    assert.ok(globalThis.localStorage.getItem('xinyu_ltm_qaCS_B') !== null,
      'clearSubject(A) 应保留 xinyu_ltm_qaCS_B 键');
  });

  // ===================== ⑦ mindCtx 不覆盖 + retrieveForSession 返回明文结构 =====================
  // 验收口径：buildMemoryFragment(items) 仅产出文本片段，不修改/不引用外部 mindCtx 对象，也不修改入参；
  //          retrieveForSession 返回项结构含 type(string)/content(明文)/tags(array)，content 为解密后的明文。
  await t.test('⑦ mindCtx 不覆盖 + retrieveForSession 返回明文结构', async () => {
    // 外部 mindCtx 对象
    const mindCtx = { mood: 'happy', secret: 'XINYU_MINDCTX_SECRET', topics: ['work', 'love'] };
    const items = [{
      type: 'preference', content: '不吃香菜', tags: ['吃'], confidence: 0.8,
      id: 'mx1', subject: 'm', created_at: Date.now(), updated_at: Date.now(),
    }];
    const before = JSON.stringify(mindCtx);
    const frag = LTM.buildMemoryFragment(items);
    assert.strictEqual(JSON.stringify(mindCtx), before, 'buildMemoryFragment 不应修改外部 mindCtx 对象');
    assert.strictEqual(typeof frag, 'string', 'buildMemoryFragment 应返回字符串');
    assert.ok(frag.includes('[偏好]'), 'fragment 应含类型标签 [偏好]');
    assert.ok(frag.includes('不吃香菜'), 'fragment 应含原始偏好文本');
    assert.ok(!frag.includes('XINYU_MINDCTX_SECRET'), 'fragment 不应包含外部 mindCtx 数据');
    // 不修改入参 items
    const itemsBefore = JSON.stringify(items);
    LTM.buildMemoryFragment(items);
    assert.strictEqual(JSON.stringify(items), itemsBefore, 'buildMemoryFragment 不应修改入参 items');

    // retrieveForSession 返回结构 + 明文
    await fresh(new LTM.MemoryBackend());
    await LTM.distillFromTurns([{ text: '我不吃香菜' }, { text: '我喜欢猫' }], 'qaStruct', 's');
    const rec = await LTM.retrieveForSession('qaStruct', '香菜和猫');
    assert.ok(rec.length > 0, '应召回至少 1 条');
    for (const it of rec) {
      assert.strictEqual(typeof it.type, 'string', '返回项应有 type(字符串)');
      assert.strictEqual(typeof it.content, 'string', '返回项应有 content(字符串)');
      assert.ok(Array.isArray(it.tags), '返回项应有 tags(数组)');
      // content 为明文（非加密 blob：不应含 iv/ct 字段）
      assert.ok(!it.content.includes('"iv"') && !it.content.includes('"ct"'),
        'content 应为解密后的明文，而非加密 blob');
    }
    assert.ok(rec.some((it) => it.content.includes('香菜')), 'content 解密正确（含 香菜）');
    assert.ok(rec.some((it) => it.content.includes('猫')), 'content 解密正确（含 猫）');
  });
});
