# 服务端部署指南

## Docker Compose（推荐）

```bash
cd server/docker
docker compose up -d --build
```

## 手动构建镜像

```bash
cd server
docker build -t home-accountant-server -f docker/Dockerfile .
```

## 手动运行容器

```bash
# 生成 JWT 密钥
export JWT_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(64))')"

# 启动
docker run -d \
  -p 8000:8000 \
  -v $(pwd)/data:/app/data \
  -e JWT_SECRET_KEY="$JWT_SECRET" \
  -e CORS_ORIGINS='["https://你的前端域名"]' \
  --restart unless-stopped \
  --name home-accountant \
  home-accountant-server
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `JWT_SECRET_KEY` | JWT 签名密钥（**必改**） | `dev-secret-key-change-in-production` |
| `CORS_ORIGINS` | 允许跨域的前端地址（JSON 数组） | `["*"]` |
| `DATABASE_DIR` | SQLite 数据库存放目录 | `/app/data` |
| `DEBUG` | 调试模式 | `false` |

## 数据持久化

SQLite 数据库存储在容器内 `/app/data` 目录，务必通过 `-v` 挂载宿主机目录，否则容器删除后数据丢失。

## 健康检查

```bash
curl http://localhost:8000/health
```
