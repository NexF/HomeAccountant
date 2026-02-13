# 家庭记账 - 技术方案文档 (Tech Spec)

> **版本：v0.0.3**
> **创建日期：2026-02-13**
> **基于版本：v0.0.2**
> **状态：规划中**
> **本版本变更：总览页桌面端布局重构（左右分栏）**

---

## 1. 技术架构概述

v0.0.3 为纯前端布局重构，不涉及后端变更。

- **前端**：React Native + Expo + TypeScript + Zustand（不变）
- **后端**：无变更
- **影响范围**：仅 `client/app/(tabs)/index.tsx`

### 1.1 变更范围

| 层 | 文件 | 变更类型 | 说明 |
|----|------|---------|------|
| 前端页面 | `app/(tabs)/index.tsx` | 重构 | 桌面端布局从网格改为左右分栏 |

> **后端零改动**：Dashboard API（`GET /books/{id}/dashboard`）返回的 `recent_entries` 已包含近期分录数据，前端直接复用。

---

## 2. 前端实现方案

### 2.1 布局结构变更

**变更前（v0.0.2 桌面端）：**

```
ScrollView (整页滚动)
├── netWorthSection
├── incomeExpenseCards
├── surplusCard
├── desktopGrid (flexDirection: 'row')
│   ├── desktopCol (flex: 1)
│   │   ├── trendChart
│   │   └── budgetSection
│   └── desktopCol (flex: 1)
│       ├── pieChart
│       ├── loanSection
│       └── pendingSection
└── recentEntries (在底部)
```

**变更后（v0.0.3 桌面端）：**

```
View (flexDirection: 'row', flex: 1)
├── ScrollView (左侧面板, width: 380, borderRightWidth: 1, 独立滚动)
│   ├── netWorthSection
│   ├── incomeExpenseCards
│   ├── surplusCard
│   ├── trendChart (宽度固定 380 - padding)
│   ├── pieChart
│   ├── pendingSection
│   ├── budgetSection
│   └── loanSection
└── View (右侧面板, flex: 1)
    ├── sectionHeader ("近期分录" + "查看全部")
    ├── ScrollView (分录列表, 独立滚动)
    │   └── entryItems
    └── FAB (浮动 + 按钮)
```

### 2.2 核心代码变更

#### 2.2.1 桌面端渲染逻辑

替换当前 `isDesktop` 分支的 return：

```typescript
// 变更前
if (isDesktop) {
  return (
    <ScrollView ...>
      {netWorthSection}
      {incomeExpenseCards}
      {surplusCard}
      <View style={styles.desktopGrid}>
        <View style={styles.desktopCol}>
          {trendChart}
          {budgetSection}
        </View>
        <View style={styles.desktopCol}>
          {pieChart}
          {loanSection}
          {pendingSection}
        </View>
      </View>
      {recentEntries}
    </ScrollView>
  );
}

// 变更后
if (isDesktop) {
  return (
    <View style={[styles.desktopContainer, { backgroundColor: colors.background }]}>
      {/* 左侧概览面板 (固定 380px) */}
      <ScrollView
        style={[styles.desktopLeft, { borderRightColor: colors.border }]}
        contentContainerStyle={styles.desktopLeftContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {netWorthSection}
        {incomeExpenseCards}
        {surplusCard}
        {trendChart}
        {pieChart}
        {pendingSection}
        {budgetSection}
        {loanSection}
      </ScrollView>

      {/* 右侧分录面板 (flex: 1) */}
      <View style={[styles.desktopRight, { backgroundColor: colors.background }]}>
        <View style={styles.desktopRightHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>近期分录</Text>
          <Pressable onPress={() => router.push('/(tabs)/ledger' as any)}>
            <Text style={[styles.sectionLink, { color: Colors.primary }]}>查看全部</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.desktopRightScroll} contentContainerStyle={styles.desktopRightScrollContent}>
          {recentEntriesList}
        </ScrollView>
        {fab}
      </View>
    </View>
  );
}
```

#### 2.2.2 折线图宽度

当前折线图宽度基于 `screenWidth` 计算：

```typescript
// 变更前
const chartWidth = isDesktop
  ? Math.min(screenWidth * 0.4, 500)
  : Math.min(screenWidth - 64, 500);
```

变更后基于左侧面板固定宽度 380px 计算：

```typescript
// 变更后
const chartWidth = isDesktop
  ? 380 - 32 - 32  // 左侧面板宽度 - padding*2 - 余量
  : Math.min(screenWidth - 64, 500);
```

左侧面板宽度固定 380px，无需 `onLayout` 动态获取。

#### 2.2.3 分录列表提取

当前 `recentEntries` 变量包含了标题头部和分录列表。需要拆分为：
- 桌面端右侧面板使用：独立的 header + 分录列表（不带外层 section 卡片包裹）
- 移动端仍使用原有的带卡片包裹样式

```typescript
// 分录列表内容（复用）
const recentEntriesList = (d?.recent_entries ?? []).length === 0 ? (
  <View style={styles.emptyContainer}>
    <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
      暂无记录，点击 + 开始记账
    </Text>
  </View>
) : (
  d!.recent_entries.map((entry, idx) => (
    <Pressable
      key={entry.id}
      style={[
        styles.entryItem,
        idx < d!.recent_entries.length - 1 && {
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
        },
      ]}
      onPress={() => router.push(`/entry/${entry.id}` as any)}
    >
      <View style={styles.entryLeft}>
        <Text style={[styles.entryType, { color: colors.text }]}>
          {ENTRY_TYPE_LABELS[entry.entry_type] || entry.entry_type}
        </Text>
        <Text style={[styles.entryDesc, { color: colors.textSecondary }]} numberOfLines={1}>
          {entry.description || entry.entry_date}
        </Text>
      </View>
      <Text style={[styles.entryDate, { color: colors.textSecondary }]}>
        {entry.entry_date}
      </Text>
    </Pressable>
  ))
);

// 移动端使用：带卡片包裹
const recentEntries = (
  <View style={[styles.section, { backgroundColor: colors.card }]}>
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>近期分录</Text>
      <Pressable onPress={() => router.push('/(tabs)/ledger' as any)}>
        <Text style={[styles.sectionLink, { color: Colors.primary }]}>查看全部</Text>
      </Pressable>
    </View>
    {recentEntriesList}
  </View>
);
```

#### 2.2.4 FAB 浮动记账按钮

桌面端 FAB 放在右侧面板内：

```typescript
const fab = (
  <Pressable
    style={[styles.fab, { backgroundColor: Colors.primary }]}
    onPress={() => router.push('/entry/new' as any)}
  >
    <FontAwesome name="plus" size={22} color="#FFFFFF" />
  </Pressable>
);
```

FAB 样式已有 `position: 'absolute', right: 20, bottom: 24`，放在右侧面板容器中即可正确定位。

### 2.3 新增/修改样式

```typescript
const styles = StyleSheet.create({
  // ... 保留已有样式 ...

  // 新增：桌面端左右分栏容器
  desktopContainer: {
    flex: 1,
    flexDirection: 'row',
  },

  // 新增：左侧概览面板（固定 380px）
  desktopLeft: {
    width: 380,
    borderRightWidth: 1,
  },
  desktopLeftContent: {
    padding: 16,
    paddingBottom: 40,
  },

  // 新增：右侧分录面板（flex: 1）
  desktopRight: {
    flex: 1,
  },
  desktopRightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'transparent',
  },
  desktopRightScroll: {
    flex: 1,
  },

  // 删除：不再需要的桌面端网格样式
  // desktopGrid — 删除
  // desktopCol — 删除
});
```

### 2.4 需要删除的样式

以下样式在 v0.0.3 中不再使用，应删除：

| 样式名 | 原用途 | 删除原因 |
|--------|--------|---------|
| `desktopGrid` | 双列网格容器 | 不再使用网格布局 |
| `desktopCol` | 网格列 | 同上 |

---

## 3. 开发实施计划

### 阶段 1：布局重构（预计 0.5 天）

1. 在 `index.tsx` 中修改 `chartWidth` 计算为基于固定 380px
2. 重构桌面端 `isDesktop` 分支的 JSX：
   - 外层改为 `flexDirection: 'row'` 容器
   - 左侧 `ScrollView` 包裹概览内容
   - 右侧 `View` 包裹分录列表
3. 拆分 `recentEntries` 变量为 `recentEntriesList`（桌面端右侧面板使用）
4. 移动端 return 中移除 `recentEntries`（近期分录不再在移动端显示）
5. 新增样式：`desktopContainer`、`desktopLeft`、`desktopLeftContent`、`desktopRight`、`desktopRightHeader`、`desktopRightScroll`
5. 新增样式：`desktopContainer`、`desktopLeft`、`desktopLeftContent`、`desktopRight`、`desktopRightHeader`、`desktopRightScroll`
6. 删除样式：`desktopGrid`、`desktopCol`

### 阶段 2：验证 & 收尾（预计 0.5 天）

1. 桌面端验证：左右面板独立滚动、折线图宽度正确自适应、分录列表正常展示
2. 移动端回归：确认手机端布局不受影响
3. 深色模式验证：分割线、背景色正确
4. 响应式断点验证：768px 前后切换正常
5. 下拉刷新验证：左侧面板刷新时右侧分录数据同步更新

---

### 总体时间估算

| 阶段 | 内容 | 预计工时 | 累计 |
|------|------|---------|------|
| 1 | 布局重构 | 0.5 天 | 0.5 天 |
| 2 | 验证 & 收尾 | 0.5 天 | 1 天 |

> v0.0.3 总计约 **1 个工作日**。

---

## 4. 依赖变更

### 4.1 后端

无变更。

### 4.2 前端

无新增依赖。

---

## 5. 测试要点

| 测试用例 | 预期结果 |
|---------|---------|
| 桌面端（≥768px）打开 Dashboard | 左右分栏布局，左侧概览右侧分录 |
| 手机端（<768px）打开 Dashboard | 单列堆叠布局，不显示近期分录 |
| 左侧面板上下滚动 | 右侧面板不跟随滚动 |
| 右侧面板上下滚动 | 左侧面板不跟随滚动 |
| 折线图宽度 | 基于左侧面板 380px 固定计算，不溢出 |
| 右侧面板分录为空 | 显示 "暂无记录" 引导文案 |
| 点击右侧分录 | 跳转到 `/entry/${id}` 详情页 |
| 点击 "查看全部" | 跳转到账本（Ledger）tab |
| 点击右侧 FAB (+) | 跳转到 `/entry/new` |
| 下拉刷新左侧面板 | 左侧概览数据和右侧分录数据同步刷新 |
| 窗口从 <768px 拉宽到 ≥768px | 布局从单列切换为左右分栏 |
| 窗口从 ≥768px 缩窄到 <768px | 布局从左右分栏切换为单列 |
| 深色模式 | 分割线、背景色、文字颜色正确 |
| 右侧面板宽度 | flex: 1 自适应，左侧面板固定 380px |
