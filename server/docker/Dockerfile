FROM python:3.11-slim

WORKDIR /app

# 系统依赖（slim 镜像缺少部分编译工具）
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc && \
    rm -rf /var/lib/apt/lists/*

# 先复制依赖文件，利用 Docker 缓存
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY app/ app/

# 创建数据目录（用于 SQLite 持久化，运行时挂载 volume）
RUN mkdir -p /app/data

# 环境变量（生产环境通过 -e 或 .env 覆盖）
ENV DATABASE_DIR=/app/data \
    DEBUG=false \
    JWT_SECRET_KEY=change-me-in-production \
    CORS_ORIGINS='["*"]'

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
