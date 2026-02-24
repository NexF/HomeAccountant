# 部署指南

## 架构

```
前端 (accountant.nex.cab)  ──HTTPS──→  Nginx / 静态托管
后端 (accapi.nex.cab)      ──HTTPS──→  Nginx ──反代──→ Docker 容器 (:8000)
```

前后端独立域名，通过 CORS 通信。

## 后端部署

### Docker Compose（推荐）

```bash
cd server/docker
docker compose up -d --build
```

### 手动构建镜像

```bash
cd server
docker build -t home-accountant-server -f docker/Dockerfile .
```

### 手动运行容器

```bash
# 生成 JWT 密钥
export JWT_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(64))')"

# 启动
docker run -d \
  -p 8000:8000 \
  -v $(pwd)/data:/app/data \
  -e JWT_SECRET_KEY="$JWT_SECRET" \
  -e CORS_ORIGINS='["https://accountant.nex.cab"]' \
  --restart unless-stopped \
  --name home-accountant \
  home-accountant-server
```

## 环境变量

在 `server/docker/.env` 中配置：

```env
JWT_SECRET_KEY=你的随机密钥
CORS_ORIGINS=["https://accountant.nex.cab"]
```

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `JWT_SECRET_KEY` | JWT 签名密钥（**必改**） | `dev-secret-key-change-in-production` |
| `CORS_ORIGINS` | 允许跨域的前端地址（JSON 数组） | `["*"]` |
| `DATABASE_DIR` | SQLite 数据库存放目录 | `/app/data` |
| `DEBUG` | 调试模式 | `false` |

生成密钥：

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
```

## 前端构建

```bash
cd client
npx expo export --platform web
cp -r dist/* /var/www/accountant/
```

构建产物输出到 `client/dist/`，需同步到 Nginx 静态目录 `/var/www/accountant/`。

## Nginx 参考配置

### 后端（accapi.nex.cab）

```nginx
server {
    listen 443 ssl;
    server_name accapi.nex.cab;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 前端（accountant.nex.cab）

```nginx
server {
    listen 443 ssl;
    server_name accountant.nex.cab;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    root /path/to/client/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## 数据持久化

SQLite 数据库通过 volume 挂载到 `server/data/`，容器删除后数据不丢失。

## 健康检查

```bash
curl https://accapi.nex.cab/health
```
