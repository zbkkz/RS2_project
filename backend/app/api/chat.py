# app/api/chat.py
"""「AI 智能处理」对话接口（会话 CRUD + 发消息 + 语音识别，见 README 7.4）。

链路与记账（对齐 7.3 的图像能力口径）：
- 每轮对话记一条 `EditRecord(action="ai_chat")`，上限 `config.chat_daily_limit()`；
- 对话内每次出图记一条 `action="ai_chat_edit"`，上限 `config.chat_edit_daily_limit()`；
- 每次语音识别记一条 `action="ai_asr"`，与对话共用同一个上限值（`chat_daily_limit()`）。
  这三条都是**按用户按本地零点**统计当日次数，超限返回 3003。
- 出图结果落盘 `uploads/ai/`（`make_thumb=False`）且**不创建作品**（口径同 M30）：
  要不要存成作品由用户在对话里点「保存到作品」决定。

安全：
- 客户端只能传 `{text, image_path}`；**意图与图像指令一律服务端判定/生成**（services/chat.py 的白名单），
  请求里出现的任何疑似指令字段（prompt/model/parameters/ability）都被忽略（见 README 11.1 / 11.3 第 32 条）；
- `image_path` 只接受本站 `/uploads/` 路径且必须真实存在（`storage.resolve_upload_path` 挡目录穿越）；
- 会话与消息一律带 `user_id` 归属校验，越权统一 3010、不泄露他人数据。
"""
import io
import os
import time
from datetime import datetime

from flask import current_app, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import func

from app.api import api_bp
from app.extensions import db
from app.models import ChatMessage, ChatSession, EditRecord
from app.services import ai as ai_service
from app.services import asr as asr_service
from app.services import chat as chat_service
from app.services import quota
from app.services import storage as storage_service
from app.utils.params import json_body, page_args, str_field
from app.utils.response import error, success
from config import (
    ai_global_key,
    ai_global_model,
    asr_model,
    chat_daily_limit,
    chat_edit_daily_limit,
    chat_model,
)

# 会话标题取首条用户消息的前若干字（字段是 String(64)，取 20 字留足余量）
TITLE_LEN = 20
# 一次拉取的历史消息条数上限（送模型的上下文再由 chat_max_turns 二次裁剪）
MESSAGE_PAGE_MAX = 100


def _own_session(session_id: int, user_id: int) -> ChatSession | None:
    """取当前用户自己的会话（越权一律当作不存在）。"""
    return ChatSession.query.filter_by(id=session_id, user_id=user_id).first()


def _latest_image(session_id: int) -> str | None:
    """会话里**最近一张真实存在的图**（AI 出图结果或用户上传的原图）。

    用途：用户只发文字时延续上下文 —— 「发一张图 → AI 出图 → 接着说『把海星 p 掉』」是高频路径，
    若每条消息都要求重新附图，用户会反复被要求上传（体验上等同于 bug）。
    只在文件**确实还在磁盘上**时才沿用（临时图可能已被 cleanup_temp.py 回收），
    倒序最多查 5 条，避免长会话里无图却不提前退出。
    """
    rows = (
        ChatMessage.query.filter_by(session_id=session_id)
        .filter(ChatMessage.image_path.isnot(None))
        .order_by(ChatMessage.id.desc())
        .limit(5)
        .all()
    )
    for row in rows:
        if not (row.image_path or "").startswith("/uploads/"):
            continue
        abs_path = storage_service.resolve_upload_path(row.image_path)
        if abs_path and os.path.exists(abs_path):
            return row.image_path
    return None


def _history(session_id: int) -> list:
    """最近若干条消息，转成模型可直接用的上下文（倒序取最近再翻正）。

    除 `role/content` 外还带上 `type/intent/has_image`：**纯文本模型看不到图片**，
    服务层要靠这几个字段把「这条带了图」「上一步做了什么处理」补成文字标注，
    否则上下文里只有文字、没有指代，用户说「再来一次」时模型无从下手（见 README 7.4）。
    """
    rows = (
        ChatMessage.query.filter_by(session_id=session_id)
        .order_by(ChatMessage.id.desc())
        .limit(MESSAGE_PAGE_MAX)
        .all()
    )
    rows.reverse()
    history = []
    for item in rows:
        content = (item.content or "").strip()
        has_image = bool((item.image_path or "").strip())
        if not content and item.type == ChatMessage.TYPE_IMAGE:
            content = "（已生成一张图片）"
        if not content and not has_image:
            continue
        history.append({
            "role": "user" if item.role == ChatMessage.ROLE_USER else "assistant",
            "content": content,
            "type": item.type or ChatMessage.TYPE_TEXT,
            "intent": item.intent or "",
            "has_image": has_image,
        })
    return history


# ==================== 会话 ====================

@api_bp.get("/chat/sessions")
@jwt_required()
def chat_session_list():
    """当前用户的会话列表（分页，按最后更新倒序）。"""
    user_id = int(get_jwt_identity())
    # page/size 统一走 page_args（非法值回落默认、超大页码被钳制，见 app/utils/params.py）
    page, size = page_args(default_size=20, max_size=50)

    pagination = (
        ChatSession.query.filter_by(user_id=user_id)
        .order_by(ChatSession.updated_at.desc())
        .paginate(page=page, per_page=size, error_out=False)
    )
    ids = [s.id for s in pagination.items]
    counts = {}
    if ids:
        counts = dict(
            db.session.query(ChatMessage.session_id, func.count(ChatMessage.id))
            .filter(ChatMessage.session_id.in_(ids))
            .group_by(ChatMessage.session_id)
            .all()
        )
    return success(data={
        "items": [s.to_dict(message_count=counts.get(s.id, 0)) for s in pagination.items],
        "total": pagination.total,
        "page": page,
        "size": size,
    })


@api_bp.post("/chat/sessions")
@jwt_required()
def chat_session_create():
    """新建会话（可带 title）。会话本身不调模型，因此不计配额。"""
    user_id = int(get_jwt_identity())
    data = json_body()
    title = str_field(data, "title") or "新对话"
    if len(title) > 64:
        return error(code=3011, msg="会话标题长度不能超过64位")

    session = ChatSession(user_id=user_id, title=title)
    db.session.add(session)
    db.session.commit()
    return success(data=session.to_dict(message_count=0), msg="创建成功", http_status=201)


@api_bp.get("/chat/sessions/<int:session_id>/messages")
@jwt_required()
def chat_message_list(session_id: int):
    """会话消息（分页）。

    `order=asc`（默认）按时间升序，`page=1` 为**最早**一页；
    `order=desc` 按时间倒序，`page=1` 为**最近**一页 —— 聊天页打开时用后者取「最近 N 条」
    （前端拿到的仍是倒序，展示前自己反转即可）。

    为什么需要 `desc`：会话一旦超过 `size` 条，用 asc + page=1 只能拿到最早的一批，
    **最新的消息永远看不到**（用户视角是「聊到一半记录没了」）。
    """
    user_id = int(get_jwt_identity())
    if not _own_session(session_id, user_id):
        return error(code=3010, msg="会话不存在", http_status=404)

    page, size = page_args(default_size=50, max_size=MESSAGE_PAGE_MAX)
    order = (request.args.get("order") or "asc").strip().lower()
    query = ChatMessage.query.filter_by(session_id=session_id)
    if order == "desc":
        query = query.order_by(ChatMessage.id.desc())
    else:
        order = "asc"
        query = query.order_by(ChatMessage.id.asc())
    pagination = query.paginate(page=page, per_page=size, error_out=False)
    return success(data={
        "items": [m.to_dict() for m in pagination.items],
        "total": pagination.total,
        "page": page,
        "size": size,
        "order": order,
    })


@api_bp.delete("/chat/sessions/<int:session_id>")
@jwt_required()
def chat_session_delete(session_id: int):
    """删除会话（连带消息）。

    **不删除出图结果文件**：用户可能刚把结果「去编辑」继续用；
    未被任何作品引用的临时图由 `cleanup_temp.py` 按保留期回收（口径同 M30）。
    """
    user_id = int(get_jwt_identity())
    session = _own_session(session_id, user_id)
    if not session:
        return error(code=3010, msg="会话不存在", http_status=404)
    # 这里用 bulk delete 显式删消息，而不是只删会话让 relationship 的 cascade 带着删：
    # cascade 会先把消息全查出来再逐条 DELETE（长会话 = N 次语句），bulk delete 一条 SQL 搞定。
    # relationship 上的 cascade="all, delete-orphan" 保留作为兜底（别的路径若直接删会话也不会留孤儿）。
    ChatMessage.query.filter_by(session_id=session_id).delete()
    db.session.delete(session)
    db.session.commit()
    return success(msg="删除成功")


# ==================== 发消息（对话 + 可选出图） ====================

@api_bp.post("/chat/sessions/<int:session_id>/messages")
@jwt_required()
def chat_send(session_id: int):
    """发一条消息并同步拿到 AI 回复（需要出图时在同一请求内完成）。

    请求体：`{"text": "...", "image_path": "/uploads/originals/xxx.jpg"}`（两者至少一个）。
    响应：`{"user_message": {...}, "ai_message": {...}}`（`ai_message.type=image` 时带结果图路径）。
    """
    user_id = int(get_jwt_identity())
    session = _own_session(session_id, user_id)
    if not session:
        return error(code=3010, msg="会话不存在", http_status=404)

    # 只认这两个字段：客户端传来的 prompt / ability / model 等一律忽略（见文件头说明）。
    # 取值统一走 str_field：非字符串类型安全降级，不会因为 {"text": 5} 之类抛异常变成 HTML 500
    data = json_body()
    text = str_field(data, "text")
    image_path = str_field(data, "image_path") or None

    if not text and not image_path:
        return error(code=3011, msg="消息不能为空")
    if len(text) > chat_service.MAX_TEXT_LEN:
        return error(code=3011, msg=f"消息最多 {chat_service.MAX_TEXT_LEN} 个字")

    # 本次实际用于处理的图：优先本条附带的；没带就**沿用会话里最近一张可用的图**
    # （用户的高频路径是「发图 → AI 出图 → 接着说『把海星 p 掉』」，若每条都要求重新上传，
    #  体验上就像 bug —— 见 README 8.9 第 4 条）
    inherited = False
    input_image = image_path
    if not input_image:
        input_image = _latest_image(session_id)
        inherited = bool(input_image)

    img_abs = None
    img_name = "image.jpg"
    if input_image:
        if input_image.startswith("/uploads/"):
            img_abs = storage_service.resolve_upload_path(input_image)
        if not img_abs or not os.path.exists(img_abs):
            # 本条明确附了图 → 让用户重传；只是「沿用」失败 → 降级成没有图（不打断这轮问答）
            if image_path:
                return error(code=3011, msg="图片已失效，请重新上传")
            img_abs, input_image, inherited = None, None, False
        else:
            img_name = os.path.basename(img_abs)
    has_image = bool(img_abs)

    if not ai_global_key():
        return error(code=3005, msg="未配置 AI 密钥，请在 .env 中填写 AI_API_KEY")

    # 每轮对话都算一次用量：即便判为范围外也算（那次模型调用已经花掉了）
    limit = chat_daily_limit()
    if quota.used_today(user_id, "ai_chat") >= limit:
        return error(code=3003, msg=f"今日对话次数已用完（每日上限 {limit} 次）")

    history = _history(session_id)
    started = time.monotonic()
    result_url = None
    outcome = ""
    quota_msg = ""  # 非空表示「对话内出图额度已用完」：仍要记账 + 落库，最后按 3003 返回

    try:
        # ① 闸门 A：意图判定（只有图片没有文字时跳过，改为引导用户说需求）
        if text:
            decision = chat_service.classify(text, has_image=has_image, history=history)
        else:
            decision = {"in_scope": True, "intent": "none", "style": "", "reason": "image-only"}

        if not decision["in_scope"]:
            # 范围外：固定话术，不由模型发挥（见 README 7.4）
            reply = chat_service.OUT_OF_SCOPE_REPLY
            outcome = "out_of_scope"
        else:
            intent = decision["intent"]
            editable = chat_service.is_editable(intent)
            if editable and not has_image:
                outcome = "no_image"
            elif editable and has_image:
                edit_limit = chat_edit_daily_limit()
                if quota.used_today(user_id, "ai_chat_edit") >= edit_limit:
                    # 出图额度已用完：**不能**在这里直接 return —— 意图门那次模型调用已经花掉了
                    # （7.4：每轮都要记账），而用户这条消息与本次结果若不入库，用户会觉得
                    # 「说了话却不见了」；故照常走「落库」流程，最后仍按 3003 返回给前端。
                    # 这里也不再调表达门（重试也没用，省一次调用），直接给固定文案。
                    outcome = "quota"
                    quota_msg = f"今日修图次数已用完（每日上限 {edit_limit} 次），明天再来吧～"
                    reply = quota_msg
                else:
                    # ② 出图：指令只可能来自服务端白名单模板（build_edit）
                    prompt, params = chat_service.build_edit(intent, decision["style"])
                    model = ai_global_model()
                    try:
                        with open(img_abs, "rb") as f:
                            img_bytes = f.read()
                        result_bytes = ai_service.edit_with_prompt(
                            img_bytes, img_name, prompt, params,
                            api_key=ai_global_key(), model=model, label=f"chat:{intent}",
                        )
                        result_bytes, ext = ai_service.encode_result(result_bytes)
                        saved = storage_service.save_image(
                            io.BytesIO(result_bytes), f"result{ext}", sub="ai", make_thumb=False
                        )
                        result_url = saved["url"]
                        outcome = "ok"
                        db.session.add(EditRecord(
                            user_id=user_id, work_id=None, action="ai_chat_edit",
                            params={
                                "intent": intent, "style": decision["style"] or None,
                                "model": model, "provider": ai_service.provider_name("AI_CHAT_API_BASE"), "file": result_url,
                                # 本次入参图的来源：本条上传 / 沿用会话里最近一张（便于排查"为什么用的是旧图"）
                                "image_source": "uploaded" if image_path else "inherited",
                            },
                        ))
                    except (ai_service.AITimeout, ai_service.AIError) as e:
                        # 出图失败不中断整轮对话：保留文字回复并把实情告诉用户
                        current_app.logger.warning(
                            "对话出图失败 user=%s intent=%s：%s", user_id, intent, e
                        )
                        outcome = "fail"
                    except Exception:
                        current_app.logger.exception("对话出图异常 user=%s intent=%s", user_id, intent)
                        outcome = "fail"
            elif not text:
                outcome = "no_text"

            # ③ 闸门 B：面向用户的回复（带上本次真实结果，避免"说做了其实没做"）；
            # 额度用完时上面已给出固定文案，不再花一次模型调用
            if outcome != "quota":
                reply = chat_service.compose_reply(
                    text or "（这条消息没有文字，只有一张图片）",
                    intent=decision["intent"], style=decision["style"],
                    has_image=has_image, outcome=outcome, inherited=inherited, history=history,
                )
    except ai_service.AITimeout:
        return error(code=3002, msg="对话超时，请稍后重试")
    except ai_service.AIError as e:
        # 上游细节只进日志（不含密钥、不含用户原文）
        current_app.logger.warning("对话失败 user=%s：%s", user_id, e)
        return error(code=3002, msg="AI 服务暂时不可用，请稍后重试")

    # ④ 落库：会话标题取首条用户消息；updated_at 手动刷新（会话行不一定有别的字段变化）
    if text and (not session.title or session.title == "新对话"):
        session.title = text[:TITLE_LEN]
    session.updated_at = datetime.now()

    # 用户消息：本条**真的带了图**时 type 记 image（前端据此把用户上传的原图显示在自己的气泡里）；
    # 沿用的那张图**不写进用户消息** —— 那是服务端的上下文延续，不能伪造"用户发了图"
    # 审计字段 `intent` 的口径：范围外记 out_of_scope，其余记意图门的判定结果 ——
    # **user 与 ai 两条消息必须同源**，否则同一轮在库里是两个不同的 intent（排查时对不上）
    audit_intent = decision["intent"] if decision["in_scope"] else "out_of_scope"
    user_msg = ChatMessage(
        session_id=session_id, user_id=user_id, role=ChatMessage.ROLE_USER,
        type=ChatMessage.TYPE_IMAGE if image_path else ChatMessage.TYPE_TEXT,
        content=text or None, image_path=image_path,
        intent=audit_intent,
    )
    ai_msg = ChatMessage(
        session_id=session_id, user_id=user_id, role=ChatMessage.ROLE_AI,
        type=ChatMessage.TYPE_IMAGE if result_url else ChatMessage.TYPE_TEXT,
        content=reply, image_path=result_url, intent=audit_intent,
    )
    db.session.add(user_msg)
    db.session.add(ai_msg)
    db.session.add(EditRecord(
        user_id=user_id, work_id=None, action="ai_chat",
        params={
            "intent": decision["intent"], "in_scope": decision["in_scope"],
            "has_image": has_image, "inherited": inherited, "result": outcome,
            "model": chat_model(), "provider": ai_service.provider_name("AI_CHAT_API_BASE"),
        },
    ))
    db.session.commit()

    current_app.logger.info(
        "对话完成 user=%s session=%s in_scope=%s intent=%s 出图=%s 耗时=%.1fs",
        user_id, session_id, decision["in_scope"], decision["intent"],
        bool(result_url), time.monotonic() - started,
    )
    if quota_msg:
        # 出图额度用完：消息与配额都已入库（见上面的说明），契约不变 —— 仍按 3003 告知前端
        return error(code=3003, msg=quota_msg)
    return success(
        data={"user_message": user_msg.to_dict(), "ai_message": ai_msg.to_dict()},
        msg="发送成功",
        http_status=201,
    )


# ==================== 语音识别 ====================

@api_bp.post("/chat/asr")
@jwt_required()
def chat_asr():
    """语音转写（multipart：file）。返回 `{text}`；静音返回空串（不是错误）。"""
    user_id = int(get_jwt_identity())
    if "file" not in request.files or not request.files["file"].filename:
        return error(code=3012, msg="未接收到音频")
    if not ai_global_key():
        return error(code=3005, msg="未配置 AI 密钥，请在 .env 中填写 AI_API_KEY")

    # 与对话共用同一个每日上限值（ASR 不免费，不能无限刷）
    limit = chat_daily_limit()
    if quota.used_today(user_id, "ai_asr") >= limit:
        return error(code=3003, msg=f"今日语音识别次数已用完（每日上限 {limit} 次）")

    file = request.files["file"]
    max_size = asr_service.max_audio_size()
    # 多读 1 字节用于判断「是否超限」，避免把超大文件整个读进内存
    audio = file.stream.read(max_size + 1)
    if len(audio) > max_size:
        return error(code=3012, msg=f"音频过大（上限 {max_size // (1024 * 1024)}MB）")

    try:
        result = asr_service.transcribe(audio, file.filename)
    except ValueError as e:
        return error(code=3012, msg=str(e))
    except ai_service.AITimeout:
        return error(code=3002, msg="语音识别超时，请重试")
    except ai_service.AIError as e:
        current_app.logger.warning("语音识别失败 user=%s：%s", user_id, e)
        return error(code=3002, msg="语音识别失败，请重试")

    db.session.add(EditRecord(
        user_id=user_id, work_id=None, action="ai_asr",
        params={"model": asr_model(), "provider": ai_service.provider_name("AI_CHAT_API_BASE"),
                "ext": result["ext"], "text_len": len(result["text"] or "")},
    ))
    db.session.commit()
    return success(data={"text": result["text"]}, msg="识别成功")
