# v0.4.4 — "我的"页菜单分组与二级折叠

> **版本：v0.4.4**
> **创建日期：2026-02-28**
> **基于版本：v0.4.3**
> **状态：规划中**
> **本版本变更：重组"我的"页菜单结构，将低频高级功能收入可折叠的"高级"二级菜单，降低认知负担**

---

## 1. 背景

### 1.1 菜单项过多，认知负担重

当前"我的"页主菜单区包含 11 个菜单项（含"即将推出"的外部账户），一屏罗列导致：

- 用户需要逐项扫描才能找到目标功能
- 高频操作（编辑个人信息、账本设置、固定资产、贷款管理、预算设置）与低频操作（科目管理、API Key、插件、MCP）混排，无层次感
- 随着功能增加，菜单会越来越长，不可持续

### 1.2 高级功能使用频率低

以下功能面向高级用户或开发者，普通用户几乎不会使用：

| 功能 | 面向用户 | 使用频率 |
|------|---------|---------|
| 科目管理 | 高级用户 | 低（初始设置后很少变动） |
| API Key 管理 | 开发者/自动化用户 | 极低 |
| 插件管理 | 开发者 | 极低 |
| MCP 服务 | 开发者 | 极低 |

将这些功能收入"高级"折叠菜单，既保留可达性，又减少普通用户的视觉干扰。

## 2. 目标

| 能力 | 说明 |
|------|------|
| 菜单分组 | 将 11 个菜单项按使用频率分为"常用"和"高级"两组 |
| 折叠展开 | "高级"组默认折叠，点击展开/收起 |
| 交互一致 | 折叠/展开动画流畅，桌面端和移动端行为一致 |
| 无路由变更 | 不新增路由，不改变 DetailPane 类型，仅调整菜单 UI 层 |

## 3. 功能设计

### 3.1 菜单分组方案

重组后的菜单结构如下：

```
┌──────────────────────────────────┐
│  [头像]  用户名                   │
│          email@example.com       │
├──────────────────────────────────┤
│  ✎  编辑个人信息            >    │
│  📖 账本设置                >    │
│  🏢 固定资产                >    │
│  💳 贷款管理                >    │
│  📊 预算设置                >    │
│  📥 数据导入/导出           >    │
│  🏦 外部账户        即将推出 >    │
│                                  │
│  ⚙  高级                   ∨    │  ← 折叠控制行
│  ┌────────────────────────────┐  │
│  │  📋 科目管理          >   │  │
│  │  🔑 API Key 管理      >   │  │
│  │  🧩 插件管理          >   │  │
│  │  🔌 MCP 服务          >   │  │
│  └────────────────────────────┘  │
├──────────────────────────────────┤
│  ⚙  设置                   >    │
│  ℹ  关于                   >    │
├──────────────────────────────────┤
│  🚪 退出登录               >    │
└──────────────────────────────────┘
```

### 3.2 分组规则

**常用区**（直接展示）：

| 序号 | 图标 | 标签 | DetailPane | 移动端路由 |
|------|------|------|-----------|-----------|
| 1 | `pencil` | 编辑个人信息 | `edit-profile` | `/profile/edit` |
| 2 | `book` | 账本设置 | `book-settings` | `/settings/book` |
| 3 | `building` | 固定资产 | `assets` | `/assets` |
| 4 | `credit-card` | 贷款管理 | `loans` | `/loans` |
| 5 | `pie-chart` | 预算设置 | `budget` | `/settings/budget` |
| 6 | `download` | 数据导入/导出 | `data-import` | `/settings/data-import` |
| 7 | `bank` | 外部账户 | *(无)* | *(无)* — `hint="即将推出"` |

**高级区**（折叠在"高级"菜单内）：

| 序号 | 图标 | 标签 | DetailPane | 移动端路由 |
|------|------|------|-----------|-----------|
| 1 | `list-alt` | 科目管理 | `accounts` | `/accounts` |
| 2 | `key` | API Key 管理 | `api-keys` | `/settings/api-keys` |
| 3 | `puzzle-piece` | 插件管理 | `plugins` | `/settings/plugins` |
| 4 | `microchip` | MCP 服务 | `mcp` | `/settings/mcp` |

### 3.3 折叠交互

| 项目 | 说明 |
|------|------|
| 默认状态 | 折叠（高级区隐藏） |
| 触发方式 | 点击"高级"行 |
| 展开/收起图标 | 展开时 `caret-down`，收起时 `caret-right` |
| 动画 | 使用 `LayoutAnimation` 实现高度过渡，时长 200ms |
| 状态持久化 | 不持久化，每次进入页面默认折叠 |
| "高级"行样式 | 与普通 MenuItem 一致，但不显示右侧 `chevron-right`，改为 caret 图标表示折叠状态 |
| "高级"行图标颜色 | 使用 `Colors.neutral`（与"设置""关于"一致） |

### 3.4 高级区子项缩进

高级区展开后，子菜单项需有视觉层级区分：

| 属性 | 值 | 说明 |
|------|-----|------|
| 左侧缩进 | `paddingLeft: 16` | 相对于父级菜单额外缩进 |
| 背景色 | 与所在 section 相同 | 不做额外背景区分 |
| 分隔线 | 无 | 子项之间不加分隔线，与当前 MenuItem 行为一致 |

## 4. 涉及文件

| 文件 | 改动说明 |
|------|---------|
| `features/profile/MenuItem.tsx` | 新增 `indent` prop 支持缩进 |
| `app/(tabs)/profile.tsx` | 重组菜单项顺序，新增"高级"折叠行和展开状态 |

## 5. 不涉及

- 不新增路由页面
- 不新增 DetailPane 类型
- 不改动 Sidebar 全局导航栏
- 不改动任何 Pane 组件或 Service 层
- 不影响 `useProfileNavStore` 跨 Tab 导航逻辑

## 6. 技术方案

### 6.1 折叠状态管理

在 `profile.tsx` 中新增 `useState`：

```typescript
const [advancedExpanded, setAdvancedExpanded] = useState(false);
```

### 6.2 "高级"折叠行

使用 `MenuItem` 组件的扩展或独立 `Pressable` 实现：

```typescript
<Pressable style={styles.menuItem} onPress={() => {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  setAdvancedExpanded(!advancedExpanded);
}}>
  <FontAwesome name="cogs" size={18} color={Colors.neutral} style={styles.menuIcon} />
  <Text style={styles.menuLabel}>高级</Text>
  <FontAwesome
    name={advancedExpanded ? 'caret-down' : 'caret-right'}
    size={14}
    color={colors.textSecondary}
  />
</Pressable>
{advancedExpanded && (
  <>
    <MenuItem icon="list-alt" label="科目管理" indent onPress={...} />
    <MenuItem icon="key" label="API Key 管理" indent onPress={...} />
    <MenuItem icon="puzzle-piece" label="插件管理" indent onPress={...} />
    <MenuItem icon="microchip" label="MCP 服务" indent onPress={...} />
  </>
)}
```

### 6.3 MenuItem 增加 indent 支持

```typescript
type MenuItemProps = {
  icon: ...;
  label: string;
  hint?: string;
  color?: string;
  indent?: boolean;  // 新增
  onPress?: () => void;
};

// 在根 Pressable 的 style 中：
style={[styles.menuItem, indent && { paddingLeft: styles.menuItem.paddingHorizontal + 16 }]}
```

## 7. 验收标准

| 编号 | 项目 | 验收条件 |
|------|------|---------|
| QR-1 | 菜单分组 | 常用功能直接展示，高级功能默认折叠 |
| QR-2 | 折叠展开 | 点击"高级"行可展开/收起子菜单，有平滑动画 |
| QR-3 | 子菜单功能 | 高级区 4 个子菜单项点击后正常打开对应面板/路由 |
| QR-4 | 桌面端一致 | 桌面端左侧菜单面板的折叠/展开行为与移动端一致 |
| QR-5 | 跨 Tab 导航 | 通过 Sidebar 跳转到科目管理等高级功能时，自动展开"高级"区 |
| QR-6 | 默认折叠 | 每次进入"我的"页面，高级区默认折叠 |
| QR-7 | 无回归 | 所有现有菜单功能正常可达，退出登录、设置、关于等不受影响 |
