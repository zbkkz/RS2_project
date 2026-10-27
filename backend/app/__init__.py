# app/__init__.py
from flask import Flask, request

from config import get_config


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(get_config())

    from app.extensions import cors, db, jwt, migrate

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    cors.init_app(app, resources={r"/api/*": {"origins": "*"}})

    from app import models  # noqa: F401 确保所有模型被加载，供 Flask-Migrate 识别

    from app.api import api_bp
    from app.api.static_files import static_files_bp

    app.register_blueprint(api_bp)
    app.register_blueprint(static_files_bp)

    from app.utils.response import error

    # JWT 错误统一处理
    @jwt.expired_token_loader
    def expired_token_callback(jwt_header, jwt_payload):
        return error(code=4001, msg="登录已过期，请重新登录", http_status=401)

    @jwt.invalid_token_loader
    def invalid_token_callback(reason):
        return error(code=4002, msg="无效的登录凭证", http_status=401)

    @jwt.unauthorized_loader
    def unauthorized_callback(reason):
        return error(code=4003, msg="请先登录", http_status=401)

    # ===== 统一异常出口（框架级错误码段 5000-5999，登记在 6.1） =====
    # 没有这两层 handler 时，框架级错误会返回 Flask 默认的 **HTML** 页面：
    # 前端 request.js 解包拿不到 body.code，只能落到「请求失败」这类无法定位的提示上，
    # 而且它还会把 6.1「所有接口返回 JSON」的契约撕开一个口子（见 11.3 第 44 / 60 条）。
    from werkzeug.exceptions import HTTPException

    # 常见框架级状态码 → 业务码 / 中文文案（未列出的统一按 5000 +「请求失败」）
    http_code_map = {400: 5003, 404: 5001, 405: 5002}
    http_message_map = {400: "请求格式错误", 404: "接口不存在", 405: "请求方法不允许"}

    @app.errorhandler(HTTPException)
    def handle_http_exception(e):
        """4xx/5xx 的框架级异常（路由不存在、方法不允许、请求体不是合法 JSON 等）。"""
        code = http_code_map.get(e.code, 5000)
        # 框架自带的 description 是英文短语（"The method is not allowed for the requested URL."），
        # 而 msg 会被前端直接弹给用户（request.js 用 err.message 兜底），因此这里只把它写进日志
        app.logger.warning("框架级错误 %s %s：%s", e.code, request.path, e.description)
        return error(code=code, msg=http_message_map.get(e.code, "请求失败"), http_status=e.code)

    @app.errorhandler(Exception)
    def handle_unexpected_exception(e):
        """未预期异常：对外只给通用文案（不泄露堆栈/SQL），对内记完整堆栈。"""
        app.logger.exception("未处理异常：%s", e)
        db.session.rollback()  # 丢弃可能只写了一半的事务，避免脏状态串到下一个请求
        return error(code=5000, msg="服务器内部错误", http_status=500)

    return app
