# v0.3.1 技术方案 — 注册邀请码验证

## 变更清单

### 后端（3 个文件）

| 文件 | 变更 |
|------|------|
| `server/app/config.py` | 新增 `INVITE_CODE: str = ""` 配置项 |
| `server/app/schemas/auth.py` | `RegisterRequest` 增加 `invite_code: str` 字段 |
| `server/app/services/auth_service.py` | `register_user` 增加邀请码校验，空配置时跳过 |

### 前端（3 个文件）

| 文件 | 变更 |
|------|------|
| `client/services/authService.ts` | `RegisterParams` 增加 `invite_code` 字段 |
| `client/stores/authStore.ts` | 无需改动（透传 params） |
| `client/app/(auth)/register.tsx` | 新增邀请码输入框 |

### 测试（2 个文件）

| 文件 | 变更 |
|------|------|
| `server/tests/conftest.py` | `settings.INVITE_CODE` 在测试环境设为固定值 |
| `server/tests/test_auth.py` | 所有注册请求加 `invite_code`，新增邀请码校验用例 |

## 实现细节

### 后端校验逻辑

```python
def verify_invite_code(code: str):
    if not settings.INVITE_CODE:
        return  # 未配置则跳过
    if code.upper() != settings.INVITE_CODE.upper():
        raise AuthError("邀请码无效", status_code=403)
```

### 测试策略

- conftest 中通过 monkeypatch 或直接设置 `settings.INVITE_CODE = "TEST01"`
- 所有已有注册测试加 `"invite_code": "TEST01"`
- 新增用例：错误邀请码 → 403，空邀请码 → 422
