const test = require('node:test');
const assert = require('node:assert');
const LTM = require('../longterm-memory.js');

test('① crypto 加解密往返（含中文）', async () => {
  const key = await LTM.crypto.deriveKey('subjectA');
  const obj = { content: '小暖喜欢吃苹果', tags: ['吃', '喜好'], confidence: 0.8, source_session: 'conv-1' };
  const enc = await LTM.crypto.encrypt(obj, key);
  assert.ok(typeof enc.iv === 'string' && enc.iv.length > 0);
  assert.ok(typeof enc.ct === 'string' && enc.ct.length > 0);
  const dec = await LTM.crypto.decrypt(enc, key);
  assert.strictEqual(dec.content, '小暖喜欢吃苹果');
  assert.deepStrictEqual(dec.tags, ['吃', '喜好']);
  assert.strictEqual(dec.confidence, 0.8);
});

test('①b 错误密钥解密失败', async () => {
  const k1 = await LTM.crypto.deriveKey('a');
  const k2 = await LTM.crypto.deriveKey('b');
  const enc = await LTM.crypto.encrypt({ content: 'x', tags: [], confidence: 0.5, source_session: 's' }, k1);
  await assert.rejects(async () => { await LTM.crypto.decrypt(enc, k2); });
});

test('② PrivacyFilter HARD/SOFT/未命中', () => {
  assert.strictEqual(LTM.privacy.shouldBlock('我的密码是123').blocked, true);
  assert.strictEqual(LTM.privacy.shouldBlock('我的手机号是13800000000').blocked, true);
  assert.strictEqual(LTM.privacy.shouldBlock('我喜欢猫').blocked, false);
});

test('③ Distiller 抽取 fact/preference/agreement', () => {
  const prefs = LTM.distiller.extractItems('我不吃香菜。我喜欢猫。', {});
  assert.ok(prefs.map((p) => p.type).includes('preference'));
  const agr = LTM.distiller.extractItems('我们约好去旅行', {});
  assert.ok(agr.some((a) => a.type === 'agreement'));
  const facts = LTM.distiller.extractItems('我住在上海。香蕉是黄色的。', {});
  assert.ok(facts.some((f) => f.type === 'fact'));
});

test('③b merge 去重（同内容两次 -> 1 条）', () => {
  const cand = (c) => ({ subject: 's', type: 'preference', content: c, confidence: 0.8, tags: ['喜好'] });
  const res = LTM.distiller.merge([], [cand('我喜欢猫'), cand('我喜欢猫')]);
  assert.strictEqual(res.items.length, 1);
  assert.strictEqual(res.added, 1);
  assert.strictEqual(res.updated, 1);
});

test('③c merge 相似合并(>=0.82)', () => {
  const cand = (c) => ({ subject: 's', type: 'preference', content: c, confidence: 0.8, tags: ['喜好'] });
  const res = LTM.distiller.merge([], [cand('我不吃香菜'), cand('我不吃香菜了')]);
  assert.strictEqual(res.items.length, 1);
});

test('④ Retriever 打分排序/topK/minConf', () => {
  const now = Date.now();
  const items = [
    { id: '1', subject: 's', type: 'preference', content: '我不吃香菜', tags: ['吃'], confidence: 0.9, updated_at: now },
    { id: '2', subject: 's', type: 'preference', content: '我喜欢猫', tags: ['喜好'], confidence: 0.9, updated_at: now },
    { id: '3', subject: 's', type: 'fact', content: '我住在上海', tags: ['家'], confidence: 0.9, updated_at: now },
    { id: '4', subject: 's', type: 'fact', content: '低置信项', tags: [], confidence: 0.4, updated_at: now },
  ];
  const top = LTM.retriever.retrieve(items, '吃香菜', { topK: 1 });
  assert.strictEqual(top.length, 1);
  assert.strictEqual(top[0].id, '1');
  const all = LTM.retriever.retrieve(items, '我', {});
  assert.ok(all.length >= 3);
  const filt = LTM.retriever.retrieve(items, '我', { minConf: 0.5 });
  assert.ok(!filt.some((i) => i.id === '4'));
  const ranked = LTM.retriever.retrieve(items, '猫', { topK: 3 });
  assert.strictEqual(ranked[0].id, '2');
});

test('⑤ 容量 200 触发淘汰（最低分先走）', async () => {
  await LTM.init({ backend: new LTM.MemoryBackend() });
  LTM.setEnabled(true);
  const turns = [];
  for (let i = 0; i < 200; i++) turns.push({ text: '我喜欢' + String.fromCharCode(0x4E00 + i) });
  const r1 = await LTM.distillFromTurns(turns, 'cap', 'c');
  assert.strictEqual(r1.added, 200);
  const list1 = await LTM.list('cap');
  assert.strictEqual(list1.length, 200);
  await LTM.distillFromTurns([{ text: '香蕉是黄色的' }], 'cap', 'c');
  const list2 = await LTM.list('cap');
  assert.strictEqual(list2.length, 200);
  assert.ok(!list2.some((it) => it.content === '香蕉是黄色的'));
});

test('⑥ CRUD（put/get/update 留痕/remove，用 MemoryBackend）', async () => {
  await LTM.init({ backend: new LTM.MemoryBackend() });
  LTM.setEnabled(true);
  const r = await LTM.distillFromTurns([{ text: '我喜欢猫' }], 'crud', 'c');
  assert.strictEqual(r.added, 1);
  const items = await LTM.list('crud');
  assert.strictEqual(items.length, 1);
  const id = items[0].id;
  const got = await LTM.get(id);
  assert.ok(got && got.content === '喜欢猫');
  const before = got.updated_at;
  await LTM.update(id, '我喜欢狗');
  const got2 = await LTM.get(id);
  assert.strictEqual(got2.content, '我喜欢狗');
  assert.ok(got2.updated_at >= before);
  await LTM.remove(id);
  const after = await LTM.list('crud');
  assert.strictEqual(after.length, 0);
});

test('⑦ 持久化闭环（distillFromTurns -> list）', async () => {
  await LTM.init({ backend: new LTM.MemoryBackend() });
  LTM.setEnabled(true);
  const turns = [
    { text: '我不吃香菜' }, { text: '我喜欢猫' },
    { text: '我们约好去旅行' }, { text: '我住在上海' },
  ];
  const r = await LTM.distillFromTurns(turns, 'persist', 'c');
  assert.ok(r.added >= 3);
  const items = await LTM.list('persist');
  assert.ok(items.length >= 3);
  const types = new Set(items.map((i) => i.type));
  assert.ok(types.has('preference'));
  assert.ok(types.has('agreement'));
  assert.ok(types.has('fact'));
});

test('⑧ buildMemoryFragment 非空且剔除矛盾项', () => {
  const items = [
    { type: 'preference', content: '我不吃香菜', tags: ['吃'], confidence: 0.8, updated_at: Date.now(), created_at: Date.now(), id: '1', subject: 's' },
    { type: 'preference', content: '我喜欢猫', tags: ['喜好'], confidence: 0.8, updated_at: Date.now(), created_at: Date.now(), id: '2', subject: 's' },
  ];
  const frag = LTM.buildMemoryFragment(items, { exclude: ['不吃香菜'] });
  assert.ok(frag.length > 0);
  assert.ok(frag.includes('喜欢猫'));
  assert.ok(!frag.includes('不吃香菜'));
});
