# 咕咕记账 - 技术方案文档 (Tech Spec)

> **版本：v0.4.6**
> **创建日期：2026-03-02**
> **基于版本：v0.4.1（插件配置）**
> **状态：规划中**
> **本版本变更：`book_select` 字段新增 `multi: true` 支持多账本选择；`account_select` 值从字符串扩展为 `{book_id: account_id}` 映射对象；前端 `PluginConfigForm` 渲染分组式多账本配置表单**

---

## 1. 技术架构概述

v0.4.6 是一次围绕插件配置体系的**横向扩展**变更，从后端校验 → Schema 计算 → 前端表单渲染 → 插件端适配全链路修改，使 `book_select` 支持多选。

技术栈不变：

- **前端**：React Native + Expo + TypeScript + Zustand
- **后端**：Python FastAPI + SQLAlchemy (async) + SQLite (aiosqlite)

### 1.1 变更范围

| 层 | 文件 | 变更类型 | 说明 |
|----|------|---------|------|
| **Schema** | `server/app/schemas/plugin.py` | 修改 | `is_configured` 计算逻辑支持多账本模式 |
| **Service** | `server/app/services/plugin_service.py` | 修改 | `update_plugin_config` 校验逻辑扩展：`book_select` 数组校验 + `account_select` 映射对象校验 |
| **前端类型** | `client/services/pluginService.ts` | 修改 | `ConfigField` 新增 `multi?: boolean` |
| **前端组件** | `client/features/plugin/PluginConfigForm.tsx` | 修改 | 核心改动：多账本分组表单渲染 |
| **前端组件** | `client/features/plugin/PluginsPane.tsx` | 修改 | 配置状态展示增加账本数量 |
| **前端页面** | `client/app/settings/plugin-config.tsx` | 修改 | 移动端适配多账本渲染 |
| **插件** | `plugins/longport_monitor/plugin.py` | 修改 | `CONFIG_SCHEMA` 增加 `multi: True`；同步逻辑循环所有账本 |
| **插件** | `plugins/eastmoney_monitor/plugin.py` | 修改 | 同上 |
| **插件** | `plugins/wx_bank_monitor/plugin.py` | 修改 | 同上 |

---

## 2. 数据模型

### 2.1 `plugins` 表 — 无表结构变更

`config_schema` 和 `config` 仍为 `TEXT` 类型字段，存储 JSON 字符串。多账本的格式变化仅体现在 JSON 内容层面。

### 2.2 `config_schema` 扩展

`book_select` 类型字段新增 `multi` 属性：

```json
{
  "key": "target_book",
  "label": "同步账本",
  "type": "book_select",
  "required": true,
  "multi": true
}
```

### 2.3 `config` 值格式

**单账本模式**（`multi` 未设置或 `false`，不变）：

```json
{
  "target_book": "book-uuid-1",
  "securities_account_id": "account-uuid-1"
}
```

**多账本模式**（`multi: true`）：

```json
{
  "target_book": ["book-uuid-1", "book-uuid-2"],
  "securities_account_id": {
    "book-uuid-1": "account-uuid-A",
    "book-uuid-2": "account-uuid-B"
  }
}
```

---

## 3. Schema 实现

### 3.1 `PluginResponse.parse_json_fields` — `is_configured` 计算扩展

**文件：`server/app/schemas/plugin.py`**

当前代码（L86-96）：

```python
is_configured = False
if has_config and parsed_config:
    required_keys = [
        f["key"]
        for f in parsed_schema.get("fields", [])
        if f.get("required")
    ]
    is_configured = all(
        parsed_config.get(k) not in (None, "")
        for k in required_keys
    )
```

变更后：

```python
is_configured = False
if has_config and parsed_config:
    fields = parsed_schema.get("fields", [])
    field_map = {f["key"]: f for f in fields}
    required_keys = [
        f["key"] for f in fields if f.get("required")
    ]

    def _is_filled(key: str) -> bool:
        val = parsed_config.get(key)
        if val is None or val == "":
            return False
        f_def = field_map.get(key, {})
        f_type = f_def.get("type")
        # 多账本 book_select：值为 list，不能为空
        if f_type == "book_select" and f_def.get("multi"):
            return isinstance(val, list) and len(val) > 0
        # 多账本 account_select：值为 dict，每个已选 book 都要有值
        if f_type == "account_select":
            dep_key = f_def.get("depends_on")
            dep_field = field_map.get(dep_key, {})
            if dep_field.get("type") == "book_select" and dep_field.get("multi"):
                if not isinstance(val, dict):
                    return False
                book_ids = parsed_config.get(dep_key, [])
                if not isinstance(book_ids, list):
                    return False
                return all(val.get(bid) not in (None, "") for bid in book_ids)
        return True

    is_configured = all(_is_filled(k) for k in required_keys)
```

### 3.2 `PluginListResponse.compute_config_status` — 同步变更

**文件：`server/app/schemas/plugin.py`**

`PluginListResponse` 的 `compute_config_status`（L141-182）中 `is_configured` 计算逻辑与 `PluginResponse` 保持一致，提取公共函数：

```python
def _compute_is_configured(parsed_schema: dict | None, parsed_config: dict | None) -> bool:
    """计算插件是否已完成配置（支持多账本模式）"""
    if not parsed_schema or not parsed_config:
        return False
    fields = parsed_schema.get("fields", [])
    field_map = {f["key"]: f for f in fields}
    required_keys = [f["key"] for f in fields if f.get("required")]

    def _is_filled(key: str) -> bool:
        val = parsed_config.get(key)
        if val is None or val == "":
            return False
        f_def = field_map.get(key, {})
        f_type = f_def.get("type")
        if f_type == "book_select" and f_def.get("multi"):
            return isinstance(val, list) and len(val) > 0
        if f_type == "account_select":
            dep_key = f_def.get("depends_on")
            dep_field = field_map.get(dep_key, {})
            if dep_field.get("type") == "book_select" and dep_field.get("multi"):
                if not isinstance(val, dict):
                    return False
                book_ids = parsed_config.get(dep_key, [])
                if not isinstance(book_ids, list):
                    return False
                return all(val.get(bid) not in (None, "") for bid in book_ids)
        return True

    return all(_is_filled(k) for k in required_keys)
```

`PluginResponse.parse_json_fields` 和 `PluginListResponse.compute_config_status` 中统一调用：

```python
is_configured = _compute_is_configured(parsed_schema, parsed_config)
```

### 3.3 `PluginListResponse` — 新增 `book_count` 字段

列表响应新增 `book_count` 字段，方便前端展示「已配置 · N 个账本」：

```python
class PluginListResponse(BaseModel):
    # ... 现有字段 ...
    has_config: bool = False
    is_configured: bool = False
    book_count: int = 0       # ← 新增：多账本模式下已配置的账本数量
```

计算逻辑（在 `compute_config_status` 中）：

```python
book_count = 0
if isinstance(parsed_schema, dict) and isinstance(parsed_config, dict):
    for f in parsed_schema.get("fields", []):
        if f.get("type") == "book_select" and f.get("multi"):
            val = parsed_config.get(f["key"])
            if isinstance(val, list):
                book_count = len(val)
            break
```

---

## 4. Service 层实现

### 4.1 `update_plugin_config` — 校验逻辑扩展

**文件：`server/app/services/plugin_service.py`**

当前 `book_select` 校验（L161-180）：

```python
if field_type == "book_select":
    # 校验用户有权访问该账本
    from app.models.book import Book, BookMember
    book_result = await db.execute(
        select(Book).where(Book.id == value)
    )
    book = book_result.scalar_one_or_none()
    if not book:
        errors.append({"key": key, "error": f"账本 {value} 不存在"})
        continue
    if book.owner_id != user_id:
        member_result = await db.execute(
            select(BookMember).where(
                BookMember.book_id == value,
                BookMember.user_id == user_id,
            )
        )
        if not member_result.scalar_one_or_none():
            errors.append({"key": key, "error": f"无权访问账本 {value}"})
            continue
```

变更后：

```python
if field_type == "book_select":
    from app.models.book import Book, BookMember
    is_multi = field_def.get("multi", False)

    if is_multi:
        # ── 多账本模式 ──
        if not isinstance(value, list):
            errors.append({"key": key, "error": "多账本模式下值必须为数组"})
            continue
        if required and len(value) == 0:
            errors.append({"key": key, "error": "至少选择一个账本"})
            continue
        if len(value) != len(set(value)):
            errors.append({"key": key, "error": "账本不可重复"})
            continue
        # 逐一校验每个 book_id
        for book_id in value:
            book_result = await db.execute(
                select(Book).where(Book.id == book_id)
            )
            book = book_result.scalar_one_or_none()
            if not book:
                errors.append({"key": key, "error": f"账本 {book_id} 不存在"})
                continue
            if book.owner_id != user_id:
                member_result = await db.execute(
                    select(BookMember).where(
                        BookMember.book_id == book_id,
                        BookMember.user_id == user_id,
                    )
                )
                if not member_result.scalar_one_or_none():
                    errors.append({"key": key, "error": f"无权访问账本 {book_id}"})
    else:
        # ── 单账本模式（不变） ──
        book_result = await db.execute(
            select(Book).where(Book.id == value)
        )
        book = book_result.scalar_one_or_none()
        if not book:
            errors.append({"key": key, "error": f"账本 {value} 不存在"})
            continue
        if book.owner_id != user_id:
            member_result = await db.execute(
                select(BookMember).where(
                    BookMember.book_id == value,
                    BookMember.user_id == user_id,
                )
            )
            if not member_result.scalar_one_or_none():
                errors.append({"key": key, "error": f"无权访问账本 {value}"})
                continue
```

当前 `account_select` 校验（L181-204）：

```python
if field_type == "account_select":
    depends_on = field_def.get("depends_on")
    if not depends_on or depends_on not in field_map:
        errors.append({"key": key, "error": "account_select 必须配置 depends_on 指向一个 book_select 字段"})
        continue
    dep_field = field_map[depends_on]
    if dep_field["type"] != "book_select":
        errors.append({"key": key, "error": f"depends_on 指向的字段 '{depends_on}' 不是 book_select 类型"})
        continue
    ref_book_id = config.get(depends_on)
    if not ref_book_id:
        errors.append({"key": key, "error": f"请先选择「{dep_field.get('label', depends_on)}」"})
        continue
    from app.models.account import Account
    result = await db.execute(
        select(Account).where(
            Account.id == value,
            Account.book_id == ref_book_id,
        )
    )
    if not result.scalar_one_or_none():
        errors.append({"key": key, "error": f"科目 {value} 不存在或不属于所选账本"})
        continue
```

变更后：

```python
if field_type == "account_select":
    depends_on = field_def.get("depends_on")
    if not depends_on or depends_on not in field_map:
        errors.append({"key": key, "error": "account_select 必须配置 depends_on 指向一个 book_select 字段"})
        continue
    dep_field = field_map[depends_on]
    if dep_field["type"] != "book_select":
        errors.append({"key": key, "error": f"depends_on 指向的字段 '{depends_on}' 不是 book_select 类型"})
        continue

    is_multi = dep_field.get("multi", False)
    from app.models.account import Account

    if is_multi:
        # ── 多账本模式：value 为 {book_id: account_id} 映射 ──
        if not isinstance(value, dict):
            errors.append({"key": key, "error": "多账本模式下科目配置必须为对象"})
            continue
        book_ids = config.get(depends_on, [])
        if not isinstance(book_ids, list):
            book_ids = []
        # 必填时，每个已选 book 都要有对应科目
        if required:
            missing = [bid for bid in book_ids if value.get(bid) in (None, "")]
            if missing:
                errors.append({"key": key, "error": f"以下账本的科目未配置: {missing}"})
                continue
        # 逐一校验每个 account_id 归属
        for book_id, account_id in value.items():
            if book_id not in book_ids:
                continue  # 忽略多余的 key
            if account_id in (None, ""):
                continue  # 非必填时允许空
            result = await db.execute(
                select(Account).where(
                    Account.id == account_id,
                    Account.book_id == book_id,
                )
            )
            if not result.scalar_one_or_none():
                errors.append({"key": key, "error": f"科目 {account_id} 不存在或不属于账本 {book_id}"})
        # 过滤 value：只保留 book_ids 中存在的 key
        filtered_value = {bid: value[bid] for bid in book_ids if bid in value and value[bid] not in (None, "")}
        filtered_config[key] = filtered_value
        continue
    else:
        # ── 单账本模式（不变） ──
        ref_book_id = config.get(depends_on)
        if not ref_book_id:
            errors.append({"key": key, "error": f"请先选择「{dep_field.get('label', depends_on)}」"})
            continue
        result = await db.execute(
            select(Account).where(
                Account.id == value,
                Account.book_id == ref_book_id,
            )
        )
        if not result.scalar_one_or_none():
            errors.append({"key": key, "error": f"科目 {value} 不存在或不属于所选账本"})
            continue
```

> **注意**：多账本 `account_select` 校验后直接 `continue`，因为 `filtered_config[key]` 已在分支内赋值（过滤后的映射对象）。单账本模式走原有的 `filtered_config[key] = value`（L206）。

---

## 5. 前端实现

### 5.1 `pluginService.ts` — 类型扩展

**文件：`client/services/pluginService.ts`**

当前代码（L3-12）：

```typescript
export type ConfigField = {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'book_select' | 'account_select' | 'secret';
  required?: boolean;
  default?: any;
  description?: string;
  options?: { label: string; value: string }[];
  depends_on?: string;
};
```

变更后：

```typescript
export type ConfigField = {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select' | 'book_select' | 'account_select' | 'secret';
  required?: boolean;
  default?: any;
  description?: string;
  options?: { label: string; value: string }[];
  depends_on?: string;
  multi?: boolean;           // ← 新增：book_select 多选模式
};
```

`PluginResponse` 类型新增 `book_count`：

```typescript
export type PluginResponse = {
  // ... 现有字段 ...
  has_config: boolean;
  is_configured: boolean;
  book_count: number;        // ← 新增：多账本数量
};
```

### 5.2 `PluginConfigForm.tsx` — 核心改造

**文件：`client/features/plugin/PluginConfigForm.tsx`**

#### 5.2.1 Props 扩展

当前 `PickerRequest` 类型不变，但 `pickedAccount` 回调需支持多账本场景下的 `bookId` 关联：

```typescript
export type PickerRequest = {
  fieldKey: string;
  bookId: string;
  selectedId?: string;
} | null;
```

不变。但使用时 `bookId` 在多账本模式下来自分组的 `book_id`，而非 `formData[depends_on]`。

#### 5.2.2 formData 初始化扩展

当前代码（L46-52）：

```typescript
const [formData, setFormData] = useState<Record<string, any>>(() => {
  const initial: Record<string, any> = {};
  for (const field of schema.fields) {
    initial[field.key] = config?.[field.key] ?? field.default ?? (field.type === 'boolean' ? false : null);
  }
  return initial;
});
```

变更后：

```typescript
const [formData, setFormData] = useState<Record<string, any>>(() => {
  const initial: Record<string, any> = {};
  for (const field of schema.fields) {
    const configVal = config?.[field.key];
    if (field.type === 'book_select' && field.multi) {
      // 多账本：确保值为数组
      initial[field.key] = Array.isArray(configVal) ? configVal : [];
    } else if (field.type === 'account_select') {
      // 检查 depends_on 指向的 book_select 是否 multi
      const depField = schema.fields.find(f => f.key === field.depends_on);
      if (depField?.type === 'book_select' && depField.multi) {
        // 多账本 account_select：确保值为对象
        initial[field.key] = (configVal && typeof configVal === 'object' && !Array.isArray(configVal))
          ? configVal : {};
      } else {
        initial[field.key] = configVal ?? field.default ?? null;
      }
    } else {
      initial[field.key] = configVal ?? field.default ?? (field.type === 'boolean' ? false : null);
    }
  }
  return initial;
});
```

#### 5.2.3 多账本字段识别

新增 memo 计算哪些字段处于多账本模式：

```typescript
// 识别 multi book_select 字段及其依赖的 account_select 字段
const multiBookField = React.useMemo(() => {
  return schema.fields.find(f => f.type === 'book_select' && f.multi) ?? null;
}, [schema]);

const multiAccountFields = React.useMemo(() => {
  if (!multiBookField) return [];
  return schema.fields.filter(
    f => f.type === 'account_select' && f.depends_on === multiBookField.key
  );
}, [schema, multiBookField]);

// 非分组字段：不属于 multi book_select 也不属于其依赖的 account_select
const nonGroupFields = React.useMemo(() => {
  if (!multiBookField) return schema.fields;
  const groupKeys = new Set([multiBookField.key, ...multiAccountFields.map(f => f.key)]);
  return schema.fields.filter(f => !groupKeys.has(f.key));
}, [schema, multiBookField, multiAccountFields]);
```

#### 5.2.4 多账本操作函数

```typescript
// ── 添加账本分组 ──
const [showBookPicker, setShowBookPicker] = useState(false);

const addBook = (bookId: string) => {
  if (!multiBookField) return;
  setFormData(prev => {
    const bookIds = [...(prev[multiBookField.key] || []), bookId];
    const next = { ...prev, [multiBookField.key]: bookIds };
    // 为每个 account_select 字段在映射对象中初始化空值
    for (const af of multiAccountFields) {
      const map = { ...(prev[af.key] || {}) };
      map[bookId] = null;
      next[af.key] = map;
    }
    return next;
  });
  setShowBookPicker(false);
};

// ── 删除账本分组 ──
const removeBook = (bookId: string) => {
  if (!multiBookField) return;
  setFormData(prev => {
    const bookIds = (prev[multiBookField.key] || []).filter((id: string) => id !== bookId);
    const next = { ...prev, [multiBookField.key]: bookIds };
    // 从每个 account_select 映射中删除对应 key
    for (const af of multiAccountFields) {
      const map = { ...(prev[af.key] || {}) };
      delete map[bookId];
      next[af.key] = map;
    }
    return next;
  });
};

// ── 更新分组内的 account_select ──
const updateAccountInGroup = (fieldKey: string, bookId: string, accountId: string) => {
  setFormData(prev => ({
    ...prev,
    [fieldKey]: { ...(prev[fieldKey] || {}), [bookId]: accountId },
  }));
};
```

#### 5.2.5 canSave 扩展

当前代码（L101-107）：

```typescript
const canSave = schema.fields
  .filter((f) => f.required)
  .every((f) => {
    const val = formData[f.key];
    if (f.type === 'boolean') return true;
    return val !== null && val !== undefined && val !== '';
  });
```

变更后：

```typescript
const canSave = schema.fields
  .filter((f) => f.required)
  .every((f) => {
    const val = formData[f.key];
    if (f.type === 'boolean') return true;

    // 多账本 book_select：数组非空
    if (f.type === 'book_select' && f.multi) {
      return Array.isArray(val) && val.length > 0;
    }

    // 多账本 account_select：每个已选 book 都有值
    if (f.type === 'account_select' && multiBookField && f.depends_on === multiBookField.key) {
      if (!val || typeof val !== 'object') return false;
      const bookIds: string[] = formData[multiBookField.key] || [];
      return bookIds.every(bid => val[bid] != null && val[bid] !== '');
    }

    return val !== null && val !== undefined && val !== '';
  });
```

#### 5.2.6 渲染结构变更

当前渲染逻辑（L272-289）遍历 `schema.fields` 逐个 `renderField`。变更后拆分为两个区域：

```tsx
return (
  <View style={[s.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
    <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>

      {/* ── 多账本分组区域 ── */}
      {multiBookField && (
        <View style={s.fieldWrap}>
          <View style={s.labelRow}>
            <Text style={[s.label, { color: colors.text }]}>
              {multiBookField.label}
              {multiBookField.required && <Text style={{ color: '#EF4444' }}> *</Text>}
            </Text>
          </View>
          {multiBookField.description && (
            <Text style={[s.desc, { color: colors.textSecondary }]}>{multiBookField.description}</Text>
          )}

          {/* 已选账本分组卡片 */}
          {(formData[multiBookField.key] || []).map((bookId: string) => {
            const book = books.find(b => b.id === bookId);
            const isLast = multiBookField.required && (formData[multiBookField.key] || []).length === 1;
            return (
              <View key={bookId} style={[s.groupCard, { borderColor: colors.border }]}>
                {/* 分组头：账本名 + 删除按钮 */}
                <View style={s.groupHeader}>
                  <Text style={[s.groupTitle, { color: colors.text }]}>
                    📖 {book?.name || bookId}
                  </Text>
                  {!isLast && (
                    <Pressable onPress={() => removeBook(bookId)}>
                      <Text style={{ color: colors.textSecondary, fontSize: 16 }}>✕</Text>
                    </Pressable>
                  )}
                </View>

                {/* 分组内的 account_select 字段 */}
                {multiAccountFields.map(af => (
                  <View key={af.key} style={s.fieldWrap}>
                    <View style={s.labelRow}>
                      <Text style={[s.label, { color: colors.text }]}>
                        {af.label}
                        {af.required && <Text style={{ color: '#EF4444' }}> *</Text>}
                      </Text>
                    </View>
                    <Pressable
                      style={[s.input, { borderColor: colors.border, backgroundColor: colors.background, justifyContent: 'center' }]}
                      onPress={() => {
                        const currentVal = (formData[af.key] || {})[bookId];
                        onPickerRequest?.({
                          fieldKey: `${af.key}__${bookId}`,  // 组合 key，父组件拆分
                          bookId,
                          selectedId: currentVal ?? undefined,
                        });
                      }}
                    >
                      <Text style={{ color: (formData[af.key] || {})[bookId] ? colors.text : colors.textSecondary, fontSize: 14 }}>
                        {(formData[af.key] || {})[bookId]
                          ? findAccountName((formData[af.key] || {})[bookId])
                          : `选择${af.label}`
                        }
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            );
          })}

          {/* 添加账本按钮 + 内联选择器 */}
          <Pressable onPress={() => setShowBookPicker(!showBookPicker)}>
            <Text style={{ color: Colors.primary, fontSize: 14, fontWeight: '500' }}>+ 添加账本</Text>
          </Pressable>
          {showBookPicker && (
            <View style={s.selectWrap}>
              {books
                .filter(b => !(formData[multiBookField.key] || []).includes(b.id))
                .map(book => (
                  <Pressable
                    key={book.id}
                    style={[s.selectOption, { borderColor: colors.border }]}
                    onPress={() => addBook(book.id)}
                  >
                    <Text style={{ fontSize: 13, color: colors.text }}>{book.name}</Text>
                  </Pressable>
                ))
              }
            </View>
          )}
        </View>
      )}

      {/* ── 非分组字段（与现有逻辑一致） ── */}
      {nonGroupFields.map((field) => (
        <View key={field.key} style={s.fieldWrap}>
          <View style={s.labelRow}>
            <Text style={[s.label, { color: colors.text }]}>
              {field.label}
              {field.required && <Text style={{ color: '#EF4444' }}> *</Text>}
            </Text>
          </View>
          {field.description && field.type !== 'string' && field.type !== 'number' && field.type !== 'secret' && (
            <Text style={[s.desc, { color: colors.textSecondary }]}>{field.description}</Text>
          )}
          {renderField(field)}
        </View>
      ))}
    </ScrollView>

    {/* Footer 不变 */}
    <View style={[s.footer, { borderTopColor: colors.border }]}>
      {/* ... */}
    </View>
  </View>
);
```

#### 5.2.7 pickedAccount 回调适配

多账本模式下 `fieldKey` 使用组合 key `${af.key}__${bookId}`，需在 `useEffect` 中拆分：

当前代码（L69-75）：

```typescript
useEffect(() => {
  if (pickedAccount) {
    const { fieldKey, account } = pickedAccount;
    setFormData((prev) => ({ ...prev, [fieldKey]: account.id }));
    setAccountNames((prev) => ({ ...prev, [account.id]: account.name }));
  }
}, [pickedAccount]);
```

变更后：

```typescript
useEffect(() => {
  if (pickedAccount) {
    const { fieldKey, account } = pickedAccount;
    // 检查是否是多账本模式的组合 key
    if (fieldKey.includes('__')) {
      const [actualKey, bookId] = fieldKey.split('__');
      setFormData(prev => ({
        ...prev,
        [actualKey]: { ...(prev[actualKey] || {}), [bookId]: account.id },
      }));
    } else {
      setFormData(prev => ({ ...prev, [fieldKey]: account.id }));
    }
    setAccountNames(prev => ({ ...prev, [account.id]: account.name }));
  }
}, [pickedAccount]);
```

#### 5.2.8 新增样式

```typescript
const s = StyleSheet.create({
  // ... 现有样式 ...
  groupCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  groupTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
});
```

### 5.3 `PluginsPane.tsx` — 配置状态展示

**文件：`client/features/plugin/PluginsPane.tsx`**

当前代码（L158-165）：

```tsx
{plugin.has_config && (
  <View style={[ps.configBadge, { backgroundColor: plugin.is_configured ? '#10B98115' : '#F59E0B15' }]}>
    <View style={[ps.configDot, { backgroundColor: plugin.is_configured ? '#10B981' : '#F59E0B' }]} />
    <Text style={{ fontSize: 11, fontWeight: '600', color: plugin.is_configured ? '#10B981' : '#F59E0B' }}>
      {plugin.is_configured ? '已配置' : '待配置'}
    </Text>
  </View>
)}
```

变更后：

```tsx
{plugin.has_config && (
  <View style={[ps.configBadge, { backgroundColor: plugin.is_configured ? '#10B98115' : '#F59E0B15' }]}>
    <View style={[ps.configDot, { backgroundColor: plugin.is_configured ? '#10B981' : '#F59E0B' }]} />
    <Text style={{ fontSize: 11, fontWeight: '600', color: plugin.is_configured ? '#10B981' : '#F59E0B' }}>
      {plugin.is_configured
        ? (plugin.book_count > 1 ? `已配置 · ${plugin.book_count} 个账本` : '已配置')
        : '待配置'
      }
    </Text>
  </View>
)}
```

### 5.4 `plugin-config.tsx` — 移动端适配

**文件：`client/app/settings/plugin-config.tsx`**

移动端配置页面直接复用 `PluginConfigForm`，核心渲染逻辑在 `PluginConfigForm` 内部已处理多账本模式，此文件无需大幅改动。

唯一需要适配的是 `handlePickerSelect` 中的组合 key 拆分，但该逻辑已在 `PluginConfigForm` 的 `useEffect(pickedAccount)` 中处理，对父组件透明。

---

## 6. 插件端适配

### 6.1 `CONFIG_SCHEMA` 升级

**文件：`plugins/longport_monitor/plugin.py`**

当前代码（L39-47）：

```python
CONFIG_SCHEMA = {
    "fields": [
        {
            "key": "target_book",
            "label": "同步账本",
            "type": "book_select",
            "required": True,
            "description": "选择需要同步的目标账本",
        },
```

变更后：

```python
CONFIG_SCHEMA = {
    "fields": [
        {
            "key": "target_book",
            "label": "同步账本",
            "type": "book_select",
            "required": True,
            "multi": True,
            "description": "选择需要同步的账本（支持多选）",
        },
```

`eastmoney_monitor` 和 `wx_bank_monitor` 同理，均在 `target_book` 字段中添加 `"multi": True`。

### 6.2 同步逻辑改造（以 longport_monitor 为例）

当前模式（单账本）：

```python
config = plugin_info["config"]
book_id = config["target_book"]
account_id = config["securities_account_id"]

# 获取数据
positions = await fetch_positions()

# 推送到单个账本
entries = build_entries(account_id, positions)
await api.post(f"/plugins/{plugin_id}/entries/batch", {
    "book_id": book_id,
    "entries": entries,
})
```

变更后（多账本）：

```python
config = plugin_info["config"]
book_ids = config["target_book"]            # list[str]
account_map = config["securities_account_id"]  # dict[str, str]

# 获取数据（只拉取一次）
positions = await fetch_positions()

# 推送到每个账本
for book_id in book_ids:
    account_id = account_map[book_id]
    entries = build_entries(account_id, positions)
    await api.post(f"/plugins/{plugin_id}/entries/batch", {
        "book_id": book_id,
        "entries": entries,
    })
```

> 数据只拉取一次，分发到多个账本。`external_id` 在各账本内独立去重。

### 6.3 wx_bank_monitor 多 account_select 示例

`wx_bank_monitor` 有 3 个 `account_select` 字段（`deposit_account_id`、`default_expense_id`、`default_income_id`），多账本模式下每个都变为映射对象：

```python
config = plugin_info["config"]
book_ids = config["target_book"]
deposit_map = config["deposit_account_id"]
expense_map = config["default_expense_id"]
income_map = config["default_income_id"]

for book_id in book_ids:
    deposit_id = deposit_map[book_id]
    expense_id = expense_map[book_id]
    income_id = income_map[book_id]
    entries = build_bank_entries(deposit_id, expense_id, income_id, transactions)
    await api.post(f"/plugins/{plugin_id}/entries/batch", {
        "book_id": book_id,
        "entries": entries,
    })
```

---

## 7. 开发实施计划

### 阶段 1：后端 Schema & Service（预计 0.5 天）

1. `schemas/plugin.py` 提取公共函数 `_compute_is_configured`，支持多账本 `book_select` + `account_select` 判定
2. `schemas/plugin.py` `PluginListResponse` 新增 `book_count` 字段及计算逻辑
3. `plugin_service.py` `update_plugin_config` 扩展 `book_select` 校验（数组类型、去重、逐一权限校验）
4. `plugin_service.py` `update_plugin_config` 扩展 `account_select` 校验（映射对象类型、完整性检查、逐一归属校验）
5. `tests/` 增加测试用例：
   - 多账本 `book_select` 保存 — 正常数组
   - 多账本 `book_select` 保存 — 非数组类型 → 422
   - 多账本 `book_select` 保存 — 空数组（required 时）→ 422
   - 多账本 `book_select` 保存 — 重复 book_id → 422
   - 多账本 `book_select` — 逐一权限校验（其中一个无权）→ 422
   - 多账本 `book_select` — 不存在的 book_id → 422
   - 多账本 `account_select` 保存 — 正常映射对象
   - 多账本 `account_select` 保存 — 非对象类型 → 422
   - 多账本 `account_select` — 必填时某 book 未配置科目 → 422
   - 多账本 `account_select` — 科目不属于对应账本 → 422
   - 多账本 `account_select` — 多余 key 被过滤
   - `is_configured` 计算 — 多账本全部配置完成 → `true`
   - `is_configured` 计算 — 多账本部分配置 → `false`
   - `book_count` 计算 — 正确返回已选账本数量
   - 单账本模式 — 行为完全不变

### 阶段 2：前端类型扩展（预计 0.5h）

1. `pluginService.ts` `ConfigField` 新增 `multi?: boolean`
2. `pluginService.ts` `PluginResponse` 新增 `book_count: number`

### 阶段 3：前端核心 — PluginConfigForm 改造（预计 0.5 天）

1. `PluginConfigForm.tsx` `formData` 初始化扩展（多账本数组 + 映射对象）
2. `PluginConfigForm.tsx` 新增 `multiBookField` / `multiAccountFields` / `nonGroupFields` memo 计算
3. `PluginConfigForm.tsx` 新增 `addBook` / `removeBook` / `updateAccountInGroup` 操作函数
4. `PluginConfigForm.tsx` `canSave` 逻辑扩展（多账本数组非空 + 映射对象完整性）
5. `PluginConfigForm.tsx` 渲染结构拆分（分组卡片区 + 非分组字段区）
6. `PluginConfigForm.tsx` `pickedAccount` 回调适配（组合 key `${af.key}__${bookId}` 拆分）
7. `PluginConfigForm.tsx` 新增 `groupCard` / `groupHeader` / `groupTitle` 等样式

### 阶段 4：前端适配（预计 0.5h）

1. `PluginsPane.tsx` 配置状态展示增加账本数量（`已配置 · N 个账本`）
2. `plugin-config.tsx` 移动端验证多账本渲染正常

### 阶段 5：插件端适配（预计 0.5 天）

1. `plugins/longport_monitor/plugin.py` `CONFIG_SCHEMA` 增加 `"multi": True`；同步逻辑改为循环所有账本
2. `plugins/eastmoney_monitor/plugin.py` 同上
3. `plugins/wx_bank_monitor/plugin.py` 同上（含 3 个 `account_select` 映射适配）

### 阶段 6：联调 & 测试（预计 0.5 天）

1. 端到端：插件注册（上报 `multi: true` schema）→ 前端渲染多账本表单 → 添加 2 个账本并配置科目 → 保存 → API 返回正确 `config`
2. 端到端：插件读取配置 → 多账本循环推送 → 各账本数据正确
3. 单账本回归：`multi` 未设置的插件行为完全不变
4. 边界验证：添加后删除到仅剩 1 个账本（`required` 时不允许删除最后一个）
5. 桌面端 / 移动端一致性验证

---

### 总体时间估算

| 阶段 | 内容 | 预计工时 | 累计 |
|------|------|---------|------|
| 1 | 后端 Schema & Service | 0.5 天 | 0.5 天 |
| 2 | 前端类型扩展 | 0.5h | ~0.5 天 |
| 3 | 前端核心 PluginConfigForm | 0.5 天 | 1 天 |
| 4 | 前端适配 | 0.5h | ~1 天 |
| 5 | 插件端适配 | 0.5 天 | 1.5 天 |
| 6 | 联调 & 测试 | 0.5 天 | 2 天 |

> v0.4.6 总计约 **2 个工作日**。

### 实施顺序 & 依赖

```
阶段 1 (后端) ──→ 阶段 5 (插件端)
     ↓
阶段 2 (前端类型) → 阶段 3 (前端核心) → 阶段 4 (前端适配)
                                              ↓
                                        阶段 6 (联调)
```

- 阶段 1、2 可并行
- 阶段 3 依赖阶段 2
- 阶段 5 依赖阶段 1
- 阶段 6 依赖所有阶段完成

---

## 8. 依赖变更

### 8.1 后端

无新增依赖。复用现有 `FastAPI` + `SQLAlchemy` + `aiosqlite`。

### 8.2 前端

无新增依赖。复用现有 `pluginService.ts` + `PluginConfigForm.tsx` 组件体系。

---

## 9. 测试要点

### 9.1 后端 — 多账本校验测试

| 测试用例 | 预期结果 |
|---------|---------|
| `book_select` multi — 正常数组 | config 正确存储 |
| `book_select` multi — 值为字符串 | 422：多账本模式下值必须为数组 |
| `book_select` multi — 空数组（required） | 422：至少选择一个账本 |
| `book_select` multi — 重复 book_id | 422：账本不可重复 |
| `book_select` multi — 不存在的 book_id | 422：账本 xxx 不存在 |
| `book_select` multi — 无权访问的 book_id | 422：无权访问账本 xxx |
| `account_select` 映射 — 正常对象 | config 正确存储 |
| `account_select` 映射 — 值为字符串 | 422：多账本模式下科目配置必须为对象 |
| `account_select` 映射 — 必填但某 book 未配置 | 422：以下账本的科目未配置 |
| `account_select` 映射 — 科目不属于对应账本 | 422：科目 xxx 不存在或不属于账本 xxx |
| `account_select` 映射 — 多余 key | 自动过滤，不报错 |
| 单账本 `book_select` — 值为字符串 | 行为不变，正常校验 |
| 单账本 `account_select` — 值为字符串 | 行为不变，正常校验 |

### 9.2 后端 — Schema 计算测试

| 测试用例 | 预期结果 |
|---------|---------|
| `is_configured` — 多账本全部配置完成 | `true` |
| `is_configured` — 多账本只选了 book 未配 account | `false` |
| `is_configured` — 多账本部分 book 的 account 为空 | `false` |
| `is_configured` — 单账本正常配置 | `true`（不变） |
| `is_configured` — 单账本缺必填字段 | `false`（不变） |
| `book_count` — 多账本选 3 个 | `book_count = 3` |
| `book_count` — 单账本模式 | `book_count = 0` |
| `book_count` — 无 config | `book_count = 0` |

### 9.3 前端 — 多账本表单测试

| 测试用例 | 预期结果 |
|---------|---------|
| `multi: true` 表单渲染 | 显示分组卡片 + 「+ 添加账本」按钮 |
| 添加账本 | 点击「+ 添加账本」→ 内联展开可选列表 → 选择后创建分组卡片 |
| 已选账本过滤 | 可选列表中不显示已添加的账本 |
| 删除账本分组 | 点击 ✕ → 移除分组 + 清除对应科目映射 |
| 最后一个账本（required） | 不显示 ✕ 按钮，不可删除 |
| 分组内科目选择 | 点击科目字段 → 弹出科目选择器（bookId 为当前分组的 book） |
| 科目选择回调 | 组合 key `${af.key}__${bookId}` 正确拆分并更新 formData |
| canSave — 全部配置完成 | 保存按钮可用 |
| canSave — 部分 book 科目为空 | 保存按钮禁用 |
| canSave — 未添加任何账本（required） | 保存按钮禁用 |
| 配置状态展示 | 已配置时展示「已配置 · N 个账本」 |
| `multi` 未设置的插件 | 渲染单选模式，行为完全不变 |
| 桌面端 / 移动端一致性 | `PluginConfigForm` 在两端渲染结果一致 |

### 9.4 插件端测试

| 测试用例 | 预期结果 |
|---------|---------|
| 插件注册上报 `multi: true` schema | `config_schema` 正确存储 |
| 插件读取多账本 config | `target_book` 为数组，`account_select` 为映射对象 |
| 插件循环推送多账本 | 每个账本分别创建正确的分录 |
| `external_id` 跨账本不冲突 | 同一 `external_id` 在不同账本中独立去重 |
| `wx_bank_monitor` 多 account_select | 3 个映射对象均正确读取 |

---

## 10. 安全考量

| 风险 | 缓解措施 |
|------|---------|
| 多账本越权 | `update_plugin_config` 逐一校验每个 `book_id` 的访问权限 |
| `account_select` 科目越权 | 逐一校验每个 `account_id` 是否属于对应 `book_id` |
| `account_select` 映射 key 注入 | 校验后只保留 `book_ids` 中存在的 key，多余 key 被过滤 |
| 大量账本导致性能问题 | 实际场景 2-3 个账本为主；逐一校验的 DB 查询量可控 |
