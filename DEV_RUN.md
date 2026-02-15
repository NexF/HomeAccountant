# 开发环境启动

## 后端 (FastAPI)

```bash
cd server
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

## 前端 (Expo Web)

```bash
cd client
npx expo start --web --port 8081
```

## 访问地址

- 前端: http://localhost:8081
- 后端: http://127.0.0.1:8000
- API 文档: http://127.0.0.1:8000/docs
