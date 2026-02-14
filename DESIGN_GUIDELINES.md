# 前端交互设计规范

> 本文档从 PRD 中独立，作为全项目通用的前端交互设计规范。

---

## 1. 提示反馈

所有操作的成功/失败/校验提示统一使用 **Toast 组件**（页面顶部红色提示条，3 秒自动消失），不使用 `window.alert` 或 `Alert.alert` 作为普通提示。

```typescript
// 标准写法
const [toastMsg, setToastMsg] = useState('');
const showToast = (title: string, message: string) => {
  if (Platform.OS === 'web') {
    setToastMsg(`${title}: ${message}`);
    setTimeout(() => setToastMsg(''), 3000);
  } else {
    Alert.alert(title, message);
  }
};
```

**适用场景：** 表单校验失败、网络请求成功/失败、操作结果提示等。

## 2. 确认弹窗

需要用户确认的破坏性操作（如删除）**不得使用** `window.confirm` 或 `window.alert`（在 Expo Web Preview 的 iframe 环境中会被浏览器安全策略阻止，导致无任何反应）。

统一使用 React Native 的 `<Modal>` 组件实现自定义确认对话框：

```
┌──────────────────────┐
│      删除贷款         │
│ 确定要删除「xxx」吗？  │
│                      │
│   [取消]    [删除]    │
└──────────────────────┘
```

- Web 端和原生端使用同一套 `<Modal>` 实现，保证行为一致
- 遮罩层点击可关闭（相当于取消）
- 破坏性按钮使用红色（`#EF4444`）

## 3. 桌面端面板内导航规范

桌面端"我的"页面采用左右分栏布局（左侧菜单 380px + 右侧详情面板）。右侧面板通过 `useState` 控制当前展示的组件，**不属于路由系统**。

**核心原则：桌面端右侧面板内的所有交互（列表→详情、新建、编辑、删除）必须在面板内部完成，禁止使用 `router.push` 路由跳转。**

原因：Expo Router 的 `Stack` 是全局导航器，`router.push('/xxx')` 会在根 Stack 中推入全屏页面，覆盖整个 `(tabs)` 区域（包括左侧菜单 + 右侧面板），而非只替换右侧面板内容。

**实现方式：**

| 交互场景 | 手机端 | 桌面端 |
|---------|--------|--------|
| 菜单→列表 | `router.push('/xxx')` | `setActiveDetail('xxx')` 切换面板组件 |
| 列表→详情 | `router.push('/xxx/[id]')` | 面板内 `useState` 切换到详情视图 |
| 新建/编辑 | `router.push` 或 Modal | 面板内 `<Modal>` 弹窗 |
| 删除确认 | `<Modal>` | `<Modal>` |

**标准模式（以贷款管理为例）：**

```typescript
function LoansPane() {
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);

  // 选中时展示内联详情，未选中时展示列表
  if (selectedLoanId) {
    return (
      <LoanDetailInline
        loanId={selectedLoanId}
        onBack={() => setSelectedLoanId(null)}
        onDeleted={() => { setSelectedLoanId(null); refresh(); }}
      />
    );
  }

  return (
    // 列表视图，点击项目 setSelectedLoanId(loan.id)
  );
}
```

**已应用此规范的模块：**
- 预算设置（BudgetPane）：编辑/删除通过 Modal 完成
- 贷款管理（LoansPane）：列表→详情通过内联组件切换，还款/删除通过 Modal 完成
- 固定资产（AssetsPane）：列表→详情通过内联组件切换，计提折旧/处置通过内联表单完成
- 科目管理（AccountsPane）：列表→详情通过内联组件切换，停用通过 Modal 完成

## 4. 卡片间距规范

各页面中卡片/组件之间的间距统一由**父容器的 `gap` 属性**控制，**子组件自身不得设置 `marginBottom`**。

| 页面 / 容器 | gap 值 | 说明 |
|------------|--------|------|
| Dashboard 左侧面板 (`desktopLeftContent`) | `12px` | 桌面端首页左侧概览面板内各卡片间距 |
| Dashboard 移动端滚动区 (`scrollContent`) | `12px` | 移动端首页各卡片间距 |
| 趋势页 (`trends.tsx` - `scrollContent`) | `16px` | 图表之间间距 |
| 报表页 (`reports.tsx` - `scrollContent`) | `16px` | 图表/卡片之间间距 |

**核心原则：**

- 间距由父容器 `gap` 统一管理，子组件（`LineChart`、`PieChart`、`BarChart`、`NetWorthBadge`、`BudgetOverview`、`LoanOverview` 等）的根样式**禁止**设置 `marginTop` / `marginBottom`
- 横向排列的卡片行（`row`）内部使用 `gap: 12` 控制列间距，行与行之间由父容器 `gap` 控制
- 如需对个别组件做特殊间距处理，应在使用处用包裹 `View` 添加，而非修改组件内部样式

## 5. 桌面端右侧面板标题规范

桌面端右侧详情面板的标题区域统一遵循以下样式：

| 属性 | 值 | 说明 |
|------|-----|------|
| 标题字号 | `20px` | `fontWeight: '700'` |
| 容器水平内边距 | `24px` | `paddingHorizontal: 24` |
| 容器顶部内边距 | `24px` | `paddingTop: 24` |
| 容器底部内边距 | `12px` | `paddingBottom: 12` |

**已应用此规范的面板：** Dashboard 近期分录、编辑个人信息、设置、科目管理、固定资产、贷款管理、预算设置。

## 6. 分录列表复用规范

所有展示分录/记账条目的列表统一复用 `EntryCard` 组件（`components/entry/EntryCard.tsx`），禁止内联自定义分录行样式。

**`EntryCard` 视觉结构：**

```
┌──────────────────────────────────────────────────────┐
│  [圆形图标]   描述文字               +¥1,234.56      │
│               类型标签（费用/收入/…）                  │
└──────────────────────────────────────────────────────┘
```

- **左侧**：40px 圆形彩色背景 + FontAwesome 图标（颜色按分录类型区分）
- **中间**：上行为 `description`（15px, 500），下行为类型标签（12px, 次要颜色）
- **右侧**：净资产影响金额，正数绿色、负数红色，`fontVariant: ['tabular-nums']`

**交互规则：**

- 传入 `onPress` 时渲染为 `Pressable`（可点击，如账本页点击进入详情）
- 不传 `onPress` 时渲染为 `View`（纯展示，如 Dashboard 近期分录）
- Dashboard 近期分录仅做展示，用户需点击「查看全部」跳转账本页查看详情

## 7. 移动端导航栏高度规范

移动端顶部标题栏和底部 Tab Bar 统一高度 `60px`，配置位置为 `app/(tabs)/_layout.tsx`。

| 元素 | 高度 | 其他属性 | 说明 |
|------|------|---------|------|
| 顶部标题栏 (`headerStyle`) | `60px` | `headerTitleAlign: 'center'`，`fontSize: 17`，`fontWeight: '600'` | 标题居中显示 |
| 底部 Tab Bar (`tabBarStyle`) | `60px` | — | 桌面端隐藏（`display: 'none'`） |

**注意：** 各页面 `ScrollView` 的 `contentContainerStyle` 需设置 `paddingBottom: 80` 以防内容被底部 Tab Bar 遮挡。

## 8. 桌面端 Tab 切换时重置面板状态

桌面端采用左右分栏布局的页面，在用户通过左侧导航栏切换 Tab 后再切回时，**右侧面板必须重置为默认空状态**，不得保留上次浏览的子面板/详情。

**原因：** Expo Router 的 Tab 页面在切换后不会被卸载，组件内的 `useState` 状态会被保留。如果不主动重置，用户从"我的→固定资产"切换到"总览"再切回"我的"时，右侧面板仍停留在"固定资产"，而非初始的空状态。

**实现方式：** 在 `useFocusEffect` 中重置右侧面板的选中状态：

```typescript
// profile.tsx — 重置详情面板
useFocusEffect(
  useCallback(() => {
    const pane = consumePendingPane(); // 消费来自其他 tab 的跳转指令
    if (isDesktop) {
      setActiveDetail(pane ? (pane as DetailPane) : 'none');
    }
  }, [consumePendingPane, isDesktop])
);

// ledger.tsx — 重置选中分录
useFocusEffect(
  useCallback(() => {
    setSelectedEntryId(null);
    doFetch();
  }, [doFetch])
);
```

**规则：**

- 如果有 `pendingPane`（来自其他 Tab 的定向跳转，如 Dashboard 点击"预算"），则打开对应面板
- 如果没有 `pendingPane`（用户直接点导航栏切换），则重置为默认空状态
- 所有带桌面端分栏布局的页面均需遵守此规范

**已应用此规范的页面：** `profile.tsx`、`ledger.tsx`

## 9. 默认科目

| 场景 | 默认科目 | 科目代码 | 说明 |
|------|---------|---------|------|
| 还款利息费用科目 | 利息支出 | `5013` | 贷款详情页记录还款、记账页 repay 类型，自动从 expense 科目树中查找 code 为 `5013` 的科目作为默认值 |

默认科目在前端硬编码设置，不在数据库层添加字段。用户仍可手动切换为其他科目。

## 10. Modal 弹窗尺寸规范

所有通过 `<Modal>` 弹出的对话框（创建、确认删除、编辑等）统一遵循以下尺寸：

| 属性 | 移动端（< 768px） | 桌面端（≥ 768px） | 说明 |
|------|-------------------|-------------------|------|
| 宽度 | 屏幕宽度 × 85%（`width: '85%'`） | 固定 `420px` | 移动端自适应，桌面端固定宽度 |
| 最大宽度 | `420px` | — | 防止移动端大屏设备过宽 |
| 圆角 | `14px` | `14px` | `borderRadius: 14` |
| 内边距 | `24px` | `24px` | `padding: 24` |
| 标题字号 | `17px` | `17px` | `fontWeight: '600'`, `textAlign: 'center'` |

**实现方式：** 在 StyleSheet 中使用固定值 `width: '85%'` + `maxWidth: 420` 即可同时覆盖移动端和桌面端，无需动态判断。

**已应用此规范的弹窗：** API Key 创建/成功/删除、插件删除、预算编辑、账本页删除确认。
