# 东方财富证券资产同步插件 — PRD

## 1. 背景与目标

家庭记账系统已有 `bank_monitor` 插件通过微信公众号推送自动同步银行卡动账。现需要新增一个 `eastmoney_monitor` 插件，定期登录东方财富证券网上交易系统，查询总资产并提交余额快照到 HomeAccountant，实现证券账户资产的自动对账。

## 2. 核心功能

| 编号 | 功能 | 说明 |
|------|------|------|
| F-1 | 自动登录 | 使用 iPad UA + RSA 加密 + OCR 验证码，自动完成东财证券 Web 登录 |
| F-2 | 查询总资产 | 登录后调用 `POST /Com/queryAssetAndPositionV1` 获取账户总资产 |
| F-3 | 余额快照 | 将总资产作为 `external_balance` 提交到 `POST /accounts/{account_id}/snapshot`，触发对账流程 |
| F-4 | 每日盘后同步 | 每个交易日收盘后（默认 15:30）自动执行一次登录→查询→同步 |
| F-5 | 插件注册 | 遵循 PLUGIN_GUIDE 规范，注册到 HomeAccountant 插件系统，支持用户在 App 中配置 |

## 3. 插件架构

```
eastmoney_monitor/
├── __init__.py          # 入口：from .plugin import main; main()
├── __main__.py          # python -m eastmoney_monitor
├── eastmoney_login.py   # 已有：登录+OCR 逻辑
├── plugin.py            # 新增：主插件逻辑（仿 bank_monitor/plugin.py）
└── requirements.txt     # 依赖
```

## 4. 配置结构（config_schema）

插件注册时声明以下配置项，用户在 App 中填写：

| key | label | type | required | 说明 |
|-----|-------|------|----------|------|
| `target_book` | 目标账本 | `book_select` | 是 | 余额快照关联的账本 |
| `securities_account_id` | 证券资产科目 | `account_select` | 是 | 对应证券账户的资产科目（depends_on: target_book） |
| `em_account` | 东财资金账号 | `string` | 是 | 东方财富资金账号 |
| `em_password` | 东财登录密码 | `secret` | 是 | 东方财富登录密码 |
| `sync_time` | 每日同步时间 | `string` | 否 | 格式 HH:MM，默认 "15:30"（收盘后） |

## 5. 本地配置（config.json）

通过 `--setup` 交互式生成，存储在插件目录下：

| 字段 | 说明 |
|------|------|
| `api_url` | HomeAccountant API 地址 |
| `api_key` | API Key（hak_xxx） |
| `config_refresh_seconds` | 配置刷新间隔（默认 300） |

## 6. 运行流程

```
1. 注册插件（幂等）            POST /plugins
2. 读取用户配置                GET /plugins/{plugin_id}
3. 更新状态为 running          PUT /plugins/{plugin_id}/status
4. 循环（每日调度）：
   a. 等待至 sync_time（默认 15:30）
   b. 调用 eastmoney_login.login() 获取已登录 session
   c. POST /Com/queryAssetAndPositionV1 获取总资产
   d. 解析响应提取总资产金额
   e. POST /accounts/{securities_account_id}/snapshot 提交余额快照
   f. 记录日志，等待下一个交易日
5. 退出时更新状态为 success/failed
```

## 7. 东财 API 响应解析

`queryAssetAndPositionV1` 的响应格式需要通过实际调用确认。预期关键字段：

```json
{
  "Status": 0,
  "Data": [{
    "Zzc": "123456.78",
    "Kyzj": "50000.00",
    "Gpsz": "73456.78"
  }]
}
```

> **实现时需先用 `eastmoney_login.py` 的 `test_authenticated()` 实际调用一次，确认响应字段名。** 插件代码中应对字段名做可配置或容错处理。

## 8. 错误处理

| 场景 | 处理 |
|------|------|
| 登录失败（5 次验证码 OCR 均失败） | 记录 error 日志，更新状态为 failed，等待下次轮询重试 |
| 登录失败（密码错误/公钥过期） | 记录 error 日志，更新状态为 failed，**停止重试**避免账号被锁 |
| 查询接口返回非 0 Status | 记录响应内容，本轮跳过 |
| Session 过期（30 分钟） | 每次同步重新登录（不复用 session） |
| 余额快照提交失败 | 记录 error，本轮跳过，不影响次日同步 |
| 非交易时间（节假日/周末） | 仍然同步（总资产不变也无副作用） |

## 9. CLI 接口

```bash
# 交互式配置
python -m eastmoney_monitor --setup

# 持续运行（每日盘后自动同步）
python -m eastmoney_monitor

# 仅同步一次
python -m eastmoney_monitor --once

# 详细日志
python -m eastmoney_monitor -v
```

## 10. 依赖

```
requests>=2.28
pycryptodome>=3.18
ddddocr<1.6
```

## 11. 与 bank_monitor 的差异

| 维度 | bank_monitor | eastmoney_monitor |
|------|-------------|-------------------|
| 数据源 | 微信公众号推送（被动监听） | 东财证券 Web 系统（主动查询） |
| 同步内容 | 每笔交易 + 余额快照 | 仅余额快照（总资产） |
| 插件类型 | `both`（记账+余额） | `balance`（仅余额） |
| 认证方式 | 微信数据库解密 | RSA 加密 + 验证码 OCR |
| 轮询间隔 | 60 秒 | 每日盘后（15:30）同步一次 |
| Session | 无需登录 | 每次需重新登录（30 分钟过期） |

## 12. 验收标准

- [ ] `--setup` 可交互式完成本地配置
- [ ] 插件注册到 HomeAccountant 后，App 中可见并可配置科目
- [ ] 单次运行（`--once`）能成功登录东财、查询总资产、提交余额快照
- [ ] 持续运行模式下每日 15:30 自动同步一次
- [ ] 登录失败时不会无限重试导致账号锁定
- [ ] 支持 SIGINT/SIGTERM 优雅退出
