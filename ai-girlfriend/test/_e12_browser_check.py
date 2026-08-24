#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
E12 · 浏览器真机双视口抽查（候选 E 回答系统真人感优化）
驱动：Python Playwright + 系统 /usr/bin/chromium
本地服务：http://localhost:8099/index.html（候选 D 已证实：必须先关引导浮层否则导航超时）

检查项：
  ① 发消息能拿到小暖回复且正常渲染、不白屏
  ② 切设置屏、点「傲娇」/其他 tone chip 无 JS 异常
  ③ 收集 console 报错数（应为 0 或仅无关警告）
  ④ 观察回复是否带微行为/记忆呼应（真人感），记录 1~2 句实际回复片段为证据

输出：JSON 结果 + 双视口截图，供 QA 验收报告引用。
"""
import json
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8099/index.html"
OUT_DIR = "/workspace/ai-girlfriend/test"
VIEWPORTS = [
    {"name": "A-desktop", "width": 1280, "height": 800, "is_mobile": False},
    {"name": "B-mobile",  "width": 390,  "height": 844, "is_mobile": True},
]


def wait_splash_gone(page, timeout=15000):
    try:
        page.wait_for_function(
            "()=>{const s=document.getElementById('splash');"
            "return !s || getComputedStyle(s).display==='none' || s.classList.contains('hidden');}",
            timeout=timeout)
    except Exception:
        pass


def dismiss_intro_modals(page):
    """真实用户首次引导：splash 退场 → gender-picker(z-index:99999) → ltm-modal。循环最多 6 轮。"""
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
    """从候选选择器里挑第一个可见元素（避开隐藏的 shell-nav）。"""
    for sel in selectors:
        for el in page.query_selector_all(sel):
            try:
                if el.is_visible():
                    return el
            except Exception:
                pass
    return None


def send_and_capture(page, text, timeout=20000, settle=2500):
    """发送并等待「她」的完整回复（等文本稳定，避免抓到流式半截）。"""
    import time
    before = len(her_replies(page))
    page.fill("#chat-input", text)
    page.click("#btn-send")
    deadline = time.time() + timeout / 1000.0
    while time.time() < deadline:
        rs = her_replies(page)
        if len(rs) > before and rs[-1].strip():
            # 等文本稳定（长度/内容不再变化）达 settle 毫秒
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

    try:
        page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_selector("#chat-input", state="visible", timeout=15000)
        page.wait_for_timeout(1200)  # 等 app.js init

        # 关闭首屏引导浮层
        gp = dismiss_intro_modals(page)
        check("首屏引导浮层已关闭(真实用户流程)", intro_cleared(page), gp)

        # ① 发送消息，拿到小暖回复且渲染
        try:
            replies1 = send_and_capture(page, "今天好累啊，你呢？")
            ok1 = len(replies1) > 0 and "白屏" not in (replies1[-1] or "")
            check("发消息获得小暖回复且渲染(不白屏)", ok1,
                  "reply=" + json.dumps(replies1[-1] if replies1 else "", ensure_ascii=False)[:120])
            results["evidence"]["default_tone_reply"] = replies1[-1] if replies1 else ""
        except Exception as e:
            check("发消息获得小暖回复且渲染(不白屏)", False, str(e)[:160])

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
                check("点击「傲娇」chip 后处于选中态", bool(active),
                      "active=" + str(active))
                # 再用傲娇语气发一条，验证真人感（傲娇毒舌/黏人分流）
                goto_chat(page)
                replies2 = send_and_capture(page, "你在干嘛呀，怎么不理我")
                results["evidence"]["tsundere_reply"] = replies2[-1] if replies2 else ""
                check("傲娇语气下获得回复", len(replies2) > 0,
                      "reply=" + json.dumps(replies2[-1] if replies2 else "", ensure_ascii=False)[:120])
        except Exception as e:
            check("切设置屏+点傲娇chip 流程", False, str(e)[:160])

        # ③ console 报错统计（存文本而非类型，便于分类）
        errs = [m for t, m in console_msgs if t == "error"]
        warns = [m for t, m in console_msgs if t == "warning"]
        results["console_errors"] = errs
        results["console_warnings"] = warns
        results["console_error_count"] = len(errs)
        results["http_4xx"] = [list(x) for x in failed]
        check("页面无 JS 运行时异常(pageerror)", len(results["js_errors"]) == 0,
              "; ".join(results["js_errors"][:3]))
        check("console 报错数==0(或仅无关警告)", len(errs) == 0,
              "errs=" + str(len(errs)) + " warns=" + str(len(warns))
              + (" | 4xx=" + json.dumps([u for _, u in failed], ensure_ascii=False)[:200] if failed else ""))

        # 截图证据
        shot = f"{OUT_DIR}/e12_{vp['name']}.png"
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
                # 每个视口新 context 由 run_viewport 内创建；这里仅用 browser 句柄
                res = run_viewport(browser, vp)
                all_results.append(res)
        finally:
            browser.close()

    # 汇总
    total_checks = sum(len(r["checks"]) for r in all_results)
    passed = sum(1 for r in all_results for c in r["checks"] if c["pass"])
    print("\n==== 汇总 ====")
    print(f"总检查项: {total_checks}  通过: {passed}  失败: {total_checks - passed}")
    for r in all_results:
        print(f"\n[{r['viewport']}] console错误={r.get('console_error_count')} "
              f"pageerror={len(r.get('js_errors', []))}")
        print("  默认语气回复:", json.dumps(r.get('evidence', {}).get('default_tone_reply', ''), ensure_ascii=False)[:140])
        print("  傲娇语气回复:", json.dumps(r.get('evidence', {}).get('tsundere_reply', ''), ensure_ascii=False)[:140])
    out = {"viewports": all_results, "summary": {"total": total_checks, "passed": passed}}
    with open(f"{OUT_DIR}/e12_result.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("\n结果已写入:", f"{OUT_DIR}/e12_result.json")
    # 非零退出便于 CI 识别（有失败项时）
    sys.exit(0 if passed == total_checks else 1)


if __name__ == "__main__":
    main()
