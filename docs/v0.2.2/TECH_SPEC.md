# 家庭记账 - 技术方案文档 (Tech Spec)

> **版本：v0.2.2**
> **创建日期：2026-02-14**
> **基于版本：v0.2.1**
> **状态：规划中**
> **本版本变更：末级科目记账约束 + 科目体系重构**

---

## 1. 技术架构概述

v0.2.2 在已有复式记账系统上增加「末级科目记账约束」，涉及后端校验逻辑、前端 AccountPicker 交互改造、科目树 API 增强。

### 1.1 变更范围

| 层 | 文件 | 变更类型 | 说明 |
|----|------|---------|------|
| **Service** | `server/app/services/entry_service.py` | 修改 | `_get_account` 增加叶子节点校验 |
| **Service** | `server/app/services/account_service.py` | 修改 | `build_account_tree` 填充 `is_leaf` 字段；创建子科目时触发自动迁移；删除/停用科目前校验 |
| **Schema** | `server/app/schemas/account.py` | 修改 | `AccountTreeNode` 新增 `is_leaf: bool`；创建科目响应新增 `migration` 字段 |
| **Seed** | `server/app/utils/seed.py` | 已完成 | 科目体系重构（货币资金/现金等价物） |
| **前端组件** | `client/features/entry/AccountPicker.tsx` | 修改 | 父节点不可选，视觉区分 |
| **前端类型** | `client/services/accountService.ts` | 修改 | `AccountTreeNode` 类型新增 `is_leaf` |
| **测试** | `server/tests/test_leaf_account.py` | 新增 | 末级科目约束 + 自动迁移 + 删除保护测试 |

---

## 2. 后端实现

### 2.1 叶子节点检查函数

**文件：`server/app/services/entry_service.py`**

新增辅助函数 `_check_is_leaf`，在 `_get_account` 中调用：

```python
from sqlalchemy import func, select

async def _check_is_leaf(db: AsyncSession, account_id: str) -> bool:
    """检查科目是否为末级科目（无活跃子科目）"""
    result = await db.execute(
        select(func.count()).where(
            Account.parent_id == account_id,
            Account.is_active == True,
        )
    )
    return result.scalar() == 0


async def _get_account(
    db: AsyncSession,
    account_id: str,
    book_id: str,
    *,
    require_leaf: bool = True,   # 新增参数，默认要求叶子节点
) -> Account:
    """获取科目并校验归属 + 叶子节点"""
    result = await db.execute(
        select(Account).where(
            Account.id == account_id,
            Account.book_id == book_id,
            Account.is_active == True,
        )
    )
    acc = result.scalar_one_or_none()
    if not acc:
        raise EntryError(f"科目不存在或已停用: {account_id}", 404)

    # 叶子节点校验
    if require_leaf:
        is_leaf = await _check_is_leaf(db, account_id)
        if not is_leaf:
            # 查询子科目数量用于提示
            child_count_result = await db.execute(
                select(func.count()).where(
                    Account.parent_id == account_id,
                    Account.is_active == True,
                )
            )
            child_count = child_count_result.scalar()
            raise EntryError(
                f"科目「{acc.name}」（{acc.code}）为非末级科目，"
                f"含 {child_count} 个子科目，请选择其下的末级科目记账",
                400,
            )

    return acc
```

**设计说明**：

- `require_leaf=True` 为默认值，所有现有调用点无需修改即自动启用校验
- 保留 `require_leaf=False` 选项，供未来特殊场景使用（如查询/报表场景中读取父科目信息）
- `_check_is_leaf` 使用 `COUNT` 查询，性能优于加载所有子科目对象
- 错误信息包含科目名称、编码和子科目数量，方便用户定位问题

### 2.2 影响的创建/编辑函数

以下函数内部调用 `_get_account` 时，自动继承叶子节点校验，**无需额外修改**：

| 函数 | 校验的科目字段 |
|------|--------------|
| `create_expense` | `category_account_id`, `payment_account_id` |
| `create_income` | `category_account_id`, `payment_account_id` |
| `create_asset_purchase` | `category_account_id`, `payment_account_id` |
| `create_borrow` | `category_account_id`, `payment_account_id` |
| `create_repayment` | `category_account_id`, `payment_account_id` |
| `create_transfer` | `from_account_id`, `to_account_id` |
| `create_manual_entry` | 所有 `lines[].account_id` |
| `_rebuild_lines`（编辑） | 变更后的 `category_account_id`, `payment_account_id` |
| `convert_entry_type` | 新指定的 `category_account_id`, `payment_account_id` |

### 2.3 批量记账适配

**文件：`server/app/services/batch_entry_service.py`**

批量记账内部调用 `create_expense` / `create_income` 等函数，校验自动生效。单条失败不影响其他条（已有的错误隔离机制）。

错误信息格式调整：

```python
# 批量记账中某条选了父科目
{
    "index": 2,
    "status": "error",
    "error": "科目「货币资金」（1001）为非末级科目，含 2 个子科目，请选择其下的末级科目记账"
}
```

---

## 2.5 历史分录自动迁移

### 2.5.1 触发时机

在 `account_service.py` 的「创建子科目」逻辑中，当新科目的 `parent_id` 指向一个当前为叶子节点的科目时触发迁移。

### 2.5.2 实现代码

**文件：`server/app/services/account_service.py`**

在 `create_account()` 函数中增加迁移逻辑：

```python
async def _migrate_lines_to_fallback(
    db: AsyncSession,
    parent_account: Account,
) -> dict:
    """当父科目变为非叶子时，将其关联的分录行迁移到「待分类」子科目"""
    from app.models.entry import EntryLine

    # 1. 检查父科目是否有关联的 entry_lines
    line_count_result = await db.execute(
        select(func.count()).where(EntryLine.account_id == parent_account.id)
    )
    line_count = line_count_result.scalar()

    if line_count == 0:
        return {"triggered": False}

    # 2. 查找或创建待分类子科目
    fallback_code = f"{parent_account.code}-99"
    fallback_name = f"待分类{parent_account.name}"

    existing = await db.execute(
        select(Account).where(
            Account.book_id == parent_account.book_id,
            Account.code == fallback_code,
            Account.is_active == True,
        )
    )
    fallback = existing.scalar_one_or_none()

    if not fallback:
        fallback = Account(
            book_id=parent_account.book_id,
            code=fallback_code,
            name=fallback_name,
            type=parent_account.type,
            parent_id=parent_account.id,
            balance_direction=parent_account.balance_direction,
            icon="question-circle",
            is_system=True,
            sort_order=990,
        )
        db.add(fallback)
        await db.flush()  # 获取 fallback.id

    # 3. 批量迁移 entry_lines
    await db.execute(
        update(EntryLine)
        .where(EntryLine.account_id == parent_account.id)
        .values(account_id=fallback.id)
    )

    return {
        "triggered": True,
        "fallback_account": {
            "id": str(fallback.id),
            "code": fallback.code,
            "name": fallback.name,
        },
        "migrated_lines_count": line_count,
        "message": f"已将 {line_count} 条分录从「{parent_account.name}」迁移至「{fallback_name}」",
    }
```

### 2.5.3 集成到创建子科目流程

```python
async def create_account(db, book_id, data):
    # ... 现有校验逻辑 ...

    migration_info = {"triggered": False}

    # 如果指定了 parent_id，检查父科目是否会从叶子变为非叶子
    if data.parent_id:
        parent = await db.get(Account, data.parent_id)
        is_currently_leaf = await _check_is_leaf(db, data.parent_id)
        if is_currently_leaf:
            # 父科目即将从叶子变为非叶子，触发迁移
            migration_info = await _migrate_lines_to_fallback(db, parent)

    # 创建新科目
    new_account = Account(...)
    db.add(new_account)
    await db.flush()

    return new_account, migration_info
```

### 2.5.4 API 响应 Schema

**文件：`server/app/schemas/account.py`**

```python
class MigrationInfo(BaseModel):
    triggered: bool = False
    fallback_account: dict | None = None
    migrated_lines_count: int = 0
    message: str = ""

class AccountCreateResponse(BaseModel):
    """创建科目的响应，包含可能的迁移信息"""
    id: str
    code: str
    name: str
    type: str
    # ... 其他字段 ...
    migration: MigrationInfo = MigrationInfo()
```

### 2.5.5 事务安全

迁移逻辑与创建子科目在**同一个数据库事务**中执行：
- 如果迁移失败 → 整个事务回滚，子科目也不会创建
- 如果创建子科目失败 → 迁移也不会生效

这保证了数据一致性。

---

## 2.6 科目删除/停用保护

### 2.6.1 校验函数

**文件：`server/app/services/account_service.py`**

在删除/停用科目的函数中增加前置校验：

```python
async def _check_account_deletable(db: AsyncSession, account: Account) -> None:
    """检查科目是否可以删除/停用"""
    from app.models.entry import EntryLine

    # 检查 1: 是否有分录行引用
    line_count_result = await db.execute(
        select(func.count()).where(EntryLine.account_id == account.id)
    )
    line_count = line_count_result.scalar()
    if line_count > 0:
        raise AccountError(
            f"科目「{account.name}」（{account.code}）下有 {line_count} 条分录引用，"
            f"请先将这些分录迁移到其他科目后再删除",
            400,
        )

    # 检查 2: 是否有活跃子科目
    child_count_result = await db.execute(
        select(func.count()).where(
            Account.parent_id == account.id,
            Account.is_active == True,
        )
    )
    child_count = child_count_result.scalar()
    if child_count > 0:
        raise AccountError(
            f"科目「{account.name}」（{account.code}）下有 {child_count} 个子科目，"
            f"请先删除或迁移子科目后再删除",
            400,
        )
```

### 2.6.2 集成到删除/停用流程

```python
async def delete_account(db, account_id, book_id):
    account = await _get_account_by_id(db, account_id, book_id)
    await _check_account_deletable(db, account)
    # ... 执行删除 ...

async def deactivate_account(db, account_id, book_id):
    account = await _get_account_by_id(db, account_id, book_id)
    await _check_account_deletable(db, account)
    account.is_active = False
    # ... 保存 ...
```

### 2.6.3 SQL 查询

```sql
-- 检查科目是否有分录行引用
SELECT COUNT(*) FROM entry_lines WHERE account_id = :account_id;

-- 检查科目是否有活跃子科目
SELECT COUNT(*) FROM accounts
WHERE parent_id = :account_id AND is_active = 1;
```

---

## 3. 科目树 API 增强

### 3.1 Schema 变更

**文件：`server/app/schemas/account.py`**

```python
class AccountTreeNode(BaseModel):
    id: str
    code: str
    name: str
    type: str
    balance_direction: str
    icon: str | None = None
    is_system: bool = True
    sort_order: int = 0
    is_active: bool = True
    has_external_source: bool = False
    children: list["AccountTreeNode"] = []
    is_leaf: bool = True              # ← 新增字段
```

### 3.2 Service 变更

**文件：`server/app/services/account_service.py`**

在 `build_account_tree` 中，树构建完成后填充 `is_leaf`：

```python
def build_account_tree(accounts: list[Account]) -> AccountTreeResponse:
    """将扁平科目列表构建为按 type 分组的树形结构"""
    node_map: dict[str, AccountTreeNode] = {}
    for acc in accounts:
        node_map[acc.id] = _account_to_node(acc)

    roots: dict[str, list[AccountTreeNode]] = {
        "asset": [], "liability": [], "equity": [], "income": [], "expense": [],
    }

    for acc in accounts:
        node = node_map[acc.id]
        if acc.parent_id and acc.parent_id in node_map:
            node_map[acc.parent_id].children.append(node)
        else:
            roots[acc.type].append(node)

    # ← 新增：递归填充 is_leaf
    def _fill_is_leaf(node: AccountTreeNode):
        node.is_leaf = len(node.children) == 0
        for child in node.children:
            _fill_is_leaf(child)

    for type_nodes in roots.values():
        for node in type_nodes:
            _fill_is_leaf(node)

    return AccountTreeResponse(**roots)
```

### 3.3 前端类型同步

**文件：`client/services/accountService.ts`**

```typescript
export interface AccountTreeNode {
  id: string;
  code: string;
  name: string;
  type: string;
  balance_direction: string;
  icon: string | null;
  is_system: boolean;
  sort_order: number;
  is_active: boolean;
  has_external_source: boolean;
  children: AccountTreeNode[];
  is_leaf: boolean;           // ← 新增
}
```

---

## 4. 前端 AccountPicker 改造

### 4.1 核心变更

**文件：`client/features/entry/AccountPicker.tsx`**

改造 `AccountItem` 组件中的 `onPress` 逻辑：

```typescript
// 当前代码（有问题）：
onPress={() => {
  if (hasChildren) setExpanded(!expanded);  // 展开/折叠
  onSelect(node);                           // ← 父节点也会触发选择!
}}

// 改造后：
onPress={() => {
  if (hasChildren) {
    setExpanded(!expanded);                 // 仅展开/折叠
    // 不调用 onSelect → 父节点不可选
  } else {
    onSelect(node);                         // 仅叶子节点触发选择
  }
}}
```

### 4.2 视觉样式变更

```typescript
function AccountItem({ node, depth, selectedId, onSelect, typeColor }) {
  const hasChildren = node.children.length > 0;
  const isLeaf = !hasChildren;
  const [expanded, setExpanded] = useState(true);

  return (
    <>
      <Pressable
        style={[
          styles.item,
          { paddingLeft: 16 + depth * 20 },
          // 叶子节点选中高亮
          isLeaf && selectedId === node.id && { backgroundColor: typeColor + '18' },
        ]}
        onPress={() => {
          if (hasChildren) {
            setExpanded(!expanded);
          } else {
            onSelect(node);
          }
        }}
      >
        {/* 折叠箭头：仅父节点显示 */}
        {hasChildren ? (
          <FontAwesome
            name={expanded ? 'chevron-down' : 'chevron-right'}
            size={10}
            color={colors.textSecondary}
          />
        ) : (
          <View style={styles.chevron} />
        )}

        {/* 科目名称：父节点灰色，叶子节点正常 */}
        <Text
          style={[
            styles.name,
            { color: isLeaf ? colors.text : colors.textSecondary },
            !isLeaf && { fontWeight: '600' },  // 父节点加粗表示分类
          ]}
        >
          {node.name}
        </Text>

        {/* 选中勾选：仅叶子节点显示 */}
        {isLeaf && selectedId === node.id && (
          <FontAwesome name="check" size={14} color={typeColor} />
        )}
      </Pressable>

      {/* 递归子节点 */}
      {expanded && hasChildren && node.children.map(child => (
        <AccountItem key={child.id} node={child} depth={depth + 1} ... />
      ))}
    </>
  );
}
```

### 4.3 顶层 handleSelect 变更

```typescript
// 当前代码：
const handleSelect = (node: AccountTreeNode) => {
  onSelect(node);  // 无条件选中
  onClose();
};

// 改造后（防御性判断，实际 AccountItem 已不会传入父节点）：
const handleSelect = (node: AccountTreeNode) => {
  if (node.children && node.children.length > 0) return;  // 安全保护
  onSelect(node);
  onClose();
};
```

---

## 5. 测试计划

### 5.1 新增测试文件

**文件：`server/tests/test_leaf_account.py`**

```python
class TestLeafAccountConstraint:
    """末级科目记账约束测试"""

    async def test_leaf_account_can_create_entry(self):
        """叶子科目可以正常记账"""
        # 选择 1001-01 现金（叶子）→ 201

    async def test_parent_account_cannot_create_entry(self):
        """父科目不允许记账"""
        # 选择 1001 货币资金（父）→ 400 + 错误提示

    async def test_parent_account_error_message(self):
        """错误信息包含科目名称和子科目数量"""
        # 验证错误信息格式

    async def test_second_level_parent_cannot_create(self):
        """二级父科目也不允许记账"""
        # 选择 1001-02 存款（有子科目）→ 400

    async def test_edit_entry_with_parent_account_rejected(self):
        """编辑分录时将科目改为父科目 → 拒绝"""

    async def test_edit_entry_with_leaf_account_accepted(self):
        """编辑分录时将科目改为叶子科目 → 成功"""

    async def test_historical_entry_with_parent_account_untouched(self):
        """历史分录引用父科目 → 查询正常，不报错"""

    async def test_account_becomes_non_leaf(self):
        """科目新增子科目后自动变为不可记账"""
        # 1. 先用 5001 餐饮饮食（叶子）记一笔 → 成功
        # 2. 给 5001 新增子科目 5001-01 外卖
        # 3. 再用 5001 记一笔 → 400 失败

    async def test_auto_migration_on_add_child(self):
        """新增子科目时自动迁移父科目上的分录"""
        # 1. 用 5001 餐饮饮食（叶子）记 3 笔
        # 2. 给 5001 新增子科目 5001-01 外卖
        # 3. 验证自动创建了 5001-99 待分类餐饮饮食
        # 4. 验证 3 条 entry_lines 的 account_id 已指向 5001-99
        # 5. 验证 API 响应的 migration.triggered == True

    async def test_no_migration_when_no_lines(self):
        """父科目无分录时不触发迁移"""
        # 1. 1001 货币资金（叶子，无分录）
        # 2. 给 1001 新增子科目 → migration.triggered == False
        # 3. 不应创建 1001-99 待分类

    async def test_migration_reuses_existing_fallback(self):
        """待分类科目编码冲突时复用已有科目"""
        # 1. 手动创建 5001-99 待分类餐饮饮食
        # 2. 用 5001 记 2 笔
        # 3. 给 5001 新增子科目 → 复用已存在的 5001-99
        # 4. 验证 2 条 entry_lines 迁移到已有的 5001-99

    async def test_migration_transaction_safety(self):
        """迁移失败时整个事务回滚"""

    async def test_transfer_with_parent_accounts_rejected(self):
        """转账选择父科目 → 拒绝"""

    async def test_manual_entry_with_parent_account_rejected(self):
        """手工分录行引用父科目 → 拒绝"""

    async def test_batch_create_with_parent_account(self):
        """批量记账中某条选了父科目 → 该条报错，其他条正常"""

    async def test_convert_with_parent_account_rejected(self):
        """类型转换时指定父科目 → 拒绝"""

class TestAccountDeleteProtection:
    """科目删除/停用保护测试"""

    async def test_delete_account_with_entry_lines_rejected(self):
        """删除有分录引用的科目 → 拒绝"""
        # 1. 用 1001-01 现金记一笔
        # 2. 删除 1001-01 → 400，提示有 1 条分录引用

    async def test_delete_account_with_children_rejected(self):
        """删除有子科目的科目 → 拒绝"""
        # 1. 1001 货币资金有子科目 1001-01, 1001-02
        # 2. 删除 1001 → 400，提示有 2 个子科目

    async def test_delete_clean_account_success(self):
        """删除无引用无子科目的科目 → 成功"""
        # 1. 创建一个无分录引用的叶子科目
        # 2. 删除 → 成功

    async def test_deactivate_account_with_entry_lines_rejected(self):
        """停用有分录引用的科目 → 拒绝"""

    async def test_deactivate_account_with_children_rejected(self):
        """停用有活跃子科目的科目 → 拒绝"""
```

### 5.2 已有测试影响

| 测试文件 | 影响 | 处理 |
|---------|------|------|
| `test_entries.py` | 现有测试使用叶子科目 → 不受影响 | 确认无需修改 |
| `test_entry_convert.py` | 转换时使用叶子科目 → 不受影响 | 确认无需修改 |
| `test_batch_entries.py` | 批量记账使用叶子科目 → 不受影响 | 确认无需修改 |
| `conftest.py` | fixture 创建科目时的结构 → 可能需要调整 | 检查是否需要新增子科目 fixture |

> 如果现有测试 fixture 中创建了含子科目的科目并且用该父科目记账，需要改为使用其叶子子科目。

---

## 6. 开发实施计划

### 阶段 1：后端 — 叶子节点校验（预计 0.5 天）

1. 实现 `_check_is_leaf()` 辅助函数
2. 修改 `_get_account()` 增加 `require_leaf` 参数
3. 确认所有创建/编辑/转换函数自动继承校验
4. 编写单元测试 `test_leaf_account.py`（校验部分）
5. 运行全量测试确认无回归

### 阶段 2：历史分录自动迁移（预计 0.5 天）

1. 实现 `_migrate_lines_to_fallback()` 函数
2. 集成到 `create_account()` 流程
3. 新增 `MigrationInfo` / `AccountCreateResponse` Schema
4. 编写迁移相关单元测试
5. 边界测试（无分录、编码冲突、事务回滚）

### 阶段 3：科目删除/停用保护（预计 0.25 天）

1. 实现 `_check_account_deletable()` 校验函数
2. 集成到 `delete_account()` 和 `deactivate_account()` 流程
3. 编写删除保护单元测试（有分录拒绝、有子科目拒绝、干净科目成功）

### 阶段 4：科目树 API 增强（预计 0.25 天）

1. `AccountTreeNode` Schema 新增 `is_leaf` 字段
2. `build_account_tree` 填充 `is_leaf`
3. 前端 `AccountTreeNode` TypeScript 类型同步
4. API 响应验证

### 阶段 5：前端 AccountPicker 改造（预计 0.5 天）

1. `AccountItem` 组件 `onPress` 逻辑拆分（父节点仅展开，叶子节点才选中）
2. 父节点灰色样式 + 叶子节点正常样式
3. `handleSelect` 增加防御性判断
4. 创建子科目后展示迁移提示 Toast
5. 全页面联调（记账页、编辑页、转换弹窗等使用 AccountPicker 的地方）

### 阶段 6：测试 & 验证（预计 0.25 天）

1. 后端全量测试（`pytest`）
2. 前端手动验证 AccountPicker 行为
3. 新建账本验证科目结构
4. 边界场景验证（历史分录迁移、动态叶子变更、删除保护、事务安全）

---

### 总体时间估算

| 阶段 | 内容 | 预计工时 | 累计 |
|------|------|---------|------|
| 1 | 后端叶子节点校验 | 0.5 天 | 0.5 天 |
| 2 | 历史分录自动迁移 | 0.5 天 | 1 天 |
| 3 | 科目删除/停用保护 | 0.25 天 | 1.25 天 |
| 4 | 科目树 API 增强 | 0.25 天 | 1.5 天 |
| 5 | 前端 AccountPicker 改造 | 0.5 天 | 2 天 |
| 6 | 测试 & 验证 | 0.25 天 | 2.25 天 |

> v0.2.2 总计约 **2.25 个工作日**。

---

## 7. SQL 查询说明

### 7.1 叶子节点检查查询

```sql
-- 检查 account_id 是否为叶子节点
SELECT COUNT(*) FROM accounts
WHERE parent_id = :account_id AND is_active = 1;
-- 返回 0 → 叶子节点，可记账
-- 返回 > 0 → 非叶子节点，不可记账
```

### 7.2 索引

`accounts` 表的 `parent_id` 列已有外键索引，`COUNT` 查询性能良好。无需额外创建索引。

### 7.3 自动迁移查询

```sql
-- 检查父科目是否有关联的分录行
SELECT COUNT(*) FROM entry_lines WHERE account_id = :parent_id;

-- 批量迁移分录行到待分类子科目
UPDATE entry_lines SET account_id = :fallback_id
WHERE account_id = :parent_id;
```

### 7.4 查询频率

每次创建/编辑分录时，为每个涉及的科目 ID 执行一次 `COUNT` 查询：
- 普通分录（费用/收入等）：2 次查询（`category_account_id` + `payment_account_id`）
- 手工分录：N 次查询（每个 line 的 `account_id`）
- 批量记账 M 条：最多 2M 次查询

对于 SQLite 本地数据库，这些额外查询的开销可忽略不计（< 1ms/次）。

---

## 8. 兼容性说明

| 场景 | 兼容策略 |
|------|---------|
| 已有分录引用父科目 | 新增子科目时自动迁移到「待分类」子科目，保证所有分录指向叶子节点 |
| 旧账本科目结构 | 不自动迁移科目层级结构，保持原结构 |
| MCP Tool 记账 | 自动继承后端校验，错误信息返回 LLM 可理解文本 |
| 外部插件批量导入 | 如果插件传入了父科目 ID，该条记录标记为 error |
| API Key 认证 | 无影响，校验在 service 层，与认证层无关 |
| 迁移事务安全 | 迁移与创建子科目在同一事务中，失败时全部回滚 |
