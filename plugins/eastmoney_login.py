#!/usr/bin/env python3
"""
东方财富证券网上交易系统 - 自动登录脚本
同一 session 内: 获取验证码 → OCR 识别 → 登录，一步到位
"""

import base64
import json
import os
import random
import sys
import time

import requests

try:
    from Crypto.PublicKey import RSA
    from Crypto.Cipher import PKCS1_v1_5
except ImportError:
    print("需要安装 pycryptodome: pip3 install pycryptodome")
    sys.exit(1)

try:
    import ddddocr
except ImportError:
    print("需要安装 ddddocr: pip3 install ddddocr")
    sys.exit(1)

# ─── 配置 ───
ACCOUNT = os.environ.get("EM_ACCOUNT", "")
PASSWORD = os.environ.get("EM_PASSWORD", "")

BASE_URL = "https://jywg.eastmoneysec.com"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
YZM_FILE = os.path.join(SCRIPT_DIR, "yzm.png")

# iPad UA 免安装安全控件
UA_IPAD = (
    "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.4 Mobile/15E148 Safari/604.1"
)

# 东方财富 RSA 公钥（从 BaseJS bundle 中提取）
RSA_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDHdsyxT66pDG4p73yope7jxA92
c0AT4qIJ/xtbBcHkFPK77upnsfDTJiVEuQDH+MiMeb+XhCLNKZGp0yaUU6GlxZdp
+nLW8b7Kmijr3iepaDhcbVTsYBWchaWUXauj9Lrhz58/6AE/NF0aMolxIGpsi+ST
2hSHPu3GSXMdhPCkWQIDAQAB
-----END PUBLIC KEY-----"""

MAX_RETRY = 5


def rsa_encrypt(plaintext: str) -> str:
    """用 RSA 公钥加密（与前端 EMTradeEncrypt.encrypt 一致）"""
    key = RSA.import_key(RSA_PUBLIC_KEY)
    cipher = PKCS1_v1_5.new(key)
    encrypted = cipher.encrypt(plaintext.encode("utf-8"))
    return base64.b64encode(encrypted).decode("utf-8")


def create_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": UA_IPAD,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": f"{BASE_URL}/Login",
    })
    return s


def ocr_captcha(image_bytes: bytes) -> str:
    """用 ddddocr 识别验证码，东方财富验证码一般是4位纯数字"""
    ocr = ddddocr.DdddOcr(show_ad=False)
    result = ocr.classification(image_bytes).strip()
    # 常见 OCR 混淆字符修正（纯数字验证码）
    char_map = {
        'o': '0', 'O': '0', 'D': '0',
        'i': '1', 'I': '1', 'l': '1', 'L': '1',
        'z': '2', 'Z': '2',
        'e': '6', 'b': '6',
        's': '5', 'S': '5',
        'q': '9', 'g': '9',
        'u': '0', 'U': '0',
        'B': '8', 'a': '4', 'A': '4',
    }
    corrected = ''.join(char_map.get(c, c) for c in result)
    # 只保留数字
    digits = ''.join(c for c in corrected if c.isdigit())
    if len(digits) == 4:
        return digits
    # 如果修正后不是4位数字，返回原始结果
    return result


def login():
    """一步到位：获取验证码 → OCR → 登录"""
    session = create_session()

    # Step 1: 访问登录页面
    print("[1] 访问登录页面...")
    resp = session.get(f"{BASE_URL}/Login")
    if resp.status_code != 200:
        print(f"    失败: {resp.status_code}")
        return None
    print(f"    OK. Cookies: {dict(session.cookies)}")

    # 加密密码（只需一次）
    encrypted_password = rsa_encrypt(PASSWORD)

    for attempt in range(1, MAX_RETRY + 1):
        print(f"\n--- 尝试第 {attempt}/{MAX_RETRY} 次 ---")

        # Step 2: 获取验证码
        rand_num = str(random.random())
        print(f"[2] 获取验证码...")
        yzm_resp = session.get(f"{BASE_URL}/Login/YZM?randNum={rand_num}")
        if yzm_resp.status_code != 200 or len(yzm_resp.content) < 100:
            print(f"    获取验证码失败: status={yzm_resp.status_code}, size={len(yzm_resp.content)}")
            continue

        # 保存验证码图片（调试用）
        with open(YZM_FILE, "wb") as f:
            f.write(yzm_resp.content)

        # Step 3: OCR 识别
        print("[3] OCR 识别验证码...")
        verify_code = ocr_captcha(yzm_resp.content)
        print(f"    识别结果: {verify_code}")

        if not verify_code:
            print("    识别为空，重试...")
            continue

        # Step 4: 提交登录
        print(f"[4] 提交登录 (account={ACCOUNT}, code={verify_code})...")
        login_data = {
            "userId": ACCOUNT,
            "password": encrypted_password,
            "randNumber": rand_num,
            "identifyCode": verify_code,
            "duration": 30,
            "authCode": "",
            "type": "Z",
        }

        session.headers.update({
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Origin": BASE_URL,
        })

        resp = session.post(f"{BASE_URL}/Login/Authentication", data=login_data)
        print(f"    Status: {resp.status_code}")

        try:
            result = resp.json()
            print(f"    Result: {json.dumps(result, ensure_ascii=False)}")

            status = result.get("Status")
            if status == 0 or status == "0":
                data = result.get("Data", [{}])
                user_info = data[0] if data else {}
                print(f"\n[+] 登录成功！")
                print(f"    用户: {user_info.get('khmc', result.get('Khmc'))}")
                print(f"    账号: {user_info.get('Syspm1')}")
                print(f"    日期: {user_info.get('Date')} {user_info.get('Time')}")
                print(f"    Cookies: {dict(session.cookies)}")
                return session

            message = result.get("Message", "未知错误")
            print(f"    失败: {message}")

            if "验证码" in message or "信息有误" in message:
                print("    可能是验证码错误，重新获取...")
                continue
            else:
                print("    停止重试")
                return None

        except Exception as e:
            print(f"    解析响应失败: {e}")
            print(f"    原始响应: {resp.text[:300]}")
            return None

    print(f"\n[-] {MAX_RETRY} 次尝试均失败")
    return None


def test_authenticated(session: requests.Session):
    """测试登录后的功能"""
    print("\n=== 测试登录状态 ===")

    session.headers.update({
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01",
    })

    endpoints = [
        ("POST", "/Com/queryAssetAndPositionV1", "持仓与资产"),
    ]

    for method, url, name in endpoints:
        try:
            if method == "POST":
                resp = session.post(f"{BASE_URL}{url}")
            else:
                resp = session.get(f"{BASE_URL}{url}")
            print(f"\n[{name}] {method} {url}")
            print(f"  Status: {resp.status_code}")
            try:
                data = resp.json()
                print(f"  Response: {json.dumps(data, ensure_ascii=False, indent=2)[:2000]}")
            except Exception:
                print(f"  Response: {resp.text[:500]}")
        except Exception as e:
            print(f"  Error: {e}")


if __name__ == "__main__":
    session = login()
    if session:
        test_authenticated(session)
