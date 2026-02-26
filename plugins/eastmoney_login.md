# 东方财富证券网上交易系统 - 登录原理

## 系统概述

东方财富证券网上交易系统（`https://jywg.eastmoneysec.com`）是东方财富证券提供的 Web 端股票交易平台。

## 免安全控件方案

PC 浏览器访问登录页时，系统会要求安装「安全控件」来保护密码输入框。但系统对移动端（iPad/Mac）做了兼容，**使用 iPad 或 Mac 的 User-Agent 可以跳过安全控件**，直接使用标准 HTML 表单输入密码。

```
User-Agent: Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 ...
```

## 登录流程

```
┌──────────┐     GET /Login      ┌──────────┐
│  Client  │ ──────────────────► │  Server  │   建立 Session
│          │ ◄────────────────── │          │
│          │                     │          │
│          │  GET /Login/YZM     │          │
│          │ ──────────────────► │          │   获取验证码图片
│          │ ◄── image/png ──── │          │   (服务端通过 randNum 关联)
│          │                     │          │
│          │  POST /Login/       │          │
│          │  Authentication     │          │   提交登录
│          │ ──────────────────► │          │
│          │ ◄── JSON ───────── │          │
└──────────┘                     └──────────┘
```

### Step 1: 访问登录页

```
GET https://jywg.eastmoneysec.com/Login
```

首次访问建立 HTTP Session。注意：服务端**不下发 Cookie**，Session 关联完全依赖后续的 `randNumber` 参数。

### Step 2: 获取验证码

```
GET https://jywg.eastmoneysec.com/Login/YZM?randNum=0.123456789
```

- `randNum`：客户端生成的随机数（`Math.random()`），用于在服务端关联验证码与登录请求
- 返回：PNG 格式图片，4 位纯数字验证码
- **关键**：同一个 `randNum` 获取的验证码必须与登录请求中的 `randNumber` 参数一致

### Step 3: 密码 RSA 加密

密码在客户端使用 RSA 公钥加密后传输。前端实现位于 JS Bundle 中的 `EMTradeEncrypt.encrypt()` 函数。

**加密方式**：RSA PKCS1 v1.5

**公钥**（从 `BaseJS` Bundle 提取）：

```
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDHdsyxT66pDG4p73yope7jxA92
c0AT4qIJ/xtbBcHkFPK77upnsfDTJiVEuQDH+MiMeb+XhCLNKZGp0yaUU6GlxZdp
+nLW8b7Kmijr3iepaDhcbVTsYBWchaWUXauj9Lrhz58/6AE/NF0aMolxIGpsi+ST
2hSHPu3GSXMdhPCkWQIDAQAB
```

**Python 实现**：

```python
from Crypto.PublicKey import RSA
from Crypto.Cipher import PKCS1_v1_5
import base64

key = RSA.import_key(RSA_PUBLIC_KEY)
cipher = PKCS1_v1_5.new(key)
encrypted = cipher.encrypt(password.encode("utf-8"))
result = base64.b64encode(encrypted).decode("utf-8")
```

### Step 4: 提交登录

```
POST https://jywg.eastmoneysec.com/Login/Authentication
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
X-Requested-With: XMLHttpRequest
```

**请求参数**：

| 参数 | 说明 |
|------|------|
| `userId` | 资金账号 |
| `password` | RSA 加密后的密码（Base64） |
| `randNumber` | 与获取验证码时相同的随机数 |
| `identifyCode` | 验证码（4 位数字） |
| `duration` | Session 有效期（分钟），一般填 `30` |
| `authCode` | 留空 |
| `type` | 固定值 `"Z"` |

> 注意：Mac/iPad UA 使用 `/Login/Authentication`，PC 端使用 `/Login/MacAuthentication`（名字容易混淆，实际 Mac/iPad 走的是前者）。

### 登录响应

**成功**：

```json
{
  "Message": "",
  "Status": 0,
  "Errcode": 0,
  "Data": [{
    "khmc": "用户姓名",
    "Date": "20260227",
    "Time": "014035",
    "Syspm1": "资金账号",
    "Syspm2": "营业部代码",
    "Syspm_ex": "7"
  }]
}
```

**失败**：

```json
{
  "Status": "-1",
  "Message": "您输入的信息有误，请重新输入!",
  ...
}
```

> 注意：`Status` 字段成功时返回**数字** `0`，失败时返回**字符串** `"-1"`，类型不一致。

## 登录后 Session 维持

登录成功后，服务端通过 Cookie 维持 Session：

| Cookie | 说明 |
|--------|------|
| `Yybdm` | 营业部代码 |
| `Uid` | 加密的用户 ID |
| `Khmc` | URL 编码的用户姓名 |
| `mobileimei` | 设备标识（UUID） |
| `Uuid` | 会话 UUID |

后续请求携带这些 Cookie 即可访问交易接口。

## 登录后可用接口示例

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/Com/queryAssetAndPositionV1` | 查询资产和持仓 |
| GET | `/Com/GetFunds` | 资金概览（需 AJAX 头） |
| POST | `/Trade/SubmitTradeV2` | 提交交易委托 |
| POST | `/Com/GetStockList` | 查询股票列表 |

## 验证码 OCR

系统验证码为 4 位纯数字，可使用 `ddddocr`（带带弟弟 OCR）自动识别。OCR 对数字验证码的识别率不是 100%，常见混淆需后处理：

- `u` → `0`，`o/O` → `0`
- `l/I` → `1`
- `Z/z` → `2`
- `S/s` → `5`
- `b/e` → `6`
- `B` → `8`
- `g/q` → `9`

实测 OCR + 字符修正后，单次识别准确率约 70-80%，配合重试机制（最多 5 次），基本可以保证登录成功。

## 依赖

```
pip install requests pycryptodome "ddddocr<1.6"
```

> 注意：`ddddocr` 1.6.0 存在导入 bug，使用 1.5.x 版本。
