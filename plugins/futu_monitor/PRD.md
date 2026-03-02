# 富途证券资产同步插件 — PRD

## 1. 背景与目标

咕咕记账系统已有 `longport_monitor` 通过长桥 OpenAPI 同步港美股资产。现需新增 `futu_monitor` 插件，通过富途 OpenD + futu-api Python SDK 查询富途证券账户资产，提交余额快照到 HomeAccountant，实现富途账户的自动对账。

富途（Futu/Moomoo）是港美股互联网券商，提供 OpenD 网关 + futu-api SDK 的量化接口体系。**OpenD 已部署在本机**（`127.0.0.1:11111`），通过 TCP 协议与 futu-api 通信，无需 HTTP 请求。

### 系统限制

> 当前 HomeAccountant 为**单币种设计**（默认 CNY），Account / JournalEntry / JournalLine 模型均无 currency 字段。因此本插件采用**单科目汇总方案**：将富途账户的总资产折算为 CNY 后提交余额快照。

## 2. 核心功能

| 编号 | 功能 | 说明 |
|------|------|------|
| F-1 | OpenD 连接 | 通过 futu-api SDK 连接本地 OpenD 网关（TCP `127.0.0.1:11111`） |
| F-2 | 查询总资产 | 调用 `accinfo_query(currency=Currency.CNH)` 获取 `total_assets`（以人民币计价） |
| F-3 | 余额快照 | 将 CNY 总资产作为 `external_balance` 提交到 `POST /accounts/{account_id}/snapshot` |
| F-4 | 每日盘后同步 | 港股收盘后（默认 16:30 HKT）自动执行一次查询→同步 |
| F-5 | 插件注册 | 遵循 PLUGIN_GUIDE 规范，注册到 HomeAccountant 插件系统 |

## 3. 插件架构

```
futu_monitor/
├── __init__.py          # 入口
├── __main__.py          # python -m futu_monitor
├── plugin.py            # 主插件逻辑
├── config.json          # 本地配置（--setup 生成，gitignore）
├── requirements.txt     # 依赖
└── PRD.md               # 本文档
```

## 4. 富途 OpenAPI 接入

### 4.1 架构

```
futu_monitor (Python) ──TCP──> OpenD (本地网关 :11111) ──> 富途服务器
```

与长桥不同，富途采用 **本地网关模式**：
- OpenD 是一个独立进程，负责与富途服务器通信、账号登录、行情/交易请求中转
- futu-api SDK 通过 TCP 连接 OpenD，不直接访问外网
- **OpenD 需提前启动并登录**，插件只需连接即可

### 4.2 认证方式

OpenD 已在启动时通过配置文件（`FutuOpenD.xml`）完成账号登录，futu-api 连接时**无需额外认证**（默认本地连接免密）。

如果 OpenD 配置了 RSA 加密，则需在连接时指定私钥路径。

### 4.3 关键 API

**获取账户列表** `get_acc_list`

```python
from futu import *

trd_ctx = OpenSecTradeContext(filter_trdmarket=TrdMarket.HK, host='127.0.0.1', port=11111, security_firm=SecurityFirm.FUTUSECURITIES)
ret, data = trd_ctx.get_acc_list()
# data: acc_id, trd_env, acc_type, trdmarket_auth, ...
```

**查询账户资金** `accinfo_query`

```python
ret, data = trd_ctx.accinfo_query(currency=Currency.CNH)
```

响应字段（指定 `currency=Currency.CNH` 后，通用字段按人民币计价）：

| 字段 | 说明 |
|------|------|
| `total_assets` | **总资产净值**（核心字段，已按指定币种折算） |
| `securities_assets` | 证券资产净值 |
| `fund_assets` | 基金资产净值 |
| `power` | 最大购买力 |
| `market_val` | 证券市值 |
| `hk_cash` / `us_cash` / `cn_cash` | 分币种现金 |
| `risk_status` | 风控状态 |

> **重点**：`accinfo_query` 支持 `currency` 参数，指定 `Currency.CNH` 后 `total_assets` 即为**人民币计价的总资产**，无需像 longport_monitor 那样手动获取汇率折算。

## 5. 汇率折算方案

**无需手动折算。** 

富途 `accinfo_query` 接口支持 `currency` 参数，指定 `Currency.CNH`（离岸人民币）后，返回的 `total_assets` 已由富途服务器按实时汇率折算为人民币。

与 longport_monitor 对比：

| 维度 | longport_monitor | futu_monitor |
|------|-----------------|--------------|
| 汇率来源 | forex-python（ECB） | 富途服务器内部汇率 |
| 折算方式 | 插件端手动 Σ(net_assets × rate) | API 端直接返回折算后总值 |
| 依赖 | forex-python 库 | 无额外依赖 |

## 6. 配置结构（config_schema）

插件注册时声明以下配置项，用户在 App 中填写：

| key | label | type | required | 说明 |
|-----|-------|------|----------|------|
| `target_book` | 目标账本 | `book_select` | 是 | 余额快照关联的账本 |
| `securities_account_id` | 证券资产科目 | `account_select` | 是 | 对应富途证券账户的资产科目（depends_on: target_book） |
| `opend_host` | OpenD 地址 | `string` | 否 | 默认 "127.0.0.1" |
| `opend_port` | OpenD 端口 | `string` | 否 | 默认 "11111" |
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
   b. 创建 OpenSecTradeContext 连接 OpenD
   c. 调用 accinfo_query(currency=Currency.CNH) 获取人民币计价总资产
   d. 提交余额快照 → securities_account_id
   e. 关闭 TradeContext
   f. 记录日志，等待下一个交易日
5. 退出时更新状态为 success/failed
```

## 9. 错误处理

| 场景 | 处理 |
|------|------|
| OpenD 未启动 / 连接失败 | 记录 error，重试 3 次（间隔 10 秒），仍失败则更新状态为 failed |
| OpenD 未登录 | 记录 error，提示用户检查 OpenD 登录状态 |
| accinfo_query 返回空 / 失败 | 记录 warning，本轮跳过 |
| total_assets 为 0 或异常 | 记录 warning，本轮跳过（避免错误覆盖） |
| 余额快照提交失败 | 记录 error，本轮跳过，不影响次日同步 |
| 网络异常 | 重试 3 次，间隔 10 秒 |
| 非交易时间（节假日/周末） | 仍然同步（净资产不变也无副作用） |

## 10. CLI 接口

```bash
# 交互式配置
python -m futu_monitor --setup

# 持续运行（每日盘后自动同步）
python -m futu_monitor

# 仅同步一次
python -m futu_monitor --once

# 详细日志
python -m futu_monitor -v
```

## 11. 依赖

```
requests>=2.28
futu-api>=9.0
```

> 注意：无需 `forex-python`，汇率由富途 API 端完成。

## 12. 与其他插件的差异

| 维度 | eastmoney_monitor | longport_monitor | futu_monitor |
|------|-------------------|------------------|--------------|
| 券商 | 东方财富（A股） | 长桥（港美股） | 富途（港美股） |
| 数据获取方式 | 网页爬虫（requests + OCR） | 官方 OpenAPI + SDK（HTTP） | OpenD 网关 + futu-api（TCP） |
| 认证方式 | 账号密码 + RSA + 验证码 | App Key / Secret / Token | OpenD 已登录，本地免密 |
| 汇率折算 | 不需要（原生 CNY） | forex-python 手动折算 | API 端指定 currency=CNH 自动折算 |
| 插件类型 | `balance` | `balance` | `balance` |
| 同步时间 | 15:30（A股收盘后） | 16:30（港股收盘后） | 16:30（港股收盘后） |
| 外部依赖 | 无 | longport SDK + forex-python | futu-api + 本地 OpenD 进程 |

## 13. 前置条件

- OpenD 已安装并启动（当前路径：`/root/bin/Futu_OpenD_9.6.5618_Ubuntu18.04/Futu_OpenD_9.6.5618_Ubuntu18.04/FutuOpenD`）
- OpenD 已配置富途账号并成功登录
- OpenD 监听端口默认 11111（可通过 `FutuOpenD.xml` 修改）

## 14. 验收标准

- [ ] `--setup` 可交互式完成本地配置
- [ ] 插件注册到 HomeAccountant 后，App 中可见并可配置科目
- [ ] 单次运行（`--once`）能成功连接 OpenD、查询总资产（CNH 计价）、提交余额快照
- [ ] 持续运行模式下每日 16:30 自动同步一次
- [ ] OpenD 未启动时有明确的错误提示
- [ ] 支持 SIGINT/SIGTERM 优雅退出

## 15. 备注

本插件利用富途 API 的 `currency` 参数直接获取人民币计价总资产，无需额外汇率依赖。相比 longport_monitor 的手动折算方案更简洁。如未来系统支持多币种，可改为不指定 currency 分别获取各币种资产。
