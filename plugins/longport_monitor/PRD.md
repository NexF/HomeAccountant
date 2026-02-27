# 长桥证券资产同步插件 — PRD

## 1. 背景与目标

家庭记账系统已有 `eastmoney_monitor` 插件通过网页爬虫同步东方财富证券资产。现需要新增 `longport_monitor` 插件，通过长桥 OpenAPI 查询港美股账户资产，提交余额快照到 HomeAccountant，实现港美股账户的自动对账。

长桥（LongPort）是港美股互联网券商，提供官方 OpenAPI + Python SDK，**无需爬虫、无需验证码**，通过 Token 认证即可稳定获取账户数据。

### 系统限制

> 当前 HomeAccountant 为**单币种设计**（默认 CNY），Account / JournalEntry / JournalLine 模型均无 currency 字段。因此本插件采用**单科目汇总方案**：将长桥账户的 HKD 总资产折算为 CNY 后提交余额快照，与系统现有架构保持一致。

## 2. 核心功能

| 编号 | 功能 | 说明 |
|------|------|------|
| F-1 | API 认证 | 通过 LongPort OpenAPI 的 App Key / Secret / Access Token 认证 |
| F-2 | 查询净资产 | 调用 `TradeContext.account_balance()` 获取 `net_assets` |
| F-3 | 汇率折算 | 通过 `forex-python` 获取实时汇率（ECB 数据源），失败时 fallback 默认值 |
| F-4 | 余额快照 | 将折算后的 CNY 总值作为 `external_balance` 提交到 `POST /accounts/{account_id}/snapshot` |
| F-5 | 每日盘后同步 | 港股收盘后（默认 16:30 HKT）自动执行一次查询→同步 |
| F-6 | 插件注册 | 遵循 PLUGIN_GUIDE 规范，注册到 HomeAccountant 插件系统 |

## 3. 插件架构

```
longport_monitor/
├── __init__.py          # 入口
├── __main__.py          # python -m longport_monitor
├── plugin.py            # 主插件逻辑
├── config.json          # 本地配置（--setup 生成，gitignore）
├── requirements.txt     # 依赖
└── PRD.md               # 本文档
```

## 4. LongPort OpenAPI 接入

### 4.1 认证方式

LongPort OpenAPI 使用三元组认证：

| 凭证 | 说明 |
|------|------|
| `LONGPORT_APP_KEY` | 应用 Key |
| `LONGPORT_APP_SECRET` | 应用 Secret |
| `LONGPORT_ACCESS_TOKEN` | 用户访问令牌 |

通过 [长桥开放平台](https://open.longportapp.com) 注册开发者并创建应用获取。

### 4.2 关键 API

**账户余额查询** `GET /v1/asset/account`

Python SDK：
```python
from longport.openapi import Config, TradeContext

config = Config.from_env()
ctx = TradeContext(config)
balances = ctx.account_balance()
```

响应字段：

| 字段 | 说明 |
|------|------|
| `net_assets` | **净资产**（总资产，核心字段） |
| `total_cash` | 总现金 |
| `buy_power` | 购买力 |
| `currency` | 币种（HKD / USD / CNH） |
| `risk_level` | 风控等级 |
| `cash_infos[].available_cash` | 可用资金 |
| `cash_infos[].frozen_cash` | 冻结资金 |

> 长桥账户一般以 HKD 为主币种，`net_assets` 是该币种下的总资产（含股票市值 + 现金）。

## 5. 汇率折算方案

由于系统为单币种（CNY），需要将港美股资产折算为人民币。

**采用方案：`forex-python` 自动获取实时汇率，失败时 fallback 到默认值。**

```python
from forex_python.converter import CurrencyRates

c = CurrencyRates()
hkd_to_cny = c.get_rate('HKD', 'CNY')  # 实时汇率
usd_to_cny = c.get_rate('USD', 'CNY')
```

- 数据源：欧央行（ECB），免费、无需 API Key
- Fallback：若网络异常或 API 不可用，使用默认值（HKD→CNY = 0.92，USD→CNY = 7.25）
- CNH（离岸人民币）直接按 1.0 折算

折算公式：
```
CNY 总资产 = Σ (各币种 net_assets × 对应汇率)
```

## 6. 配置结构（config_schema）

插件注册时声明以下配置项，用户在 App 中填写：

| key | label | type | required | 说明 |
|-----|-------|------|----------|------|
| `target_book` | 目标账本 | `book_select` | 是 | 余额快照关联的账本 |
| `securities_account_id` | 港美股资产科目 | `account_select` | 是 | 对应长桥证券账户的资产科目（depends_on: target_book） |
| `lp_app_key` | App Key | `string` | 是 | LongPort 应用 Key |
| `lp_app_secret` | App Secret | `secret` | 是 | LongPort 应用 Secret |
| `lp_access_token` | Access Token | `secret` | 是 | LongPort 用户令牌 |
| `sync_time` | 每日同步时间 | `string` | 否 | 格式 HH:MM，默认 "16:30"（港股收盘后） |

## 7. 本地配置（config.json）

通过 `--setup` 交互式生成，存储在插件目录下：

| 字段 | 说明 |
|------|------|
| `api_url` | HomeAccountant API 地址 |
| `api_key` | API Key（hak_xxx） |
| `config_refresh_seconds` | 配置刷新间隔（默认 300） |

## 8. 运行流程

```
1. 注册插件（幂等）            POST /plugins
2. 读取用户配置                GET /plugins/{plugin_id}
3. 更新状态为 running          PUT /plugins/{plugin_id}/status
4. 循环（每日调度）：
   a. 等待至 sync_time（默认 16:30）
   b. 使用用户配置的三元组创建 LongPort TradeContext
   c. 调用 account_balance() 获取各币种净资产
   d. 通过 forex-python 获取实时汇率（失败时用默认值），折算为 CNY 总值：
      - HKD net_assets × get_rate('HKD','CNY')
      - USD net_assets × get_rate('USD','CNY')
      - CNH net_assets × 1.0
   e. 汇总后提交余额快照 → securities_account_id
   f. 记录日志，等待下一个交易日
5. 退出时更新状态为 success/failed
```

## 9. 错误处理

| 场景 | 处理 |
|------|------|
| Token 过期 / 认证失败 | 记录 error 日志，更新状态为 failed，提示用户刷新 Token |
| API 调用频率限制 | 按官方文档退避重试（默认 30 次/分钟） |
| account_balance 返回空 | 记录 warning，本轮跳过 |
| 汇率获取失败 | 使用默认汇率（HKD→CNY=0.92, USD→CNY=7.25），记录 warning |
| 余额快照提交失败 | 记录 error，本轮跳过，不影响次日同步 |
| 网络异常 | 重试 3 次，间隔 10 秒 |
| 非交易时间（节假日/周末） | 仍然同步（净资产不变也无副作用） |

## 10. CLI 接口

```bash
# 交互式配置
python -m longport_monitor --setup

# 持续运行（每日盘后自动同步）
python -m longport_monitor

# 仅同步一次
python -m longport_monitor --once

# 详细日志
python -m longport_monitor -v
```

## 11. 依赖

```
requests>=2.28
longport>=3.0
forex-python>=1.8
```

## 12. 与 eastmoney_monitor 的差异

| 维度 | eastmoney_monitor | longport_monitor |
|------|-------------------|------------------|
| 券商 | 东方财富（A股） | 长桥（港美股） |
| 数据获取方式 | 网页爬虫（requests + OCR） | 官方 OpenAPI + SDK |
| 认证方式 | 账号密码 + RSA + 验证码 | App Key / Secret / Token |
| 稳定性 | 依赖网页结构，可能被反爬 | 官方 API，稳定可靠 |
| 原始币种 | CNY | HKD / USD / CNH |
| 提交方式 | 直接提交 CNY 金额 | forex-python 实时汇率折算为 CNY 后提交 |
| 插件类型 | `balance` | `balance` |
| 同步时间 | 15:30（A股收盘后） | 16:30（港股收盘后） |
| Session 管理 | 每次重新登录 | Token 长期有效，无需反复认证 |

## 13. 验收标准

- [ ] `--setup` 可交互式完成本地配置
- [ ] 插件注册到 HomeAccountant 后，App 中可见并可配置科目
- [ ] 单次运行（`--once`）能成功查询长桥账户净资产、折算为 CNY、提交余额快照
- [ ] 持续运行模式下每日 16:30 自动同步一次
- [ ] Token 过期时有明确的错误提示
- [ ] 支持 SIGINT/SIGTERM 优雅退出

## 14. 备注

本插件始终只提交一个汇总后的 CNY 总资产到单一科目，不区分港币/美元子科目。如未来系统支持多币种，可考虑分币种提交，但当前无此需求。
