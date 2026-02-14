from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import init_db
from app.routers import auth, books, accounts, entries, reports, sync, assets, loans, budgets, api_keys, plugins

# 导入所有 model 使 SQLAlchemy 注册表结构
import app.models  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时建表"""
    await init_db()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="家庭记账后端 API - 基于复式记账法的家庭财务管理",
    lifespan=lifespan,
)

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 统一异常处理
@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc), "code": "VALIDATION_ERROR"})


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": "服务器内部错误", "code": "INTERNAL_ERROR"})


# 注册路由
app.include_router(auth.router)
app.include_router(books.router)
app.include_router(accounts.router)
app.include_router(entries.router)
app.include_router(reports.router)
app.include_router(sync.router)
app.include_router(assets.router)
app.include_router(loans.router)
app.include_router(budgets.router)
app.include_router(api_keys.router)
app.include_router(plugins.router)


@app.get("/health", tags=["系统"])
async def health_check():
    """健康检查接口"""
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }
