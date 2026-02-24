# 家庭记账 - 产品需求文档 (PRD)

> **版本：v0.3.0**
> **创建日期：2026-02-14**
> **基于版本：v0.2.3**
> **状态：规划中**
> **本版本变更：多账本支持 & 家庭协作**

---

## 1. 版本概述

### 1.1 版本目标

当前系统虽然数据模型已支持多账本（`books` + `book_members` 表），但**前端缺少账本管理和切换的完整 UI**，用户只能使用注册时自动创建的默认账本。本版本补齐多账本管理的完整闭环，并在此基础上实现家庭协作记账——多个家庭成员共享一本账。

| 能力 | 核心价值 |
|------|---------|
| 多账本管理 | 用户可创建多本账（如"个人账本""家庭账本""公司账本"），互不干扰 |
| 账本切换 | 全局账本切换器，一键在不同账本间切换 |
| 家庭协作 | 将家庭账本分享给家人，多人共同记账、查看报表 |
| 成员权限 | 管理员（admin）拥有完整管理权，成员（member）可记账和查看 |
| 账本设置 | 重命名、删除（仅 owner）、退出（非 owner 成员） |

### 1.2 现状分析

当前多账本相关的功能矩阵：

| 能力 | 后端模型 | 后端 API | 前端 UI |
|------|---------|---------|---------|
| 创建账本 | ✅ `Book` + `BookMember` | ✅ `POST /books` | ❌ 无入口（仅注册时自动创建） |
| 账本列表 | ✅ 通过 `book_members` JOIN | ✅ `GET /books` | ✅ `bookStore` 拉取但无切换 UI |
| 账本切换 | ✅ `bookStore.setCurrentBook` | — | ❌ 无切换器 UI |
| 更新账本 | ✅ 模型支持 | ❌ 无 API | ❌ |
| 删除账本 | ✅ 级联删除 | ❌ 无 API | ❌ |
| 邀请成员 | ✅ `BookMember(role)` | ❌ 无 API | ❌ |
| 成员管理 | ✅ 模型支持 | ❌ 无 API | ❌ |
| 退出账本 | ✅ 删除 `BookMember` 行 | ❌ 无 API | ❌ |

数据模型已基本就绪（`Book` 含 `type: personal/family`，`BookMember` 含 `role: admin/member`），需要补齐 API 和前端 UI。

### 1.3 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 账本切换入口 | 顶部栏 / Sidebar 显示当前账本名，点击展开切换器 | 全局可见，切换成本低 |
| 邀请方式 | 邮箱邀请 | 系统已有邮箱注册体系，无需额外 ID 系统 |
| 邀请确认 | 被邀请人登录后自动看到账本（无需确认） | MVP 简化，减少交互步骤 |
| 权限模型 | admin / member 两级 | 简洁够用；admin 可管理成员和删除账本，member 可记账和查看 |
| 账本删除 | 仅 owner 可删除 | 防止误删，owner 是创建者 |
| 数据隔离 | 切换账本后所有数据（科目、分录、报表等）切换到对应账本 | `bookStore.currentBook` 已是全局状态，所有 API 已按 `book_id` 隔离 |

### 1.4 不包含的内容（留待后续版本）

- 邀请链接 / 二维码分享
- 成员权限细分（如只读、仅查看报表）
- 账本数据导出 / 迁移
- 账本模板（从模板快速创建）
- 跨账本汇总报表

---

## 2. 功能需求：账本切换器

### 2.1 设计理念

用户在使用 App 的任何页面都应该清楚自己当前在哪本账。切换账本应该像切换聊天窗口一样简单——点击当前账本名，从下拉列表中选择即可。

### 2.2 入口位置

| 端 | 位置 | 展示 |
|----|------|------|
| 桌面端 | `Sidebar.tsx` 顶部，用户头像下方 | 当前账本名 + 下拉箭头 |
| 移动端 | `TopBar` 或 Tab 导航上方 | 当前账本名 + 下拉箭头 |

### 2.3 UI 布局

```
┌──────────────────────────────────┐
│  📖 家庭账本  ▾                   │ ← 点击展开
├──────────────────────────────────┤
│  ✔ 家庭账本        admin         │ ← 当前选中
│    个人账本         admin         │
│    公司账本         member        │
├──────────────────────────────────┤
│  ＋ 创建新账本                    │
│  ⚙ 账本设置                      │
└──────────────────────────────────┘
```

### 2.4 交互流程

```
用户点击当前账本名
  ↓
展开 Dropdown / BottomSheet（移动端）
  ↓
显示用户所有账本列表，当前账本标记 ✔
  ↓
点击其他账本 → bookStore.setCurrentBook(book) → 关闭弹出层
  ↓
全局数据刷新（科目树、分录列表、报表等重新拉取）
```

### 2.5 切换后数据刷新

账本切换后，以下数据需要重新拉取：

| Store | 刷新动作 |
|-------|---------|
| `accountStore` | `fetchTree(newBookId)` |
| `entryStore` | 重置分页并重新拉取 |
| Dashboard | 重新拉取 dashboard / expense-breakdown / net-worth-trend |
| 报表 | 清空缓存，下次打开重新拉取 |
| 预算 | `fetchBudgets(newBookId)` |
| 贷款 | 重新拉取 |
| 固定资产 | 重新拉取 |

实现方式：在 `bookStore.setCurrentBook` 中触发全局事件，或在各页面的 `useEffect` 中监听 `currentBook` 变化。

---

## 3. 功能需求：创建新账本

### 3.1 入口

- 账本切换器底部「+ 创建新账本」
- 桌面端"我的"页面 → 账本设置

### 3.2 创建表单

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| 名称 | TextInput | ✅ | 空 | 1-100 字符 |
| 类型 | Chip 选择 | ✅ | personal | `personal`（个人）/ `family`（家庭） |

```
┌─────────────────────────────┐
│        创建新账本             │
├─────────────────────────────┤
│  账本名称                    │
│  ┌─────────────────────┐    │
│  │ 家庭共享账本          │    │
│  └─────────────────────┘    │
│                             │
│  账本类型                    │
│  [个人]  [家庭]              │
│                             │
│  [取消]      [创建]          │
└─────────────────────────────┘
```

### 3.3 创建逻辑

```
用户填写名称 + 选择类型 → 点击「创建」
  ↓
POST /books { name, type }
  ↓
后端创建 Book + BookMember(owner, admin) + seed 预置科目
  ↓
成功 → 关闭 Modal + 刷新账本列表 + 自动切换到新账本
```

---

## 4. 功能需求：账本设置

### 4.1 入口

| 端 | 入口 |
|----|------|
| 桌面端 | "我的"页面左侧菜单增加「账本设置」项 → 右侧面板 |
| 移动端 | "我的"页面菜单增加「账本设置」→ `router.push` 新页面 |
| 账本切换器 | 底部「⚙ 账本设置」快捷入口 |

### 4.2 账本信息编辑

仅 admin 角色可编辑。

| 字段 | 可编辑 | 说明 |
|------|--------|------|
| 名称 | ✅ | `PUT /books/{book_id}` |
| 类型 | ❌ | 创建后不可更改 |
| 创建时间 | ❌ | 只读展示 |

### 4.3 成员管理（仅 admin 可见）

```
┌──────────────────────────────────┐
│  账本设置 - 家庭账本              │
├──────────────────────────────────┤
│  账本名称                        │
│  ┌──────────────────────────┐   │
│  │ 家庭账本                  │   │
│  └──────────────────────────┘   │
│  [保存修改]                      │
├──────────────────────────────────┤
│  成员（3）                       │
│  ┌──────────────────────────┐   │
│  │ 👤 张三   admin (owner)   │   │ ← owner 不可移除
│  │ 👤 李四   admin    [移除] │   │
│  │ 👤 王五   member   [移除] │   │
│  └──────────────────────────┘   │
│  ┌──────────────────────────┐   │
│  │ 邀请成员 (输入邮箱)       │   │
│  └──────────────────────────┘   │
│  角色: [管理员]  [成员]          │
│  [发送邀请]                      │
├──────────────────────────────────┤
│  危险操作                        │
│  [删除账本]                      │ ← 仅 owner 可见，红色按钮
│  [退出账本]                      │ ← 非 owner 成员可见
└──────────────────────────────────┘
```

---

## 5. 功能需求：成员邀请与管理

### 5.1 邀请成员

| 项目 | 说明 |
|------|------|
| 邀请方式 | 输入被邀请人的注册邮箱 |
| 角色选择 | admin / member，默认 member |
| 前置条件 | 被邀请人必须已注册（邮箱存在于 `users` 表） |
| 错误处理 | 邮箱不存在 → 提示「该邮箱未注册，请对方先注册」 |
| 重复邀请 | 已是成员 → 提示「该用户已是账本成员」 |

### 5.2 交互流程

```
admin 在成员管理区输入邮箱 + 选择角色 → 点击「发送邀请」
  ↓
POST /books/{book_id}/members { email, role }
  ↓
后端查找用户 → 创建 BookMember 记录
  ↓
成功 → Toast「已添加 xxx 为成员」→ 刷新成员列表
  ↓
被邀请人下次打开 App → GET /books 返回列表中包含该账本
```

### 5.3 移除成员

- 仅 admin 可移除其他成员
- owner 不可被移除
- 移除前弹出确认 Modal

### 5.4 修改成员角色

- 仅 admin 可修改其他成员角色
- owner 角色不可修改
- 点击角色标签切换 admin / member

### 5.5 退出账本

- 非 owner 成员可自行退出
- 退出前弹出确认 Modal
- 退出后自动切换到其他账本（若有）或显示空状态

### 5.6 删除账本

- 仅 owner 可删除
- 删除前弹出二次确认 Modal（输入账本名称确认）
- 删除后级联清除所有科目、分录、预算等数据
- 删除后自动切换到其他账本

---

## 6. 功能需求：权限控制

### 6.1 权限矩阵

| 操作 | owner | admin | member |
|------|-------|-------|--------|
| 查看科目/分录/报表 | ✅ | ✅ | ✅ |
| 记账（创建/编辑/删除分录） | ✅ | ✅ | ✅ |
| 创建/编辑/停用科目 | ✅ | ✅ | ❌ |
| 管理预算 | ✅ | ✅ | ❌ |
| 管理固定资产 | ✅ | ✅ | ❌ |
| 管理贷款 | ✅ | ✅ | ❌ |
| 修改账本名称 | ✅ | ✅ | ❌ |
| 邀请/移除成员 | ✅ | ✅ | ❌ |
| 修改成员角色 | ✅ | ✅ | ❌ |
| 删除账本 | ✅ | ❌ | ❌ |
| 退出账本 | ❌ | ✅ | ✅ |

### 6.2 后端权限检查

在现有 `user_has_book_access` 基础上扩展：

```python
async def get_member_role(db, user_id, book_id) -> str | None:
    """返回用户在账本中的角色：'admin' / 'member' / None"""

async def require_admin(db, user_id, book_id):
    """非 admin 则抛出 403"""

async def require_member(db, user_id, book_id):
    """非成员则抛出 403"""
```

### 6.3 前端权限感知

`bookStore` 扩展 `currentRole` 字段：

```typescript
type BookState = {
  books: BookResponse[];
  currentBook: BookResponse | null;
  currentRole: 'admin' | 'member' | null;  // 新增
  // ...
};
```

UI 根据 `currentRole` 隐藏/禁用无权操作的按钮。

---

## 7. API 设计

### 7.1 新增 API

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `PUT` | `/books/{book_id}` | JWT | 更新账本（名称），需 admin |
| `DELETE` | `/books/{book_id}` | JWT | 删除账本，需 owner |
| `GET` | `/books/{book_id}/members` | JWT | 获取成员列表，需 member+ |
| `POST` | `/books/{book_id}/members` | JWT | 邀请成员（邮箱 + 角色），需 admin |
| `PUT` | `/books/{book_id}/members/{user_id}` | JWT | 修改成员角色，需 admin |
| `DELETE` | `/books/{book_id}/members/{user_id}` | JWT | 移除成员，需 admin |
| `POST` | `/books/{book_id}/leave` | JWT | 退出账本，非 owner 成员 |

### 7.2 修改现有 API

| API | 变更 |
|-----|------|
| `GET /books` | 响应增加 `role` 字段（用户在该账本中的角色） |
| 所有 `book_id` 相关 API | admin-only 操作增加角色校验 |

### 7.3 Schema 变更

```python
# 新增
class BookMemberResponse(BaseModel):
    user_id: str
    email: str
    nickname: str | None
    role: str  # admin / member
    is_owner: bool

class InviteMemberRequest(BaseModel):
    email: str
    role: str = "member"  # admin / member

class UpdateBookRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)

class UpdateMemberRoleRequest(BaseModel):
    role: str = Field(..., pattern=r"^(admin|member)$")

# 修改
class BookResponse(BaseModel):
    id: str
    name: str
    type: str
    owner_id: str
    created_at: datetime
    role: str  # 新增：当前用户在此账本中的角色
```

---

## 8. UI 设计规范

### 8.1 账本切换器样式

| 属性 | 桌面端 | 移动端 |
|------|--------|--------|
| 触发器 | Sidebar 顶部，当前账本名 + `chevron-down` 图标 | TopBar 区域，当前账本名 + `chevron-down` |
| 弹出层 | Dropdown（绝对定位，阴影卡片） | BottomSheet（从底部滑入） |
| 账本项高度 | 44px | 52px |
| 当前选中 | 左侧 `check` 图标 + `Colors.primary` 文字色 | 同左 |
| 角色标签 | 右侧灰色小字 `admin` / `member` | 同左 |
| 底部操作 | 分隔线 + 「创建新账本」「账本设置」 | 同左 |

### 8.2 成员列表项样式

```
┌──────────────────────────────────────────┐
│  👤  张三 (zhang@example.com)   admin    │
│      └── owner                  [移除]   │
└──────────────────────────────────────────┘
```

| 属性 | 值 |
|------|-----|
| 头像 | 40px 圆形，灰色背景 + 首字母 |
| 名称 | 15px, fontWeight 500 |
| 邮箱 | 13px, textSecondary |
| 角色标签 | Chip 样式，admin 用 `Colors.primary`，member 用灰色 |
| 移除按钮 | 红色文字，owner 行不显示 |

### 8.3 删除账本确认弹窗

需要**二次确认**——用户必须输入账本名称才能删除，防止误操作：

```
┌──────────────────────────────┐
│        删除账本               │
│                              │
│  此操作不可恢复！将永久删除   │
│  账本「家庭账本」及其所有     │
│  科目、分录、预算等数据。     │
│                              │
│  请输入账本名称以确认：       │
│  ┌────────────────────┐     │
│  │                    │     │
│  └────────────────────┘     │
│                              │
│  [取消]        [删除]        │
└──────────────────────────────┘
```

- 输入内容与账本名称完全匹配时，「删除」按钮才可点击
- 「删除」按钮红色样式

---

## 9. 涉及文件变更

### 9.1 后端新增

| 文件 | 说明 |
|------|------|
| `server/app/routers/books.py` | 新增 PUT/DELETE 账本、成员管理 5 个端点 |
| `server/app/schemas/book.py` | 新增 `UpdateBookRequest`、`InviteMemberRequest`、`BookMemberResponse` 等 |
| `server/app/services/book_service.py` | 新增成员邀请/移除/角色修改/退出/删除逻辑 |

### 9.2 后端修改

| 文件 | 变更 |
|------|------|
| `server/app/schemas/book.py` | `BookResponse` 增加 `role` 字段 |
| `server/app/routers/books.py` | `GET /books` 返回带 role 的响应 |
| `server/app/services/book_service.py` | `get_user_books` 返回含角色信息 |
| 各 admin-only router | 增加角色校验（科目管理、预算、资产、贷款） |

### 9.3 前端新增

| 文件 | 说明 |
|------|------|
| `client/features/book/BookSwitcher.tsx` | 账本切换器组件 |
| `client/features/book/BookSettingsPane.tsx` | 桌面端账本设置面板 |
| `client/features/book/MemberList.tsx` | 成员列表组件 |
| `client/features/book/InviteMemberModal.tsx` | 邀请成员弹窗 |
| `client/app/settings/book.tsx` | 移动端账本设置页面 |

### 9.4 前端修改

| 文件 | 变更 |
|------|------|
| `client/services/bookService.ts` | 新增成员管理、更新/删除账本 API |
| `client/stores/bookStore.ts` | 增加 `currentRole`、切换后触发全局刷新 |
| `client/components/layout/Sidebar.tsx` | 集成 `BookSwitcher` |
| `client/app/(tabs)/_layout.tsx` | 移动端集成账本切换入口 |
| `client/app/(tabs)/profile.tsx` | 菜单增加「账本设置」项 |
| `client/features/profile/types.ts` | `DetailPane` 增加 `'book-settings'` |
| 各管理页面 | 根据 `currentRole` 隐藏无权操作按钮 |

### 9.5 测试新增

| 文件 | 说明 |
|------|------|
| `server/tests/test_book_members.py` | 成员邀请/移除/角色修改/退出测试 |
| `server/tests/test_book_management.py` | 账本更新/删除/权限校验测试 |

---

## 10. 版本规划更新

### v0.0.1 (MVP) — 已完成 ✅
### v0.0.2 — 已完成 ✅
### v0.0.3 — 已完成 ✅
### v0.1.1 — 已完成 ✅
### v0.2.0 — 已完成 ✅
### v0.2.1 — 已完成 ✅
### v0.2.2 — 已完成 ✅
### v0.2.3 — 已完成 ✅

### v0.3.0 — 本版本

- [ ] 账本切换器
  - [ ] 桌面端 Sidebar 顶部账本切换 Dropdown
  - [ ] 移动端 TopBar 账本切换 BottomSheet
  - [ ] 切换后全局数据刷新（科目、分录、报表、预算等）
  - [ ] 当前账本名 + 角色标签展示
- [ ] 创建新账本
  - [ ] Modal 表单（名称 + 类型选择）
  - [ ] 创建成功后自动切换
  - [ ] 预置科目自动灌入
- [ ] 账本设置
  - [ ] 桌面端 BookSettingsPane
  - [ ] 移动端 settings/book.tsx
  - [ ] 编辑账本名称（admin）
  - [ ] 删除账本（owner，二次确认）
  - [ ] 退出账本（非 owner）
- [ ] 成员管理
  - [ ] 成员列表（邮箱 + 昵称 + 角色 + owner 标记）
  - [ ] 邀请成员（邮箱 + 角色选择）
  - [ ] 移除成员（确认 Modal）
  - [ ] 修改成员角色
- [ ] 权限控制
  - [ ] 后端 `require_admin` / `require_member` 依赖注入
  - [ ] 科目管理、预算、资产、贷款路由增加 admin 校验
  - [ ] 前端 `currentRole` 状态，无权操作按钮隐藏/禁用
- [ ] API 新增
  - [ ] `PUT /books/{book_id}` 更新账本
  - [ ] `DELETE /books/{book_id}` 删除账本
  - [ ] `GET /books/{book_id}/members` 成员列表
  - [ ] `POST /books/{book_id}/members` 邀请成员
  - [ ] `PUT /books/{book_id}/members/{user_id}` 修改角色
  - [ ] `DELETE /books/{book_id}/members/{user_id}` 移除成员
  - [ ] `POST /books/{book_id}/leave` 退出账本
  - [ ] `GET /books` 响应增加 `role` 字段
- [ ] 测试
  - [ ] 成员邀请 → 被邀请人可见账本
  - [ ] 邀请不存在的邮箱 → 错误提示
  - [ ] 重复邀请 → 错误提示
  - [ ] admin 移除 member → 成功
  - [ ] member 无法移除其他人 → 403
  - [ ] owner 不可被移除 → 400
  - [ ] owner 删除账本 → 级联删除所有数据
  - [ ] 非 owner 删除账本 → 403
  - [ ] 退出账本后不再可见
  - [ ] member 角色无法创建/编辑科目 → 403
  - [ ] 账本切换后数据正确隔离

### （远期）

- [ ] 邀请链接 / 二维码分享
- [ ] 成员权限细分（只读、仅报表）
- [ ] 跨账本汇总报表
- [ ] 科目批量导入（CSV/Excel）
- [ ] 科目合并/拆分
- [ ] 科目排序拖拽
- [ ] CSV 账单导入 & 流水匹配对账
- [ ] 数据导出（CSV/Excel/PDF）

---

## 11. 验收标准

| 编号 | 验收项 | 验收标准 |
|------|--------|---------|
| B-1 | 账本切换器 | Sidebar / TopBar 展示当前账本名，点击展开账本列表 |
| B-2 | 账本切换 | 选择其他账本后，全局数据（科目、分录、报表等）切换到对应账本 |
| B-3 | 创建账本 | 切换器底部「创建新账本」→ Modal 填写名称和类型 → 创建成功 → 自动切换 |
| B-4 | 预置科目 | 新账本创建后自动包含完整预置科目体系 |
| B-5 | 账本重命名 | 账本设置页可修改名称，仅 admin 可操作 |
| B-6 | 删除账本 | owner 在账本设置页可删除账本，需输入账本名称二次确认 |
| B-7 | 退出账本 | 非 owner 成员可退出，退出后账本列表不再显示该账本 |
| B-8 | 邀请成员 | admin 输入邮箱 + 选择角色 → 被邀请人登录后可见该账本 |
| B-9 | 移除成员 | admin 可移除非 owner 成员，移除后对方不再可见该账本 |
| B-10 | 角色修改 | admin 可修改非 owner 成员角色（admin ↔ member） |
| B-11 | 权限隔离 | member 角色无法操作科目管理、预算、资产、贷款等管理功能 |
| B-12 | member 记账 | member 角色可正常记账、查看分录和报表 |
| B-13 | 数据隔离 | 不同账本的科目、分录、报表完全独立 |
| B-14 | 角色展示 | 账本列表中每个账本显示当前用户的角色（admin/member） |
| B-15 | 桌面端一致性 | BookSettingsPane 与移动端 settings/book.tsx 功能一致 |

---

## 12. 约束与风险

| 约束/风险 | 说明 | 缓解措施 |
|----------|------|---------|
| 被邀请人需已注册 | 当前不支持邮件邀请未注册用户 | 提示「请对方先注册」，后续版本可加邮件通知 |
| 无邀请确认流程 | 被添加后直接可见账本，无确认步骤 | MVP 简化设计；后续可加确认/拒绝机制 |
| 删除不可恢复 | 账本删除后数据永久丢失 | 二次确认（输入账本名称）；后续可加软删除/回收站 |
| 切换账本的数据加载 | 切换时需重新拉取大量数据，可能有短暂加载 | 各 Store 独立 loading 状态，UI 展示 skeleton/loading |
| 并发编辑冲突 | 多人同时编辑同一条分录 | 当前版本采用"最后写入胜出"，后续可加乐观锁 |
| 角色变更实时性 | 被降权后若 App 未刷新仍可操作 | 后端始终校验权限，前端定期刷新或 WebSocket 通知 |
