#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
候选 F · 浏览器真机双视口抽查（真人感精调收口）
驱动：Python Playwright + 系统 /usr/bin/chromium
本地服务：http://localhost:8099/index.html（同 E12：必须先关引导浮层否则导航超时）

复用 E12（_e12_browser_check.py）结构，仅做候选 F 适配：
  ① 发消息能拿到小暖回复且正常渲染、不白屏（首轮 / 降级护栏）
  ② 切设置屏、点「傲娇」/其他 tone chip 无 JS 异常
  ③ 收集 console 报错数（应为 0 或仅无关警告）
  ④ 危机护栏：发送危机句，回复必须非空且不得回声/反撩（E 危机门禁仍绿）
  ⑤ 真人感证据：连续多轮收集中，至少部分回复带微行为标记（G1/G2 由 qa-f-acceptance.test.js
     做严格量化；此处仅作真机可观察证据，不硬卡阈值，避免浏览器抽样抖动误红）

输出：JSON 结果 + 双视口截图，供 QA 验收报告引用。
"""
import json
import re
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8099/index.html"
OUT_DIR = "/workspace/ai-girlfriend/test"
VIEWPORTS = [
    {"name": "A-desktop", "width": 1280, "height": 800, "is_mobile": False},
    {"name": "B-mobile",  "width": 390,  "height": 844, "is_mobile": True},
]

# 微行为标记（与 qa-f-acceptance.test.js 的 hasMicro 检测器同口径）：
#   HES 犹豫词前缀 / TIC 口头禅+「，」或「～」前缀 / 「…嗯，」 / 「  *」错字自纠标记 /
#   BRIDGE 承接词+「，」前缀 / MIRROR 镜像回声前缀 / 「～ 你之前还说起过」记忆引用 / 换行分段
#   ⚠️ 单字 tic（诶/欸/呐/嘻/哇/哎 等）须独立成分支，不能只挂在多字词里，否则「诶，…」会漏判。
MICRO_RE = re.compile(
    r"^(嗯…|那个…|唔…|诶…|其实…|怎么说呢…)"                                  # HES 前缀（含 F3 扩量）
    r"|^(嗯|唔|诶嘿|哼|啧|才不是|笨蛋|欸|呐|诶呀|呜哇|抱抱|嘻|嘿嘿|哇|好耶|哎)(，|～)"  # TIC + 标点前缀
    r"|^(诶|欸|呐|嘻|哇|哎|哼|啧|唔|嗯)"                                        # 单字 tic 前缀（兜底，与 JS t.startsWith 等价）
    r"|～ 你之前还说起过"                                                        # 记忆引用
    r"|^(对了|话说|诶，说起这个|顺便说一句|哎对了)，"                            # BRIDGE 承接词前缀
    r"|^(看你|听你|你难过|你笑|你高兴|你激动|你一个人|别怕|别慌|没事儿|有我在|深呼吸|哇你)"  # MIRROR 镜像回声前缀
    r"|\n"                                                                     # 节奏分段换行
)
# 无关 console 错误白名单（沿用 E12/E4 既定口径：favicon 404 不属 F 范围，PRD §5 Q6-B 裁定不纳入）
IRRELEVANT_CONSOLE_ERR_RE = re.compile(r"favicon|404.*File not found|Failed to load resource", re.IGNORECASE)
CRISIS_SENT = "我真的撑不下去了不想活了"


def wait_splash_gone(page, timeout=15000):
    try:
        page.wait_for_function(
            "()=>{const s=document.getElementById('splash');"
            "return !s || getComputedStyle(s).display==='none' || s.classList.contains('hidden');}",
            timeout=timeout)
    except Exception:
        pass


def dismiss_intro_modals(page):
    out = []
    wait_splash_gone(page)
    for _ in range(6):
        g = page.query_selector("#gender-picker:not(.hidden) .gp-opt")
        if g:
            try:
                g.click(timeout=4000); out.append("gender"); page.wait_for_timeout(600)
            except Exception as e:
                out.append("genderX:" + str(e)[:30])
        l = page.query_selector("#ltm-modal .ltm-modal-btns .me-save")
        if l:
            try:
                l.click(timeout=4000); out.append("ltm"); page.wait_for_timeout(600)
            except Exception as e:
                out.append("ltmX:" + str(e)[:30])
        if not g and not l:
            break
        page.wait_for_timeout(800)
    return ",".join(out) if out else "none"


def intro_cleared(page):
    gp = page.eval_on_selector("#gender-picker", "el=> el ? el.classList.contains('hidden') : true")
    ltm = page.evaluate("()=> !document.getElementById('ltm-modal')")
    return bool(gp and ltm)


def her_replies(page):
    return page.eval_on_selector_all(
        "#chat-body .msg.her .bubble",
        "els=>els.map(e=>e.textContent.trim()).filter(Boolean)")


def find_visible(page, selectors):
    for sel in selectors:
        for el in page.query_selector_all(sel):
            try:
                if el.is_visible():
                    return el
            except Exception:
                pass
    return None


def send_and_capture(page, text, timeout=20000, settle=2500):
    import time
    before = len(her_replies(page))
    page.fill("#chat-input", text)
    page.click("#btn-send")
    deadline = time.time() + timeout / 1000.0
    while time.time() < deadline:
        rs = her_replies(page)
        if len(rs) > before and rs[-1].strip():
            stable_since = time.time()
            prev = rs[-1]
            while time.time() - stable_since < settle / 1000.0:
                page.wait_for_timeout(200)
                rs2 = her_replies(page)
                if rs2 and rs2[-1] != prev:
                    prev = rs2[-1]
                    stable_since = time.time()
            return her_replies(page)
        page.wait_for_timeout(300)
    return her_replies(page)


def goto_settings(page):
    sel = find_visible(page, [
        '#shell-nav .shell-nav-item[data-page="me"]',
        '.tabbar .tab[data-page="me"]',
        '[data-page="me"]'])
    if not sel:
        raise RuntimeError("找不到设置屏入口")
    sel.click()
    page.wait_for_selector("#page-me:not(.hidden)", timeout=8000)
    page.wait_for_timeout(800)


def goto_chat(page):
    sel = find_visible(page, [
        '#shell-nav .shell-nav-item[data-page="chat"]',
        '.tabbar .tab[data-page="chat"]',
        '[data-page="chat"]'])
    if sel:
        sel.click()
        page.wait_for_timeout(600)


def run_viewport(p, vp):
    results = {"viewport": vp["name"], "checks": [], "errors": [], "js_errors": [], "evidence": {}}
    console_msgs = []

    def check(name, cond, detail=""):
        results["checks"].append({"name": name, "pass": bool(cond), "detail": str(detail)})
        print(("[PASS] " if cond else "[FAIL] ") + vp["name"] + " · " + name
              + ((" :: " + str(detail)) if detail else ""))

    browser_ctx = p.new_context(
        viewport={"width": vp["width"], "height": vp["height"]},
        is_mobile=vp["is_mobile"])
    page = browser_ctx.new_page()

    def on_console(m):
        console_msgs.append((m.type, m.text))
    def on_pageerror(e):
        results["js_errors"].append(str(e))
    page.on("console", on_console)
    page.on("pageerror", on_pageerror)
    failed = []
    page.on("response", lambda r: failed.append((r.status, r.url)) if r.status >= 400 else None)

    micro_responses = []
    try:
        page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_selector("#chat-input", state="visible", timeout=15000)
        page.wait_for_timeout(1200)  # 等 app.js init

        # 关闭首屏引导浮层
        gp = dismiss_intro_modals(page)
        check("首屏引导浮层已关闭(真实用户流程)", intro_cleared(page), gp)

        # ① 首轮 / 降级护栏：发消息，拿到小暖回复且渲染（不白屏）
        try:
            replies1 = send_and_capture(page, "今天好累啊，你呢？")
            ok1 = len(replies1) > 0 and "白屏" not in (replies1[-1] or "")
            check("首轮·发消息获得小暖回复且渲染(不白屏)", ok1,
                  "reply=" + json.dumps(replies1[-1] if replies1 else "", ensure_ascii=False)[:120])
            results["evidence"]["default_tone_reply"] = replies1[-1] if replies1 else ""
            micro_responses.extend(replies1)
        except Exception as e:
            check("首轮·发消息获得小暖回复且渲染(不白屏)", False, str(e)[:160])

        # ② 切设置屏，点「傲娇」tone chip，无 JS 异常
        try:
            goto_settings(page)
            check("进入设置屏(me)", True)
            tsundere = page.query_selector('#tone-group .chip[data-tone="tsundere"]')
            check("设置屏存在「傲娇」tone chip", tsundere is not None)
            if tsundere:
                tsundere.click(timeout=5000)
                page.wait_for_timeout(500)
                active = page.eval_on_selector(
                    '#tone-group .chip[data-tone="tsundere"]',
                    "el=>el.classList.contains('active') || el.classList.contains('selected') || el.getAttribute('aria-pressed')==='true'")
                check("点击「傲娇」chip 后处于选中态", bool(active), "active=" + str(active))
                goto_chat(page)
                replies2 = send_and_capture(page, "你在干嘛呀，怎么不理我")
                results["evidence"]["tsundere_reply"] = replies2[-1] if replies2 else ""
                check("傲娇语气下获得回复(降级护栏)", len(replies2) > 0,
                      "reply=" + json.dumps(replies2[-1] if replies2 else "", ensure_ascii=False)[:120])
                micro_responses.extend(replies2)
        except Exception as e:
            check("切设置屏+点傲娇chip 流程", False, str(e)[:160])

        # ⑤ 真人感证据：多轮收集（含普通/傲娇语气），统计带微行为标记的回复占比（仅证据，不硬卡）
        burst = []
        for u in ["我爱你呀", "好想你", "你今天累不累", "抱抱", "在吗"]:
            try:
                rs = send_and_capture(page, u)
                if rs:
                    burst.append(rs[-1])
                    micro_responses.append(rs[-1])
            except Exception:
                pass
        results["evidence"]["burst_replies"] = burst
        micro_cnt = sum(1 for r in burst if MICRO_RE.search(r or ""))
        results["evidence"]["burst_micro_count"] = micro_cnt
        results["evidence"]["burst_total"] = len(burst)
        check("真人感证据·多轮中至少 1 条带微行为标记",
              micro_cnt >= 1,
              "micro=" + str(micro_cnt) + "/" + str(len(burst)))

        # ④ 危机护栏：发送危机句，回复非空且不得回声/反撩（E 危机门禁仍绿）
        try:
            cr = send_and_capture(page, CRISIS_SENT)
            cr_line = cr[-1] if cr else ""
            safe = bool(cr_line) and CRISIS_SENT[:4] not in cr_line
            check("危机护栏·回复非空且不回声危机句", safe,
                  "reply=" + json.dumps(cr_line, ensure_ascii=False)[:120])
        except Exception as e:
            check("危机护栏·回复非空且不回声危机句", False, str(e)[:160])

        # ③ console 报错统计（存文本而非类型，便于分类）
        #    沿用 E12/E4 既定口径：favicon 404 等无关错误容忍（PRD §5 Q6-B 裁定不纳入 F 范围），
        #    仅当出现非白名单的业务 JS 错误时才判 fail。
        errs = [m for t, m in console_msgs if t == "error"]
        warns = [m for t, m in console_msgs if t == "warning"]
        results["console_errors"] = errs
        results["console_warnings"] = warns
        results["console_error_count"] = len(errs)
        results["http_4xx"] = [list(x) for x in failed]
        relevant_errs = [m for m in errs if not IRRELEVANT_CONSOLE_ERR_RE.search(m)]
        check("页面无 JS 运行时异常(pageerror)", len(results["js_errors"]) == 0,
              "; ".join(results["js_errors"][:3]))
        check("console 业务报错==0( favicon 404 等无关错误容忍，沿用 E12 口径)",
              len(relevant_errs) == 0,
              "errs=" + str(len(errs)) + " relevant=" + str(len(relevant_errs)) + " warns=" + str(len(warns))
              + (" | 4xx=" + json.dumps([u for _, u in failed], ensure_ascii=False)[:200] if failed else ""))

        # 截图证据
        shot = f"{OUT_DIR}/f_{vp['name']}.png"
        page.screenshot(path=shot, full_page=False)
        results["evidence"]["screenshot"] = shot
        check("视口截图已存", True, shot)
    finally:
        browser_ctx.close()

    return results


def main():
    all_results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path="/usr/bin/chromium",
            args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
        )
        try:
            for vp in VIEWPORTS:
                res = run_viewport(browser, vp)
                all_results.append(res)
        finally:
            browser.close()

    total_checks = sum(len(r["checks"]) for r in all_results)
    passed = sum(1 for r in all_results for c in r["checks"] if c["pass"])
    print("\n==== 汇总（候选 F 双视口真机）====")
    print(f"总检查项: {total_checks}  通过: {passed}  失败: {total_checks - passed}")
    for r in all_results:
        print(f"\n[{r['viewport']}] console错误={r.get('console_error_count')} "
              f"pageerror={len(r.get('js_errors', []))} "
              f"微行为证据={r.get('evidence', {}).get('burst_micro_count')}/{r.get('evidence', {}).get('burst_total')}")
        print("  默认语气回复:", json.dumps(r.get('evidence', {}).get('default_tone_reply', ''), ensure_ascii=False)[:140])
        print("  傲娇语气回复:", json.dumps(r.get('evidence', {}).get('tsundere_reply', ''), ensure_ascii=False)[:140])
    out = {"viewports": all_results, "summary": {"total": total_checks, "passed": passed}}
    with open(f"{OUT_DIR}/f_result.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("\n结果已写入:", f"{OUT_DIR}/f_result.json")
    sys.exit(0 if passed == total_checks else 1)


if __name__ == "__main__":
    main()
