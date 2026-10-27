# config.py
import os
from datetime import timedelta

from dotenv import load_dotenv
from flask import current_app

load_dotenv()

# AI 能力标识（与 app/services/ai.py 的 ABILITY_SPECS、前端 editor.js 的 AI_ABILITIES 一致）。
# 是「能力级配置」的取值来源：AI_API_KEY_<ABILITY> / AI_MODEL_<ABILITY> / AI_DAILY_LIMIT_<ABILITY>。
# ⚠️ 新增 AI 能力时必须同步这里，否则该能力的 AI_XXX_<能力> 覆盖**静默失效**
#（`ai_api_key` / `ai_model` / `ai_daily_limit` 都读本表构造的 AI_ABILITY_OVERRIDES，
# 表里没有的 key 一律回落全局值 —— 不报错，只是覆盖不生效，极难察觉）。
AI_ABILITY_KEYS = ("matting", "style", "enhance", "beauty", "background", "hair")


def _env_or(name: str, default: str = "") -> str:
    """读环境变量，并把**空串当作未配置**（回落默认值）。

    为什么需要这一层：`.env.example` 里 `AI_MODEL=` 这种「留空表示用默认」的写法会把变量
    设成空串，而 `os.getenv(NAME, default)` 只在**键不存在**时才返回默认值 —— 键存在但为空
    时返回 ''。于是模型名 / base 地址变成空串：
      - 图像能力：拼出相对 URL，requests 抛 MissingSchema，被当作「可重试的网络错误」重试后
        统一返回 3002「AI 处理失败」；
      - 对话 / 语音：`compatible_chat()` 直接抛「未配置 AI_CHAT_API_BASE」→ 3002。
    两者都无法从错误码看出是配置问题。本函数让「留空」与「未配置」等价（见 README 10 章）。
    """
    return (os.getenv(name) or "").strip() or default


class Config:
    """基础配置"""
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=2)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)

    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # 微信小程序配置（预留，微信一键登录使用）
    WECHAT_APPID = os.getenv("WECHAT_APPID", "")
    WECHAT_SECRET = os.getenv("WECHAT_SECRET", "")

    # 上传配置
    UPLOAD_DIR = os.getenv("UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "uploads"))
    MAX_UPLOAD_SIZE = int(os.getenv("MAX_UPLOAD_SIZE", 10 * 1024 * 1024))  # 默认 10MB
    ALLOWED_IMAGE_EXT = {"jpg", "jpeg", "png", "webp"}
    THUMB_SIZE = (400, 400)

    # AI 能力配置（默认走阿里云百炼 DashScope，服务商无关，更换时只改 services）
    AI_API_KEY = _env_or("AI_API_KEY")
    AI_API_BASE = _env_or("AI_API_BASE", "https://dashscope.aliyuncs.com/api/v1")
    # 默认用**指令编辑系列**而不是通用生成模型：同一份输入 + 同一句指令实测（2026-10，1200×900 输入）
    #   qwen-image-2.0-pro    → 出图 14.0s，输出 1024×1024（按输入比例归一化到 ~1.05MP）
    #   qwen-image-2.1-pro    → 出图 28.0s，输出 2048×2048（4.2MP，带 alpha）
    #   qwen-image-3.0        → 出图 43.3s，输出 2048×2048（4.2MP）
    #   qwen-image-3.0-pro    → 出图 85.2s，输出 2064×2016（4.2MP）
    # 原默认 qwen-image-edit-plus（2026-09 实测 9.8s）已被百炼**下线**（2026-10 起调用报 404 Model not exist），
    # 换成输出规格完全一致的 qwen-image-2.0-pro（竖图 1134×2016 → 768×1376，与旧模型逐像素同尺寸）。
    # 「换模型」仍是这里唯一的数量级提速手段（降入参分辨率几乎无效、下载只占几秒）。
    # 需要更高分辨率时把本项换成 qwen-image-2.1-pro / qwen-image-3.0-pro
    # （或只给某个能力用 AI_MODEL_<能力> 单独指定），见 README 7.3 / M28 / M51。
    AI_MODEL = _env_or("AI_MODEL", "qwen-image-2.0-pro")
    # 连接/读取超时（秒）。读取取 300s：2026-09 实测单张 1200×900 输入出图耗时 66~122s，
    # 真机大图更慢，180s 会在高分辨率下偶发超时（表现为 3002）；小程序侧上传超时同步放宽
    AI_TIMEOUT = (10, 300)
    AI_RETRY = 2  # 网络类错误重试次数（仅「请求没发出去」的连接类故障；读超时不重试）
    # 单次 AI 能力的**生成阶段总预算**（秒，含所有重试与异步轮询）。
    # 它与小程序端的等待必须成对取值（见 README 7.x「耗时预算」）：
    #   服务端最坏耗时 ≈ AI_TOTAL_TIMEOUT(240) + 结果图下载(≤30) = 270s
    #   < 小程序 networkTimeout.uploadFile(300s) < 前端 AI_UPLOAD_TIMEOUT(360s)
    # 2026-09 实测出现过「上游出图 ~300s、小程序 300s 先超时」：客户端已放弃连接，
    # 服务端随后才出图并落库，用户看到失败却在「我的作品」里多出一张图（且照样计费）。
    # 结果图下载不计入该预算（图已出好，不该因为预算刚好用完而丢弃）。
    # 真机网络慢时可同步调大本项与前端 AI_UPLOAD_TIMEOUT / app.json uploadFile。
    AI_TOTAL_TIMEOUT = int(os.getenv("AI_TOTAL_TIMEOUT", 240))
    # 每用户每日 AI 调用上限（全局缺省值，可被 AI_DAILY_LIMIT_<能力> 按能力覆盖）
    AI_DAILY_LIMIT = int(os.getenv("AI_DAILY_LIMIT", 20))
    # 送 AI 前把图片长边缩到该上限（图生图要把图片 base64 内联进 JSON，太大易超时）；0/负数不缩放
    AI_MAX_EDGE = int(os.getenv("AI_MAX_EDGE", 2048))
    # 按能力可选覆盖（缺省空串 → 回落上面的全局值）：
    #   AI_API_KEY_MATTING / AI_MODEL_BEAUTY / AI_DAILY_LIMIT_STYLE ...
    # 用途：将来想给某个能力单独换密钥、换模型或单独收紧配额时只加一行 .env，代码不动。
    # 注意：拆密钥**不构成能力隔离**（同一账号下任意密钥都能调该账号任意模型），
    # 真正防止「某能力越界干别的」靠的是服务端固定指令 + 风格白名单（见 README 7.3）。
    AI_ABILITY_OVERRIDES = {
        ability: {
            "api_key": os.getenv(f"AI_API_KEY_{ability.upper()}", ""),
            "model": os.getenv(f"AI_MODEL_{ability.upper()}", ""),
            "daily_limit": os.getenv(f"AI_DAILY_LIMIT_{ability.upper()}", ""),
        }
        for ability in AI_ABILITY_KEYS
    }

    # ===== AI 临时图自动回收（见 README 7.5）=====
    # 后端启动后由后台守护线程定期回收 uploads/ai/ 下不再被引用的临时图（判定逻辑同 cleanup_temp.py）
    # 设 AUTO_CLEANUP=0 可关闭自动线程（改用系统计划任务 / 容器 sidecar 跑 cleanup_temp.py）
    AUTO_CLEANUP_ENABLED = os.getenv("AUTO_CLEANUP", "1").strip().lower() not in ("0", "false", "no", "")
    # 两次回收的最小间隔（小时）与首次执行前的延迟（秒，避开启动期）
    AUTO_CLEANUP_INTERVAL_HOURS = float(os.getenv("AUTO_CLEANUP_INTERVAL_HOURS", 6))
    AUTO_CLEANUP_FIRST_DELAY_SEC = float(os.getenv("AUTO_CLEANUP_FIRST_DELAY_SEC", 60))
    # 保留期（按文件 mtime 计算）：无引用的临时图 / 仅被对话消息引用的图
    AI_TEMP_KEEP_HOURS = float(os.getenv("AI_TEMP_KEEP_HOURS", 24))
    AI_TEMP_CHAT_KEEP_HOURS = float(os.getenv("AI_TEMP_CHAT_KEEP_HOURS", 168))

    # ===== 对话链路配置（「AI 智能处理」聊天页，见 README 7.4）=====
    # 与上面的「图像能力」并列的另一条链路：文本对话 + 语音识别走百炼 **OpenAI 兼容端点**，
    # 出图仍走上面的原生 AI_API_BASE（image_edit）。两者不混用：
    #   - 原生 /api/v1：只有多模态生成（图→图），没有 chat 接口；
    #   - 兼容 /compatible-mode/v1：chat/completions，文本对话与 ASR 都在这里。
    # 为什么必须另起一个文本模型：AI_MODEL(qwen-image-*) 是**图像编辑模型**，只接受
    # 「图 + 文 → 图」，做不了纯文本对话（见 README M39）。
    AI_CHAT_API_BASE = _env_or(
        "AI_CHAT_API_BASE", "https://dashscope.aliyuncs.com/compatible-mode/v1"
    )
    AI_CHAT_MODEL = _env_or("AI_CHAT_MODEL", "qwen-plus")
    # 语音识别模型（2026-10 实测：qwen3-asr-flash 可用，约 2s 出中文字幕；
    # 音频**必须**以 data URI 形式内联传入，裸 base64 会被上游判为非法 URL 而 400）
    AI_ASR_MODEL = _env_or("AI_ASR_MODEL", "qwen3-asr-flash")
    # 单次对话/识别的读取超时（秒）：文本是秒级短请求，与图像能力的 240s 预算无关
    AI_CHAT_TIMEOUT = int(os.getenv("AI_CHAT_TIMEOUT", 60))
    # 送模型的**历史消息条数**上限（user+ai 各算一条；20 条 = 约 10 轮）。
    # 取值权衡：太小会让模型「失忆」（用户说「再来一次」「把海星也去掉」时接不上），
    # 太大则 token 与耗时随会话线性增长。意图门与表达门共用这个窗口（见 README 7.4）
    AI_CHAT_MAX_TURNS = int(os.getenv("AI_CHAT_MAX_TURNS", 20))
    # 对话与「对话内出图」的每用户每日上限（缺省回落全局 AI_DAILY_LIMIT，见 chat_daily_limit）
    AI_CHAT_OVERRIDES = {
        "chat": os.getenv("AI_DAILY_LIMIT_CHAT", ""),
        "chat_edit": os.getenv("AI_DAILY_LIMIT_CHAT_EDIT", ""),
    }


class DevConfig(Config):
    """开发环境"""
    DEBUG = True
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://root:password@localhost:3306/rs2_db?charset=utf8mb4",
    )


class ProdConfig(Config):
    """生产环境"""
    DEBUG = False
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL")


config_map = {
    "development": DevConfig,
    "production": ProdConfig,
}

# 生产环境必须显式配置的项（见 README 十「安全红线」：SECRET_KEY / JWT_SECRET_KEY 必填且
# 严禁使用默认值；数据库连接串同样不能缺）
_REQUIRED_IN_PRODUCTION = ("SECRET_KEY", "JWT_SECRET_KEY", "DATABASE_URL")


def _require_production_config() -> None:
    """FLASK_ENV=production 时强制关键配置来自环境变量，缺失直接启动失败。

    否则会静默套用本文件里公开可见的 `dev-*` 默认密钥签发/校验 JWT ——
    等于生产环境的登录凭证可被任意伪造，且没有任何提示。
    """
    missing = [name for name in _REQUIRED_IN_PRODUCTION if not (os.getenv(name) or "").strip()]
    if missing:
        raise RuntimeError(
            "生产环境（FLASK_ENV=production）缺少必需的环境变量：" + "、".join(missing)
        )


def get_config():
    env = os.getenv("FLASK_ENV", "development")
    if env == "production":
        _require_production_config()
    return config_map.get(env, DevConfig)


# ===== 能力级 AI 配置解析（单一权威，api 与 services 都从这里取）=====
# 回落规则：AI_XXX_<ABILITY>（非空）→ AI_XXX（全局）。
# 这些函数需要应用上下文（读的是已加载的 Flask 配置，而不是当场读 env）。

def _ability_override(ability: str, field: str) -> str:
    """取某能力的覆盖值；未配置返回空串（表示回落全局）。"""
    overrides = current_app.config.get("AI_ABILITY_OVERRIDES") or {}
    return ((overrides.get(ability) or {}).get(field) or "").strip()


def ai_global_key() -> str:
    """全局 AI 密钥（图像能力与对话链路共用同一个 key，也是能力级覆盖的回落目标）。"""
    return current_app.config.get("AI_API_KEY") or ""


def ai_api_key(ability: str) -> str:
    """能力级 AI 密钥：AI_API_KEY_<ABILITY> 覆盖，缺省回落全局 AI_API_KEY。"""
    return _ability_override(ability, "api_key") or ai_global_key()


def ai_global_model() -> str:
    """全局图像编辑模型（能力级覆盖的回落目标）。"""
    return current_app.config.get("AI_MODEL") or ""


def ai_model(ability: str) -> str:
    """能力级模型名：AI_MODEL_<ABILITY> 覆盖，缺省回落全局 AI_MODEL。"""
    return _ability_override(ability, "model") or ai_global_model()


def _override_limit(raw, env_name: str) -> int:
    """解析「可覆盖的每日上限」：合法正整数用自己的，否则回落全局 AI_DAILY_LIMIT 并告警。

    覆盖值非法（空/非数字/≤0）时回落而不是锁死 —— 写错一个数不该让功能不可用。
    """
    if raw:
        try:
            value = int(str(raw).strip())
        except ValueError:
            value = 0
        if value > 0:
            return value
        current_app.logger.warning("%s 非法（%r），回落全局上限", env_name, raw)
    return int(current_app.config.get("AI_DAILY_LIMIT") or 20)


def ai_daily_limit(ability: str) -> int:
    """能力级每用户每日上限：AI_DAILY_LIMIT_<ABILITY> 覆盖，缺省回落全局 AI_DAILY_LIMIT。"""
    return _override_limit(
        _ability_override(ability, "daily_limit"), f"AI_DAILY_LIMIT_{ability.upper()}"
    )


# ===== 对话链路配置解析（「AI 智能处理」聊天页，见 README 7.4）=====

def chat_api_base() -> str:
    """对话/语音识别用的 OpenAI 兼容端点（与图像能力的原生 AI_API_BASE 分开）。"""
    return (current_app.config.get("AI_CHAT_API_BASE") or "").rstrip("/")


def chat_model() -> str:
    """文本对话模型（默认 qwen-plus）。"""
    return current_app.config.get("AI_CHAT_MODEL") or "qwen-plus"


def asr_model() -> str:
    """语音识别模型（默认 qwen3-asr-flash）。"""
    return current_app.config.get("AI_ASR_MODEL") or "qwen3-asr-flash"


def chat_max_turns() -> int:
    """送模型的历史轮数上限（≤0 时不带历史）。"""
    try:
        return int(current_app.config.get("AI_CHAT_MAX_TURNS") or 0)
    except (TypeError, ValueError):
        return 0


def chat_timeout() -> int:
    """对话/识别的读取超时（秒）。"""
    try:
        return int(current_app.config.get("AI_CHAT_TIMEOUT") or 60)
    except (TypeError, ValueError):
        return 60


def chat_daily_limit() -> int:
    """每用户每日**对话轮数**上限（AI_DAILY_LIMIT_CHAT → 全局 AI_DAILY_LIMIT）。"""
    raw = (current_app.config.get("AI_CHAT_OVERRIDES") or {}).get("chat")
    return _override_limit(raw, "AI_DAILY_LIMIT_CHAT")


def chat_edit_daily_limit() -> int:
    """每用户每日**对话内出图**次数上限（AI_DAILY_LIMIT_CHAT_EDIT → 全局 AI_DAILY_LIMIT）。"""
    raw = (current_app.config.get("AI_CHAT_OVERRIDES") or {}).get("chat_edit")
    return _override_limit(raw, "AI_DAILY_LIMIT_CHAT_EDIT")
