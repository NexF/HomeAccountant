# 咕咕记账 - 技术方案文档 (Tech Spec)

> **版本：v0.3.0**
> **创建日期：2026-02-24**
> **基于版本：v0.2.3**
> **状态：规划中**
> **本版本变更：多账本支持 & 家庭协作**

---

## 1. 技术架构概述

v0.3.0 补齐多账本管理的完整闭环——账本 CRUD、成员邀请/管理、权限控制和前端账本切换器。后端数据模型（`Book` + `BookMember`）已就绪，本版本主要新增 API 端点、权限依赖和前端 UI。

- **后端**：Python FastAPI + SQLAlchemy + SQLite（新增 7 个端点 + 权限依赖）
- **前端**：React Native + Expo + TypeScript（新增账本切换器 + 账本设置 + 成员管理 UI）

### 1.1 变更范围

| 层 | 文件 | 变更类型 | 说明 |
|----|------|---------|------|
| **Schema** | `server/app/schemas/book.py` | 修改 | 新增 `UpdateBookRequest`、`InviteMemberRequest`、`UpdateMemberRoleRequest`、`BookMemberResponse`；`BookResponse` 增加 `role` 字段 |
| **Service** | `server/app/services/book_service.py` | 修改 | 新增 `update_book`、`delete_book`、`get_book_members`、`invite_member`、`remove_member`、`update_member_role`、`leave_book`、`get_member_role`、`require_admin`、`require_member` |
| **Router** | `server/app/routers/books.py` | 修改 | 新增 7 个端点（PUT/DELETE 账本 + 成员 CRUD + 退出）；`GET /books` 响应增加 `role` |
| **Deps** | `server/app/utils/deps.py` | 修改 | 新增 `get_book_member_role`、`require_book_admin`、`require_book_member` 权限依赖 |
| **Router** | `server/app/routers/accounts.py` | 修改 | admin-only 操作（创建/编辑/停用科目）增加角色校验 |
| **Router** | `server/app/routers/budgets.py` | 修改 | admin-only 操作增加角色校验 |
| **Router** | `server/app/routers/assets.py` | 修改 | admin-only 操作增加角色校验 |
| **Router** | `server/app/routers/loans.py` | 修改 | admin-only 操作增加角色校验 |
| **前端组件** | `client/features/book/BookSwitcher.tsx` | 新增 | 账本切换器（Dropdown / BottomSheet） |
| **前端组件** | `client/features/book/BookSettingsPane.tsx` | 新增 | 桌面端账本设置面板（重命名 + 成员管理 + 删除/退出） |
| **前端组件** | `client/features/book/MemberList.tsx` | 新增 | 成员列表组件 |
| **前端组件** | `client/features/book/InviteMemberModal.tsx` | 新增 | 邀请成员弹窗 |
| **前端组件** | `client/features/book/CreateBookModal.tsx` | 新增 | 创建账本弹窗 |
| **前端组件** | `client/features/book/index.ts` | 新增 | Barrel export |
| **前端页面** | `client/app/settings/book.tsx` | 新增 | 移动端账本设置页面 |
| **前端 Service** | `client/services/bookService.ts` | 修改 | 新增成员管理、更新/删除账本 API |
| **前端 Store** | `client/stores/bookStore.ts` | 修改 | 增加 `currentRole`、`createBook`、`updateBook`、`deleteBook`；切换后触发全局刷新 |
| **前端布局** | `client/components/layout/Sidebar.tsx` | 修改 | Logo 下方集成 `BookSwitcher` |
| **前端布局** | `client/app/(tabs)/_layout.tsx` | 修改 | 移动端集成账本切换入口（TopBar 区域） |
| **前端页面** | `client/app/(tabs)/profile.tsx` | 修改 | 菜单增加「账本设置」项 |
| **前端类型** | `client/features/profile/types.ts` | 修改 | `DetailPane` 增加 `'book-settings'` |
| **测试** | `server/tests/test_book_members.py` | 新增 | 成员邀请/移除/角色修改/退出测试 |
| **测试** | `server/tests/test_book_management.py` | 新增 | 账本更新/删除/权限校验测试 |

### 1.2 无需变更

| 文件 | 说明 |
|------|------|
| `server/app/models/book.py` | `Book` + `BookMember` 模型已完整支持多账本和成员角色 |
| `server/app/models/user.py` | 用户模型不需改动 |
| `server/app/services/entry_service.py` | 记账逻辑不变，已按 `book_id` 隔离 |
| `server/app/services/report_service.py` | 报表已按 `book_id` 查询 |

### 1.3 现有数据模型

```python
# server/app/models/book.py — 已存在，无需修改
class Book(Base):
    __tablename__ = "books"
    id: Mapped[str]          # UUID
    name: Mapped[str]        # 账本名称
    type: Mapped[str]        # personal / family
    owner_id: Mapped[str]    # 创建者 FK → users.id
    created_at: Mapped[datetime]
    # 关联：owner, members, accounts, journal_entries（cascade delete）

class BookMember(Base):
    __tablename__ = "book_members"
    book_id: Mapped[str]     # PK1, FK → books.id
    user_id: Mapped[str]     # PK2, FK → users.id
    role: Mapped[str]        # admin / member
    # 关联：book, user
```

---

## 2. 后端 Schema 变更

### 2.1 新增 Schema

```python
# server/app/schemas/book.py

class UpdateBookRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class InviteMemberRequest(BaseModel):
    email: str = Field(..., description="被邀请人的注册邮箱")
    role: str = Field("member", pattern=r"^(admin|member)$")


class UpdateMemberRoleRequest(BaseModel):
    role: str = Field(..., pattern=r"^(admin|member)$")


class BookMemberResponse(BaseModel):
    user_id: str
    email: str
    nickname: str | None
    role: str           # admin / member
    is_owner: bool      # user_id == book.owner_id

    model_config = {"from_attributes": True}
```

### 2.2 修改 BookResponse

```python
class BookResponse(BaseModel):
    id: str
    name: str
    type: str
    owner_id: str
    created_at: datetime
    role: str = ""  # 新增：当前用户在此账本中的角色

    model_config = {"from_attributes": True}
```

`GET /books` 返回时，每个账本附带当前用户的 `role`。

---

## 3. 后端权限依赖

### 3.1 新增权限函数

在 `server/app/services/book_service.py` 中新增：

```python
async def get_member_role(
    db: AsyncSession, user_id: str, book_id: str
) -> str | None:
    """返回用户在账本中的角色：'admin' / 'member' / None"""
    result = await db.execute(
        select(BookMember.role).where(
            BookMember.book_id == book_id,
            BookMember.user_id == user_id,
        )
    )
    row = result.scalar_one_or_none()
    return row


async def require_admin(
    db: AsyncSession, user_id: str, book_id: str
) -> None:
    """非 admin 则抛出 403"""
    role = await get_member_role(db, user_id, book_id)
    if role != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")


async def require_member(
    db: AsyncSession, user_id: str, book_id: str
) -> None:
    """非成员则抛出 403"""
    role = await get_member_role(db, user_id, book_id)
    if role is None:
        raise HTTPException(status_code=403, detail="无权访问该账本")
```

### 3.2 FastAPI 依赖注入封装

在 `server/app/utils/deps.py` 中新增可复用依赖：

```python
from app.services.book_service import get_member_role


async def get_book_member_role(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> str:
    """获取当前用户在指定账本中的角色，非成员抛 403"""
    role = await get_member_role(db, current_user.id, book_id)
    if role is None:
        raise HTTPException(status_code=403, detail="无权访问该账本")
    return role


async def require_book_admin(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """要求当前用户是指定账本的 admin"""
    role = await get_member_role(db, current_user.id, book_id)
    if role != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return current_user


async def require_book_member(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    """要求当前用户是指定账本的成员"""
    role = await get_member_role(db, current_user.id, book_id)
    if role is None:
        raise HTTPException(status_code=403, detail="无权访问该账本")
    return current_user
```

### 3.3 各 Router 权限升级

对以下 admin-only 操作增加 `require_book_admin` 校验：

| Router | 端点 | 权限 |
|--------|------|------|
| `accounts.py` | `POST /books/{book_id}/accounts` | admin |
| `accounts.py` | `PUT /accounts/{account_id}` | admin |
| `accounts.py` | `DELETE /accounts/{account_id}` | admin |
| `budgets.py` | `POST /books/{book_id}/budgets` | admin |
| `budgets.py` | `PUT /budgets/{budget_id}` | admin |
| `budgets.py` | `DELETE /budgets/{budget_id}` | admin |
| `assets.py` | 创建/编辑/处置 | admin |
| `loans.py` | 创建/编辑/还款/提前还款 | admin |

记账（`entries.py`）保持 **member+** 权限（member 和 admin 都可记账）。

---

## 4. 后端 Router 新增端点

### 4.1 更新账本

```python
@router.put("/{book_id}", response_model=BookResponse, summary="更新账本")
async def update_book(
    book_id: str,
    body: UpdateBookRequest,
    current_user: User = Depends(require_book_admin),
    db: AsyncSession = Depends(get_db),
):
    """更新账本名称，需 admin 权限"""
    book = await book_service.update_book(db, book_id, body.name)
    if not book:
        raise HTTPException(status_code=404, detail="账本不存在")
    return BookResponse.model_validate(book)
```

### 4.2 删除账本

```python
@router.delete("/{book_id}", status_code=204, summary="删除账本")
async def delete_book(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """删除账本及所有关联数据，仅 owner 可操作"""
    book = await book_service.get_book_by_id(db, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="账本不存在")
    if book.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="仅账本创建者可删除")
    await book_service.delete_book(db, book_id)
```

### 4.3 获取成员列表

```python
@router.get("/{book_id}/members", response_model=list[BookMemberResponse], summary="成员列表")
async def get_members(
    book_id: str,
    current_user: User = Depends(require_book_member),
    db: AsyncSession = Depends(get_db),
):
    """获取账本成员列表，需 member+ 权限"""
    return await book_service.get_book_members(db, book_id)
```

### 4.4 邀请成员

```python
@router.post("/{book_id}/members", response_model=BookMemberResponse, status_code=201, summary="邀请成员")
async def invite_member(
    book_id: str,
    body: InviteMemberRequest,
    current_user: User = Depends(require_book_admin),
    db: AsyncSession = Depends(get_db),
):
    """通过邮箱邀请成员，需 admin 权限"""
    return await book_service.invite_member(db, book_id, body.email, body.role)
```

### 4.5 修改成员角色

```python
@router.put("/{book_id}/members/{user_id}", response_model=BookMemberResponse, summary="修改角色")
async def update_member_role(
    book_id: str,
    user_id: str,
    body: UpdateMemberRoleRequest,
    current_user: User = Depends(require_book_admin),
    db: AsyncSession = Depends(get_db),
):
    """修改成员角色，需 admin 权限，owner 角色不可修改"""
    return await book_service.update_member_role(db, book_id, user_id, body.role)
```

### 4.6 移除成员

```python
@router.delete("/{book_id}/members/{user_id}", status_code=204, summary="移除成员")
async def remove_member(
    book_id: str,
    user_id: str,
    current_user: User = Depends(require_book_admin),
    db: AsyncSession = Depends(get_db),
):
    """移除成员，需 admin 权限，owner 不可被移除"""
    await book_service.remove_member(db, book_id, user_id)
```

### 4.7 退出账本

```python
@router.post("/{book_id}/leave", status_code=204, summary="退出账本")
async def leave_book(
    book_id: str,
    current_user: User = Depends(require_book_member),
    db: AsyncSession = Depends(get_db),
):
    """退出账本，owner 不可退出"""
    book = await book_service.get_book_by_id(db, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="账本不存在")
    if book.owner_id == current_user.id:
        raise HTTPException(status_code=400, detail="账本创建者不可退出，请先删除账本")
    await book_service.leave_book(db, book_id, current_user.id)
```

### 4.8 修改 GET /books

```python
@router.get("", response_model=list[BookResponse], summary="获取账本列表")
async def list_books(
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户拥有或参与的所有账本，含角色信息"""
    books_with_role = await book_service.get_user_books_with_role(db, current_user.id)
    return books_with_role
```

---

## 5. 后端 Service 新增方法

### 5.1 book_service.py 新增

```python
async def get_user_books_with_role(db: AsyncSession, user_id: str) -> list[dict]:
    """获取用户账本列表，附带角色信息"""
    result = await db.execute(
        select(Book, BookMember.role)
        .join(BookMember, Book.id == BookMember.book_id)
        .where(BookMember.user_id == user_id)
        .order_by(Book.created_at)
    )
    return [
        {
            "id": book.id,
            "name": book.name,
            "type": book.type,
            "owner_id": book.owner_id,
            "created_at": book.created_at,
            "role": role,
        }
        for book, role in result.all()
    ]


async def update_book(db: AsyncSession, book_id: str, name: str) -> Book | None:
    """更新账本名称"""
    book = await get_book_by_id(db, book_id)
    if not book:
        return None
    book.name = name
    await db.flush()
    await db.refresh(book)
    return book


async def delete_book(db: AsyncSession, book_id: str) -> None:
    """删除账本（级联删除所有关联数据）"""
    book = await get_book_by_id(db, book_id)
    if book:
        await db.delete(book)
        await db.flush()


async def get_book_members(db: AsyncSession, book_id: str) -> list[dict]:
    """获取账本成员列表"""
    from app.models.user import User as UserModel

    result = await db.execute(
        select(BookMember, UserModel)
        .join(UserModel, BookMember.user_id == UserModel.id)
        .where(BookMember.book_id == book_id)
        .order_by(BookMember.role.desc())  # admin 排前面
    )
    book = await get_book_by_id(db, book_id)
    return [
        {
            "user_id": member.user_id,
            "email": user.email,
            "nickname": user.nickname,
            "role": member.role,
            "is_owner": member.user_id == book.owner_id,
        }
        for member, user in result.all()
    ]


async def invite_member(
    db: AsyncSession, book_id: str, email: str, role: str
) -> dict:
    """通过邮箱邀请成员"""
    from app.models.user import User as UserModel

    # 查找用户
    result = await db.execute(
        select(UserModel).where(UserModel.email == email)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="该邮箱未注册，请对方先注册")

    # 检查是否已是成员
    existing = await db.execute(
        select(BookMember).where(
            BookMember.book_id == book_id,
            BookMember.user_id == user.id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="该用户已是账本成员")

    # 创建成员记录
    member = BookMember(book_id=book_id, user_id=user.id, role=role)
    db.add(member)
    await db.flush()

    book = await get_book_by_id(db, book_id)
    return {
        "user_id": user.id,
        "email": user.email,
        "nickname": user.nickname,
        "role": role,
        "is_owner": user.id == book.owner_id,
    }


async def remove_member(
    db: AsyncSession, book_id: str, user_id: str
) -> None:
    """移除成员"""
    book = await get_book_by_id(db, book_id)
    if book and book.owner_id == user_id:
        raise HTTPException(status_code=400, detail="不可移除账本创建者")

    result = await db.execute(
        select(BookMember).where(
            BookMember.book_id == book_id,
            BookMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="成员不存在")

    await db.delete(member)
    await db.flush()


async def update_member_role(
    db: AsyncSession, book_id: str, user_id: str, role: str
) -> dict:
    """修改成员角色"""
    from app.models.user import User as UserModel

    book = await get_book_by_id(db, book_id)
    if book and book.owner_id == user_id:
        raise HTTPException(status_code=400, detail="不可修改账本创建者的角色")

    result = await db.execute(
        select(BookMember).where(
            BookMember.book_id == book_id,
            BookMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="成员不存在")

    member.role = role
    await db.flush()

    user_result = await db.execute(
        select(UserModel).where(UserModel.id == user_id)
    )
    user = user_result.scalar_one()
    return {
        "user_id": user.id,
        "email": user.email,
        "nickname": user.nickname,
        "role": role,
        "is_owner": user.id == book.owner_id,
    }


async def leave_book(
    db: AsyncSession, book_id: str, user_id: str
) -> None:
    """退出账本"""
    result = await db.execute(
        select(BookMember).where(
            BookMember.book_id == book_id,
            BookMember.user_id == user_id,
        )
    )
    member = result.scalar_one_or_none()
    if member:
        await db.delete(member)
        await db.flush()
```

---

## 6. 前端 Service 变更

### 6.1 bookService.ts 新增方法

```typescript
// client/services/bookService.ts

export type BookResponse = {
  id: string;
  name: string;
  type: string;
  owner_id: string;
  created_at: string;
  role: string;         // 新增
};

export type BookMemberResponse = {
  user_id: string;
  email: string;
  nickname: string | null;
  role: string;
  is_owner: boolean;
};

export type CreateBookParams = {
  name: string;
  type?: 'personal' | 'family';
};

export type UpdateBookParams = {
  name: string;
};

export type InviteMemberParams = {
  email: string;
  role?: 'admin' | 'member';
};

export type UpdateMemberRoleParams = {
  role: 'admin' | 'member';
};

export const bookService = {
  // 已有
  getBooks: () => api.get<BookResponse[]>('/books'),
  createBook: (params: CreateBookParams) => api.post<BookResponse>('/books', params),

  // 新增
  updateBook: (bookId: string, params: UpdateBookParams) =>
    api.put<BookResponse>(`/books/${bookId}`, params),

  deleteBook: (bookId: string) =>
    api.delete(`/books/${bookId}`),

  getMembers: (bookId: string) =>
    api.get<BookMemberResponse[]>(`/books/${bookId}/members`),

  inviteMember: (bookId: string, params: InviteMemberParams) =>
    api.post<BookMemberResponse>(`/books/${bookId}/members`, params),

  updateMemberRole: (bookId: string, userId: string, params: UpdateMemberRoleParams) =>
    api.put<BookMemberResponse>(`/books/${bookId}/members/${userId}`, params),

  removeMember: (bookId: string, userId: string) =>
    api.delete(`/books/${bookId}/members/${userId}`),

  leaveBook: (bookId: string) =>
    api.post(`/books/${bookId}/leave`),
};
```

---

## 7. 前端 Store 变更

### 7.1 bookStore.ts 改造

```typescript
// client/stores/bookStore.ts

import { create } from 'zustand';
import { bookService, type BookResponse } from '@/services/bookService';

type BookState = {
  books: BookResponse[];
  currentBook: BookResponse | null;
  currentRole: 'admin' | 'member' | null;  // 新增
  isLoading: boolean;

  fetchBooks: () => Promise<void>;
  setCurrentBook: (book: BookResponse) => void;
  createBook: (name: string, type: string) => Promise<BookResponse>;
  updateBook: (bookId: string, name: string) => Promise<void>;
  deleteBook: (bookId: string) => Promise<void>;
  reset: () => void;
};

export const useBookStore = create<BookState>((set, get) => ({
  books: [],
  currentBook: null,
  currentRole: null,
  isLoading: false,

  fetchBooks: async () => {
    set({ isLoading: true });
    try {
      const { data } = await bookService.getBooks();
      const current = get().currentBook;
      const matched = current ? data.find((b) => b.id === current.id) : null;
      const selectedBook = matched ?? data[0] ?? null;
      set({
        books: data,
        currentBook: selectedBook,
        currentRole: (selectedBook?.role as 'admin' | 'member') ?? null,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  setCurrentBook: (book) => {
    set({
      currentBook: book,
      currentRole: (book.role as 'admin' | 'member') ?? null,
    });
    // 切换后各 Store 需要重新拉取数据
    // 由各页面 useEffect 监听 currentBook 变化触发
  },

  createBook: async (name, type) => {
    const { data } = await bookService.createBook({ name, type });
    await get().fetchBooks();
    return data;
  },

  updateBook: async (bookId, name) => {
    await bookService.updateBook(bookId, { name });
    await get().fetchBooks();
  },

  deleteBook: async (bookId) => {
    await bookService.deleteBook(bookId);
    await get().fetchBooks();
  },

  reset: () => set({ books: [], currentBook: null, currentRole: null, isLoading: false }),
}));
```

### 7.2 切换账本后的数据刷新

在各页面的 `useEffect` 中监听 `currentBook` 变化，触发对应 Store 刷新：

```typescript
// 示例：app/(tabs)/index.tsx (Dashboard)
const currentBook = useBookStore((s) => s.currentBook);
const fetchTree = useAccountStore((s) => s.fetchTree);

useEffect(() => {
  if (currentBook) {
    fetchTree(currentBook.id);
    // 其他 Store 的刷新也类似
  }
}, [currentBook?.id]);
```

| Store | 刷新动作 |
|-------|---------|
| `accountStore` | `fetchTree(bookId)` |
| `entryStore` | 重置分页 + `fetchEntries(bookId)` |
| `budgetStore` | `fetchBudgets(bookId)` |
| `assetStore` | `fetchAssets(bookId)` |
| `loanStore` | `fetchLoans(bookId)` |
| Dashboard | 重新拉取 dashboard / expense-breakdown / net-worth-trend |
| 报表 | 清空缓存，下次打开重新拉取 |

---

## 8. 前端 UI 实现

### 8.1 账本切换器 BookSwitcher.tsx

#### 8.1.1 组件位置

| 端 | 容器 | 位置 |
|----|------|------|
| 桌面端 | `Sidebar.tsx` | Logo 区域下方 |
| 移动端 | `_layout.tsx` | Tab Bar 上方或 TopBar 区域 |

#### 8.1.2 Props

```typescript
type BookSwitcherProps = {
  onCreateBook: () => void;      // 打开创建 Modal
  onOpenSettings: () => void;    // 导航到账本设置
};
```

#### 8.1.3 桌面端实现（Dropdown）

```typescript
export function BookSwitcher({ onCreateBook, onOpenSettings }: BookSwitcherProps) {
  const { books, currentBook, setCurrentBook } = useBookStore();
  const [open, setOpen] = useState(false);

  return (
    <View>
      {/* 触发器：当前账本名 + chevron */}
      <Pressable style={styles.trigger} onPress={() => setOpen(!open)}>
        <Text style={styles.currentName} numberOfLines={1}>
          {currentBook?.name ?? '选择账本'}
        </Text>
        <FontAwesome name={open ? 'chevron-up' : 'chevron-down'} size={12} />
      </Pressable>

      {/* Dropdown 面板 */}
      {open && (
        <View style={styles.dropdown}>
          {books.map((book) => (
            <Pressable
              key={book.id}
              style={styles.bookItem}
              onPress={() => { setCurrentBook(book); setOpen(false); }}
            >
              {book.id === currentBook?.id && (
                <FontAwesome name="check" size={12} color={Colors.primary} />
              )}
              <Text style={styles.bookName}>{book.name}</Text>
              <Text style={styles.roleTag}>{book.role}</Text>
            </Pressable>
          ))}
          {/* 底部操作 */}
          <View style={styles.divider} />
          <Pressable style={styles.actionItem} onPress={() => { onCreateBook(); setOpen(false); }}>
            <FontAwesome name="plus" size={14} color={Colors.primary} />
            <Text style={styles.actionText}>创建新账本</Text>
          </Pressable>
          <Pressable style={styles.actionItem} onPress={() => { onOpenSettings(); setOpen(false); }}>
            <FontAwesome name="cog" size={14} color={Colors.primary} />
            <Text style={styles.actionText}>账本设置</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
```

#### 8.1.4 移动端实现（BottomSheet）

移动端使用 `<Modal animationType="slide">` 从底部弹出，UI 结构与桌面端一致，项目高度调整为 52px。

#### 8.1.5 样式规范

| 属性 | 桌面端 | 移动端 |
|------|--------|--------|
| 触发器高度 | 40px | 44px |
| 下拉项高度 | 44px | 52px |
| 选中标记 | `check` 图标 + `Colors.primary` 文字色 | 同左 |
| 角色标签 | 右侧 12px 灰色文字 | 同左 |
| Dropdown 宽度 | 与 Sidebar 同宽（220px） | 100% 屏幕宽 |
| 阴影 | `shadowOffset: { height: 4 }`, `shadowOpacity: 0.15` | 无（BottomSheet 自带遮罩） |

### 8.2 Sidebar.tsx 集成

在 Logo 区域下方、导航项之前插入：

```typescript
// client/components/layout/Sidebar.tsx
{/* Logo */}
<View style={styles.logoArea}>
  <FontAwesome name="calculator" size={24} color={Colors.primary} />
  <Text style={[styles.logoText, { color: colors.text }]}>咕咕记账</Text>
</View>

{/* 账本切换器 — 新增 */}
<BookSwitcher
  onCreateBook={() => setShowCreateBookModal(true)}
  onOpenSettings={() => router.push('/(tabs)/profile' as any)}
/>

{/* Nav Items */}
<View style={styles.navList}>
  {/* ... */}
</View>
```

### 8.3 创建账本 Modal（CreateBookModal.tsx）

```typescript
type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated: (book: BookResponse) => void;
};

export function CreateBookModal({ visible, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'personal' | 'family'>('personal');
  const [creating, setCreating] = useState(false);
  const { createBook } = useBookStore();

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const book = await createBook(name.trim(), type);
      onCreated(book);
      onClose();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={modalStyles.overlay} onPress={onClose}>
        <View style={[modalStyles.content, { backgroundColor: colors.card }]}
          onStartShouldSetResponder={() => true}>
          <Text style={modalStyles.title}>创建新账本</Text>

          {/* 名称输入 */}
          <View style={modalStyles.fieldRow}>
            <Text style={modalStyles.label}>账本名称</Text>
            <TextInput
              style={modalStyles.input}
              value={name}
              onChangeText={setName}
              placeholder="家庭共享账本"
              autoFocus
            />
          </View>

          {/* 类型选择 */}
          <View style={modalStyles.fieldRow}>
            <Text style={modalStyles.label}>账本类型</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['personal', 'family'] as const).map((t) => (
                <Pressable
                  key={t}
                  style={[modalStyles.chip, type === t && modalStyles.chipActive]}
                  onPress={() => setType(t)}
                >
                  <Text style={type === t ? modalStyles.chipTextActive : modalStyles.chipText}>
                    {t === 'personal' ? '个人' : '家庭'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 按钮 */}
          <View style={modalStyles.btnRow}>
            <Pressable style={[modalStyles.btn, { backgroundColor: colors.border }]} onPress={onClose}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>取消</Text>
            </Pressable>
            <Pressable
              style={[modalStyles.btn, { backgroundColor: name.trim() ? Colors.primary : colors.border }]}
              onPress={handleCreate}
              disabled={!name.trim() || creating}
            >
              {creating ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={{ color: '#FFF', fontWeight: '600' }}>创建</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}
```

遵循 DESIGN_GUIDELINES 第 10 节 Modal 规范：`width: '85%'`, `maxWidth: 420`, `borderRadius: 14`, `padding: 24`。

### 8.4 账本设置面板 BookSettingsPane.tsx

桌面端在"我的"页面右侧 DetailPane 中展示；移动端作为独立路由 `settings/book.tsx`。

#### 8.4.1 区域结构

```
┌──────────────────────────────────┐
│  ← 返回    账本设置              │
├──────────────────────────────────┤
│  账本名称                        │
│  [输入框]    [保存修改]           │
├──────────────────────────────────┤
│  成员（N）                       │
│  [MemberList 组件]               │
│  [邀请成员区域]                   │
├──────────────────────────────────┤
│  危险操作                        │
│  [删除账本] / [退出账本]          │
└──────────────────────────────────┘
```

#### 8.4.2 权限感知

```typescript
const currentRole = useBookStore((s) => s.currentRole);
const currentBook = useBookStore((s) => s.currentBook);
const isOwner = currentBook?.owner_id === currentUser?.id;
const isAdmin = currentRole === 'admin';

// UI 条件渲染
{isAdmin && <RenameSection />}
{isAdmin && <MemberManageSection />}
{isOwner && <DeleteBookButton />}
{!isOwner && <LeaveBookButton />}
```

### 8.5 成员列表 MemberList.tsx

```typescript
type Props = {
  bookId: string;
  isAdmin: boolean;
  ownerId: string;
};

export function MemberList({ bookId, isAdmin, ownerId }: Props) {
  const [members, setMembers] = useState<BookMemberResponse[]>([]);

  useEffect(() => {
    bookService.getMembers(bookId).then(({ data }) => setMembers(data));
  }, [bookId]);

  const handleRemove = async (userId: string) => {
    await bookService.removeMember(bookId, userId);
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    const { data } = await bookService.updateMemberRole(bookId, userId, { role: newRole as 'admin' | 'member' });
    setMembers((prev) => prev.map((m) => m.user_id === userId ? data : m));
  };

  return (
    <View>
      {members.map((m) => (
        <View key={m.user_id} style={styles.memberRow}>
          {/* 头像（首字母） */}
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(m.nickname || m.email)[0].toUpperCase()}
            </Text>
          </View>
          {/* 信息 */}
          <View style={{ flex: 1 }}>
            <Text style={styles.memberName}>
              {m.nickname || m.email}
              {m.is_owner && <Text style={styles.ownerBadge}> (owner)</Text>}
            </Text>
            <Text style={styles.memberEmail}>{m.email}</Text>
          </View>
          {/* 角色标签（可点击切换） */}
          <Pressable
            disabled={!isAdmin || m.is_owner}
            onPress={() => handleRoleChange(m.user_id, m.role === 'admin' ? 'member' : 'admin')}
          >
            <Text style={[styles.roleChip, m.role === 'admin' ? styles.adminChip : styles.memberChip]}>
              {m.role}
            </Text>
          </Pressable>
          {/* 移除按钮 */}
          {isAdmin && !m.is_owner && (
            <Pressable onPress={() => handleRemove(m.user_id)}>
              <Text style={styles.removeBtn}>移除</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}
```

### 8.6 邀请成员 InviteMemberModal.tsx

```typescript
type Props = {
  visible: boolean;
  bookId: string;
  onClose: () => void;
  onInvited: (member: BookMemberResponse) => void;
};

export function InviteMemberModal({ visible, bookId, onClose, onInvited }: Props) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [inviting, setInviting] = useState(false);

  const handleInvite = async () => {
    if (!email.trim()) return;
    setInviting(true);
    try {
      const { data } = await bookService.inviteMember(bookId, { email: email.trim(), role });
      onInvited(data);
      onClose();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || '邀请失败');
    } finally {
      setInviting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      {/* 遵循 DESIGN_GUIDELINES Modal 规范 */}
      {/* 邮箱输入 + 角色选择（Chip）+ 取消/发送邀请 按钮 */}
    </Modal>
  );
}
```

### 8.7 删除账本确认（二次确认）

用户必须输入账本名称才能确认删除：

```typescript
const [confirmName, setConfirmName] = useState('');
const canDelete = confirmName === currentBook?.name;

<Modal visible={showDeleteConfirm} transparent animationType="fade">
  <View style={modalStyles.content}>
    <Text style={modalStyles.title}>删除账本</Text>
    <Text style={styles.dangerText}>
      此操作不可恢复！将永久删除账本「{currentBook?.name}」及其所有科目、分录、预算等数据。
    </Text>
    <Text style={styles.label}>请输入账本名称以确认：</Text>
    <TextInput
      style={modalStyles.input}
      value={confirmName}
      onChangeText={setConfirmName}
      placeholder={currentBook?.name}
    />
    <View style={modalStyles.btnRow}>
      <Pressable style={[modalStyles.btn, { backgroundColor: colors.border }]}
        onPress={() => setShowDeleteConfirm(false)}>
        <Text>取消</Text>
      </Pressable>
      <Pressable
        style={[modalStyles.btn, { backgroundColor: canDelete ? '#EF4444' : colors.border }]}
        onPress={handleDeleteBook}
        disabled={!canDelete}
      >
        <Text style={{ color: '#FFF', fontWeight: '600' }}>删除</Text>
      </Pressable>
    </View>
  </View>
</Modal>
```

### 8.8 profile.tsx 集成

```typescript
// 菜单新增项
{
  key: 'book-settings',
  label: '账本设置',
  icon: 'book',
  onPress: () => {
    if (isDesktop) setDetailPane('book-settings');
    else router.push('/settings/book');
  },
}
```

### 8.9 types.ts 变更

```typescript
export type DetailPane = 'none' | 'edit-profile' | 'settings' | 'accounts' | 'assets' | 'loans' | 'budget' | 'api-keys' | 'plugins' | 'mcp' | 'book-settings';
```

---

## 9. 数据流概览

### 9.1 切换账本

```
用户点击 BookSwitcher → 选择其他账本
  ↓ setCurrentBook(book)
bookStore: currentBook = book, currentRole = book.role
  ↓ 各页面 useEffect 监听 currentBook.id 变化
accountStore.fetchTree(bookId)
entryStore.reset() + fetchEntries(bookId)
Dashboard 重新拉取统计数据
报表清空缓存
```

### 9.2 创建账本

```
用户点击「创建新账本」→ CreateBookModal
  ↓ 填写名称 + 类型 → 点击「创建」
POST /books { name, type }
  ↓ 后端
创建 Book + BookMember(owner, admin) + seed 预置科目
  ↓ 201 响应
前端 fetchBooks() 刷新列表 → setCurrentBook(新账本) → 全局刷新
```

### 9.3 邀请成员

```
admin 在成员管理区输入邮箱 + 选择角色 → 点击「发送邀请」
  ↓
POST /books/{book_id}/members { email, role }
  ↓ 后端
查找用户(email) → 检查重复 → 创建 BookMember
  ↓ 201 响应
前端刷新成员列表 + Toast「已添加 xxx 为成员」
  ↓
被邀请人下次打开 App → GET /books 返回列表包含该账本
```

### 9.4 删除账本

```
owner 在账本设置点击「删除账本」
  ↓ 弹出二次确认 Modal
用户输入账本名称确认 → 点击「删除」
  ↓
DELETE /books/{book_id}
  ↓ 后端
验证 owner → 级联删除 Book + members + accounts + entries + budgets + assets + loans
  ↓ 204 响应
前端 fetchBooks() → 自动切换到列表中第一个账本 / 显示空状态
```

---

## 10. 错误处理

### 10.1 后端错误码映射

| HTTP 状态码 | 场景 | 后端 `detail` | 前端展示 |
|------------|------|--------------|---------|
| 400 | 移除 owner | `不可移除账本创建者` | 原样展示 |
| 400 | 修改 owner 角色 | `不可修改账本创建者的角色` | 原样展示 |
| 400 | owner 退出 | `账本创建者不可退出，请先删除账本` | 原样展示 |
| 400 | 重复邀请 | `该用户已是账本成员` | 原样展示 |
| 403 | 非 admin 操作 | `需要管理员权限` | 原样展示 |
| 403 | 非 owner 删除 | `仅账本创建者可删除` | 原样展示 |
| 403 | 非成员访问 | `无权访问该账本` | 原样展示 |
| 404 | 邮箱未注册 | `该邮箱未注册，请对方先注册` | 原样展示 |
| 404 | 账本不存在 | `账本不存在` | 原样展示 |
| 404 | 成员不存在 | `成员不存在` | 原样展示 |

### 10.2 前端校验

| 校验项 | 实现 |
|--------|------|
| 创建账本名称为空 | 按钮 `disabled={!name.trim()}` |
| 邀请邮箱为空 | 按钮 `disabled={!email.trim()}` |
| 删除确认名称不匹配 | 按钮 `disabled={confirmName !== bookName}` |
| 重复提交 | `creating` / `inviting` state 防抖 |

---

## 11. 测试计划

### 11.1 后端单元测试

#### test_book_management.py

| 编号 | 测试用例 | 预期 |
|------|---------|------|
| BM-1 | `PUT /books/{id}` admin 修改名称 | 200，名称更新 |
| BM-2 | `PUT /books/{id}` member 修改名称 | 403 |
| BM-3 | `DELETE /books/{id}` owner 删除 | 204，级联清除 |
| BM-4 | `DELETE /books/{id}` admin（非 owner）删除 | 403 |
| BM-5 | `DELETE /books/{id}` member 删除 | 403 |
| BM-6 | `GET /books` 返回含 role 字段 | role 为 admin 或 member |
| BM-7 | 删除账本后关联科目/分录全部清除 | 查询返回空 |

#### test_book_members.py

| 编号 | 测试用例 | 预期 |
|------|---------|------|
| MM-1 | admin 邀请已注册用户 | 201，成员加入 |
| MM-2 | admin 邀请未注册邮箱 | 404，`该邮箱未注册` |
| MM-3 | admin 重复邀请 | 400，`该用户已是账本成员` |
| MM-4 | member 尝试邀请 | 403 |
| MM-5 | admin 移除 member | 204 |
| MM-6 | admin 移除 owner | 400 |
| MM-7 | member 尝试移除 | 403 |
| MM-8 | admin 修改 member → admin | 200，角色更新 |
| MM-9 | admin 修改 owner 角色 | 400 |
| MM-10 | member 退出 | 204，不再可见 |
| MM-11 | owner 退出 | 400 |
| MM-12 | member 操作科目管理 | 403 |
| MM-13 | member 正常记账 | 201 |
| MM-14 | 被邀请人 GET /books 可见新账本 | 列表包含该账本 |
| MM-15 | admin 操作预算管理 | 200 |
| MM-16 | member 操作预算管理 | 403 |

### 11.2 手动测试场景

| 编号 | 场景 | 步骤 | 预期结果 |
|------|------|------|---------|
| T-1 | 账本切换器展示 | 打开 App | Sidebar / TopBar 显示当前账本名和角色 |
| T-2 | 切换账本 | 点击账本名 → 选择其他账本 | 全局数据切换（科目树、分录列表等） |
| T-3 | 创建账本 | 切换器 → 创建新账本 → 填表 → 创建 | 新账本出现在列表，自动切换 |
| T-4 | 重命名账本 | 账本设置 → 修改名称 → 保存 | 名称更新，切换器同步 |
| T-5 | 删除账本 | 账本设置 → 删除 → 输入名称确认 | 账本删除，自动切换到其他账本 |
| T-6 | 邀请成员 | 账本设置 → 输入邮箱 → 发送邀请 | Toast 提示成功，成员列表更新 |
| T-7 | 移除成员 | 成员列表 → 点击移除 → 确认 | 成员消失 |
| T-8 | 修改角色 | 成员列表 → 点击角色标签 | admin ↔ member 切换 |
| T-9 | 退出账本 | 非 owner 在设置页点退出 | 账本列表不再显示 |
| T-10 | member 权限 | 以 member 身份访问科目管理 | 创建/编辑/停用按钮不可见 |
| T-11 | member 记账 | 以 member 身份创建分录 | 正常创建成功 |
| T-12 | 数据隔离 | 在账本 A 记账，切换到账本 B | 账本 B 无新分录 |
| T-13 | 桌面端一致性 | 桌面端执行 T-1 ~ T-12 | 行为与移动端一致 |

---

## 12. 开发实施计划

### 阶段 1：后端 Schema + Service（预计 1 天）

1. 扩展 `schemas/book.py`：新增 4 个 Schema，修改 `BookResponse`
2. 扩展 `services/book_service.py`：新增 8 个方法（CRUD + 权限）
3. 编写 `test_book_management.py` 和 `test_book_members.py`
4. 运行测试确认通过

### 阶段 2：后端 Router + 权限（预计 1 天）

1. 扩展 `routers/books.py`：新增 7 个端点
2. 新增 `deps.py` 权限依赖（`require_book_admin` / `require_book_member`）
3. 各 admin-only router 增加权限校验
4. 修改 `GET /books` 返回 role
5. Swagger 测试全部新端点

### 阶段 3：前端 Service + Store（预计 0.5 天）

1. 扩展 `bookService.ts`：新增 7 个 API 方法 + 类型定义
2. 改造 `bookStore.ts`：增加 `currentRole`、`createBook`、`updateBook`、`deleteBook`
3. 验证数据流

### 阶段 4：前端账本切换器（预计 1 天）

1. 实现 `BookSwitcher.tsx`（桌面端 Dropdown + 移动端 BottomSheet）
2. 实现 `CreateBookModal.tsx`
3. 集成到 `Sidebar.tsx` 和 `_layout.tsx`
4. 实现切换后全局刷新（各页面 useEffect 监听）

### 阶段 5：前端账本设置 + 成员管理（预计 1.5 天）

1. 实现 `BookSettingsPane.tsx`（桌面端面板）
2. 实现 `settings/book.tsx`（移动端页面）
3. 实现 `MemberList.tsx`
4. 实现 `InviteMemberModal.tsx`
5. 实现删除确认（二次确认 Modal）和退出确认
6. 集成到 `profile.tsx`，新增 `DetailPane` 类型

### 阶段 6：权限感知 UI（预计 0.5 天）

1. 各管理页面根据 `currentRole` 隐藏/禁用无权操作
2. 科目管理：member 隐藏创建/编辑/停用按钮
3. 预算/资产/贷款管理：member 隐藏操作按钮
4. 账本设置：member 只能看到退出按钮

### 阶段 7：测试 & 验证（预计 0.5 天）

1. 后端全量测试（`pytest -n auto`）
2. 手动测试全场景（T-1 ~ T-13）
3. 桌面端/移动端一致性验证
4. 数据隔离端到端测试

---

### 总体时间估算

| 阶段 | 内容 | 预计工时 | 累计 |
|------|------|---------|------|
| 1 | 后端 Schema + Service | 1 天 | 1 天 |
| 2 | 后端 Router + 权限 | 1 天 | 2 天 |
| 3 | 前端 Service + Store | 0.5 天 | 2.5 天 |
| 4 | 前端账本切换器 | 1 天 | 3.5 天 |
| 5 | 前端账本设置 + 成员管理 | 1.5 天 | 5 天 |
| 6 | 权限感知 UI | 0.5 天 | 5.5 天 |
| 7 | 测试 & 验证 | 0.5 天 | 6 天 |

> v0.3.0 总计约 **6 个工作日**。

---

## 13. 注意事项

### 13.1 DESIGN_GUIDELINES 遵循

| 规范 | 本版本应用 |
|------|-----------|
| 第 1 节 — 提示反馈 | 邀请成功/失败、删除成功等统一 `showToast` |
| 第 2 节 — 确认弹窗 | 删除账本、移除成员、退出账本统一 `<Modal>` 确认 |
| 第 3 节 — 面板内导航 | 桌面端 BookSettingsPane 在 profile 右侧面板内展示 |
| 第 10 节 — Modal 尺寸 | `width: '85%'`, `maxWidth: 420`, `borderRadius: 14`, `padding: 24` |

### 13.2 已知边界情况

| 场景 | 处理 |
|------|------|
| 只剩一个账本且为 owner | 允许删除，删除后显示空状态 + 引导创建 |
| 被移除后 App 未刷新 | 后端始终校验权限返回 403，前端 catch 后 fetchBooks 刷新 |
| 切换账本时网络慢 | 各 Store 独立 loading 状态，UI 展示 skeleton |
| 多人同时编辑成员列表 | 最后写入胜出，前端操作后立即刷新列表 |
| 删除账本后其他成员的 currentBook | 其他成员 fetchBooks 时 currentBook 会自动回退到第一个 |
| 邀请自己 | 创建时已自动加入，重复邀请会返回 400 |

### 13.3 级联删除验证

`Book` 模型已配置 `cascade="all, delete-orphan"`，删除账本时会自动级联删除：
- `book_members` — 所有成员记录
- `accounts` — 所有科目
- `journal_entries` — 所有分录（含 journal_lines）

需额外确认 `budgets`、`fixed_assets`、`loans`、`data_sources` 的级联关系是否已配置。如未配置，需在 `Book` 模型中补充 relationship 或在 `delete_book` service 中手动删除。
