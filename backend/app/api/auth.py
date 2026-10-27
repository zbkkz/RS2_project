# app/api/auth.py
import re

import requests
from flask import current_app
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    get_jwt_identity,
    jwt_required,
)
from sqlalchemy.exc import IntegrityError

from app.api import api_bp
from app.extensions import db
from app.models import User
from app.services import storage
from app.utils.params import json_body, str_field
from app.utils.response import error, success

PHONE_PATTERN = re.compile(r"^1[3-9]\d{9}$")
# 账号规则：字母开头，4-20 位，可含字母/数字/下划线
USERNAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]{3,19}$")


def _issue_tokens(user: User):
    """为用户签发双 token"""
    identity = str(user.id)
    return {
        "access_token": create_access_token(identity=identity),
        "refresh_token": create_refresh_token(identity=identity),
    }


@api_bp.post("/auth/register")
def register():
    """账号 + 用户名 + 密码注册（手机号可选绑定）"""
    data = json_body()
    username = str_field(data, "username")
    nickname = str_field(data, "nickname")
    password = str_field(data, "password")
    phone = str_field(data, "phone") or None

    if not USERNAME_PATTERN.match(username):
        return error(code=1010, msg="账号格式不正确（字母开头，4-20位字母/数字/下划线）")
    if not nickname:
        return error(code=1012, msg="用户名不能为空")
    # 与 PUT /api/auth/profile 保持一致：字段长度先于入库校验，
    # 否则超长昵称会触发数据库异常、返回非统一格式的 500
    if len(nickname) > 64:
        return error(code=1012, msg="用户名长度不能超过64位")
    if len(password) < 6:
        return error(code=1002, msg="密码长度不能少于6位")
    if phone:
        if not PHONE_PATTERN.match(phone):
            return error(code=1001, msg="手机号格式不正确")
        if User.query.filter_by(phone=phone).first():
            return error(code=1003, msg="该手机号已被绑定")
    if User.query.filter_by(username=username).first():
        return error(code=1011, msg="该账号已被注册")

    user = User(username=username, nickname=nickname, phone=phone)
    user.set_password(password)
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError:
        # 上面按 username/phone 的查询是 check-then-insert：并发注册同一账号（或同一手机号）时
        # 两个请求会同时通过检查，只有先落库的那条能成功，后一条由唯一约束拦下。
        # 不接这个异常就会冒泡成全局兜底的 5000，与 6.1 的业务码约定不一致（口径同 templates.py 的点赞）
        db.session.rollback()
        return error(code=1011, msg="该账号已被注册")

    tokens = _issue_tokens(user)
    return success(data={**tokens, "user": user.to_dict()}, msg="注册成功", http_status=201)


@api_bp.post("/auth/login")
def login():
    """账号 + 密码登录"""
    data = json_body()
    username = str_field(data, "username")
    password = str_field(data, "password")

    if not username or not password:
        return error(code=1004, msg="账号和密码不能为空")

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return error(code=1005, msg="账号或密码错误", http_status=401)

    tokens = _issue_tokens(user)
    return success(data={**tokens, "user": user.to_dict()}, msg="登录成功")


@api_bp.post("/auth/reset-password")
def reset_password():
    """忘记密码：账号 + 新密码直接重置（开发期简化方案，无短信验证）"""
    data = json_body()
    username = str_field(data, "username")
    new_password = str_field(data, "new_password")

    if not username or not new_password:
        return error(code=1013, msg="账号和新密码不能为空")
    if len(new_password) < 6:
        return error(code=1002, msg="密码长度不能少于6位")

    user = User.query.filter_by(username=username).first()
    if not user:
        return error(code=1006, msg="用户不存在", http_status=404)

    user.set_password(new_password)
    db.session.commit()
    return success(msg="密码重置成功")


@api_bp.post("/auth/refresh")
@jwt_required(refresh=True)
def refresh():
    """使用 refresh token 换取新的 access token"""
    user_id = get_jwt_identity()
    return success(data={"access_token": create_access_token(identity=user_id)})


@api_bp.get("/auth/profile")
@jwt_required()
def profile():
    """获取当前登录用户信息"""
    user_id = get_jwt_identity()
    user = db.session.get(User, int(user_id))
    if not user:
        return error(code=1006, msg="用户不存在", http_status=404)
    return success(data=user.to_dict())


@api_bp.put("/auth/profile")
@jwt_required()
def update_profile():
    """更新当前用户资料：昵称（必填）、头像（可选，/uploads/... 相对路径）"""
    user_id = get_jwt_identity()
    user = db.session.get(User, int(user_id))
    if not user:
        return error(code=1006, msg="用户不存在", http_status=404)

    data = json_body()
    nickname = str_field(data, "nickname")
    avatar = str_field(data, "avatar") or None

    if not nickname:
        return error(code=1012, msg="用户名不能为空")
    if len(nickname) > 64:
        return error(code=1012, msg="用户名长度不能超过64位")
    # 头像同样按字段长度（String(255)）先于入库校验：此前是静默截断，
    # 超出部分被悄悄丢掉且没有任何提示（见 11.1 入参长度先于入库校验）
    if avatar and len(avatar) > 255:
        return error(code=1014, msg="头像地址长度不能超过255位")
    # 头像必须是本站上传的相对路径（与作品 image_path 同一口径，见 6.2 / 11.3 第 47 条）：
    # 只校验长度是不够的 —— 客户端可以塞任意外链或带 `../` 的脏路径进来，头像就变成
    # 指向站外 / 站外的引用；校验规则走 storage.is_upload_url()（全站唯一一份）
    if avatar and not storage.is_upload_url(avatar):
        return error(code=1014, msg="头像地址必须是本站上传的相对路径")

    user.nickname = nickname
    if avatar:
        user.avatar = avatar
    db.session.commit()
    return success(data=user.to_dict(), msg="保存成功")


@api_bp.post("/auth/wechat")
def wechat_login():
    """微信一键登录：code 换 openid，查询/创建用户并签发双 token

    流程：前端 wx.login 获取 code → 本接口调用微信 code2session →
    按 openid 查询或创建 User → 返回双 token。
    依赖配置：.env 中 WECHAT_APPID / WECHAT_SECRET。
    """
    data = json_body()
    code = str_field(data, "code")
    if not code:
        return error(code=1007, msg="缺少微信登录 code")

    appid = current_app.config.get("WECHAT_APPID")
    secret = current_app.config.get("WECHAT_SECRET")
    if not appid or not secret:
        return error(code=1008, msg="微信登录未配置", http_status=501)

    # 用 code 换取 openid / session_key
    try:
        resp = requests.get(
            "https://api.weixin.qq.com/sns/jscode2session",
            params={
                "appid": appid,
                "secret": secret,
                "js_code": code,
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
        wx_data = resp.json()
    except (requests.RequestException, ValueError):
        current_app.logger.exception("wechat code2session network error")
        return error(code=1009, msg="微信服务暂不可用，请稍后再试", http_status=502)
    # 微信侧异常时可能返回数组/字符串等非对象 JSON：先判类型，
    # 否则下面的 wx_data.get(...) 会抛 AttributeError，返回非统一 JSON 的 500（见 6.1）
    if not isinstance(wx_data, dict):
        current_app.logger.warning("wechat code2session 返回非对象：%s", type(wx_data).__name__)
        return error(code=1009, msg="微信登录校验失败", http_status=502)
    if "errcode" in wx_data and wx_data.get("errcode") != 0:
        current_app.logger.warning("wechat code2session failed: %s", wx_data)
        return error(code=1009, msg="微信登录校验失败", http_status=502)

    openid = wx_data.get("openid")
    if not openid:
        return error(code=1009, msg="微信登录校验失败", http_status=502)

    user = User.query.filter_by(openid=openid).first()
    if not user:
        # 首次通过微信登录：创建用户（密码为空，昵称暂为默认，后续可更新）
        user = User(openid=openid, nickname="微信用户")
        db.session.add(user)
        try:
            db.session.commit()
        except IntegrityError:
            # 并发首次登录（同一 openid 的两个请求同时走到这里）：唯一约束兜底，
            # 回滚后取先落库的那条，而不是把 500 抛给客户端（口径同上）
            db.session.rollback()
            user = User.query.filter_by(openid=openid).first()
            if not user:
                return error(code=1009, msg="微信登录失败，请稍后重试", http_status=502)

    tokens = _issue_tokens(user)
    return success(data={**tokens, "user": user.to_dict()}, msg="登录成功")
