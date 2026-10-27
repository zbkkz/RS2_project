# app/api/ai.py
import io
import time

from flask import current_app, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.api import api_bp
from app.extensions import db
from app.models import EditRecord
from app.services import ai as ai_service
from app.services import quota
from app.services import storage as storage_service
from app.utils.response import error, success
from config import (
    ai_api_key,
    ai_daily_limit,
    ai_model,
    chat_daily_limit,
    chat_edit_daily_limit,
)


@api_bp.post("/ai/<ability>")
@jwt_required()
def ai_process(ability):
    """AI 图像处理（multipart：file；风格迁移另需 style）。

    能力：matting / style / enhance / beauty / background / hair（见 `ABILITY_SPECS`）。

    **能力隔离**（服务端强绑定，见 README 7.3）：客户端只能传「图片 +（风格迁移的）风格名」——
    指令、参数、模型、密钥全部由服务端按能力固定；不支持的能力名、不在白名单的风格值一律拒绝，
    请求里出现的任何自定义指令字段都会被忽略，不存在「某能力越界干别的」的通道。
    """
    user_id = int(get_jwt_identity())

    # ① 能力白名单：能力规格表是唯一权威（含固定指令与参数）
    spec = ai_service.ability_spec(ability)
    if not spec:
        return error(code=3004, msg="不支持的 AI 能力")

    # ② 能力级密钥（AI_API_KEY_<能力> 覆盖 → 缺省回落全局 AI_API_KEY）
    api_key = ai_api_key(ability)
    if not api_key:
        return error(
            code=3005,
            msg=f"{spec['name']}未配置 AI 密钥，请在 .env 中填写 AI_API_KEY"
                f"（或按能力单独配置 AI_API_KEY_{ability.upper()}）",
        )

    # ③ 风格白名单：仅风格迁移读取 style，且必须是白名单枚举；
    #    其它能力一律忽略 style —— 避免协议被扩展成「任意指令通道」
    style = (request.form.get("style") or "").strip() or None
    if spec["style_required"]:
        try:
            style = ai_service.validate_style(style)
        except ValueError:
            return error(code=3004, msg="风格不在可选范围内（油画 / 素描 / 动漫 / 水彩 / 赛博朋克）")
    else:
        style = None

    # ④ 能力级每日配额：只统计本能力（action == "ai_<能力>"）的当日记录。
    #    统计口径（本地零点 + action 精确匹配）统一在 services/quota.py，与对话链路的
    #    ai_chat / ai_chat_edit / ai_asr 三种用途**共用同一份实现**（见 11.3 第 48 条）
    limit = ai_daily_limit(ability)
    if quota.used_today(user_id, f"ai_{ability}") >= limit:
        return error(code=3003, msg=f"{spec['name']}今日次数已用完（每日上限 {limit} 次）")

    # ⑤ 入参校验
    if "file" not in request.files or not request.files["file"].filename:
        return error(code=3001, msg="未接收到图片")

    file = request.files["file"]
    ext = (file.filename.rsplit(".", 1)[-1] or "").lower()
    if ext not in current_app.config["ALLOWED_IMAGE_EXT"]:
        return error(code=3001, msg="不支持的图片格式")

    max_size = current_app.config["MAX_UPLOAD_SIZE"]
    img_bytes = file.stream.read(max_size + 1)
    if len(img_bytes) > max_size:
        return error(code=3001, msg="图片过大")

    # ⑥ 调用服务层（按能力注入密钥与模型；指令由服务层按能力固定）
    model = ai_model(ability)
    started = time.monotonic()
    try:
        result_bytes = ai_service.image_edit(
            img_bytes, file.filename, ability, style, api_key=api_key, model=model
        )
    except ValueError as e:
        # 能力/风格非法（理论上已在前面拦下，兜底）
        return error(code=3004, msg=str(e))
    except ai_service.AITimeout as e:
        # 超时单独给文案：它是「可重试」的状态，且必须让用户知道这次没有产生结果
        # （上游在预算内没出图，本次不落库、不写作品）
        # 预算数值已写在异常信息里（含单次读取上限与总预算），日志不必重复拼装
        current_app.logger.warning(
            "AI 超时 ability=%s user=%s model=%s：%s", ability, user_id, model, e
        )
        return error(code=3002, msg="AI 处理超时，请稍后重试或改用更小的图片")
    except ai_service.AIError as e:
        # 上游失败细节只进日志（含状态码/request_id/响应片段，不含密钥），对外统一 3002
        current_app.logger.warning(
            "AI 失败 ability=%s user=%s model=%s：%s", ability, user_id, model, e
        )
        return error(code=3002, msg="AI 处理失败")
    except Exception:
        current_app.logger.exception("AI 处理异常 ability=%s user=%s", ability, user_id)
        return error(code=3002, msg="AI 处理失败")

    # ⑦ 结果图落盘（子目录 ai/）——**只作为本次编辑会话的底图，不创建作品**。
    #    「要不要保存成作品」是用户的决定：编辑页点「保存」才登记（见 M30）。
    #    AI 处理常常只是中间步骤（例如先抠图再风格迁移），旧实现每次都建一条作品，
    #    会把「我的作品」刷满中间产物。
    #    缩略图只服务于作品列表，这里也不生成（make_thumb=False）。
    result_bytes, result_ext = ai_service.encode_result(result_bytes)
    try:
        result = storage_service.save_image(
            io.BytesIO(result_bytes), f"result{result_ext}", sub="ai", make_thumb=False
        )
    except ValueError as e:
        return error(code=3001, msg=str(e))
    except Exception:
        return error(code=3002, msg="结果图保存失败")

    # EditRecord 仍然要写：它是**能力级每日配额的统计依据**（action == "ai_<能力>"，见 ④），
    # 只是不再关联作品（work_id 为空），因此也不会出现在作品详情页的记录列表里（那张表按 work_id 查）。
    # params.file 只用于**事后排查**（这次调用留下了哪张临时图）—— 回收脚本的判定依据是
    # works / chat_messages 的引用关系，**不读**这条记录（见 README 7.2 / M43）。
    db.session.add(EditRecord(
        user_id=user_id, work_id=None, action=f"ai_{ability}",
        params={"style": style, "model": model, "provider": ai_service.provider_name(),
                "file": result["url"]},
    ))
    db.session.commit()

    current_app.logger.info(
        "AI 成功 ability=%s user=%s model=%s 耗时=%.1fs 结果=%s（未建作品，等用户保存）",
        ability, user_id, model, time.monotonic() - started, result["url"],
    )
    return success(data={"url": result["url"], "ability": ability}, msg="处理成功")


@api_bp.get("/ai/quota")
@jwt_required()
def ai_quota():
    """各 AI 能力与对话用途的今日用量（**只读**：不写记录、不消耗任何次数）。

    返回结构：`{abilities: [{ability,name,used,limit,remaining}], chat, chat_edit, asr, total}`，
    其中 chat / chat_edit / asr 各为 `{used, limit, remaining}`；`total` 是**全部用途的汇总**
    `{used, limit, remaining, percent}`，供个人页的「整体额度」进度条直接使用（占比口径只在服务端
    算一次，避免前端各处重复计算）。

    两条口径要点：
    - **统计只走 `services/quota.py`**（`used_today()` / `used_today_map()` 是「本地零点 + action
      精确匹配」的同一份实现，后者只是把 N 条 COUNT 合并成一条聚合），
      本接口不自己拼 `created_at >= 今日零点`（否则就出现了第二份口径，见 11.3 第 48 条）；
    - 语音识别与对话**共用同一个上限值**（`api/chat.py` 的 ASR 分支用的就是 `chat_daily_limit()`），
      故 asr 的上限与 chat 取同一个值。
    `total` 是**各用途的合计**（各能力与对话三用途各自相加），供个人页的「整体额度」使用；
    其中 `percent` 是**剩余占比（百分比）**，个人页只展示它，不展示加总出来的绝对次数。

    路由说明：`POST /api/ai/<ability>` 与 `GET /api/ai/quota` 路径形状相同，但方法不同，
    Werkzeug 按「路径 + 方法」匹配，两者不冲突。
    """
    user_id = int(get_jwt_identity())

    # 能力清单直接遍历 ABILITY_SPECS 生成：将来新增能力会自动出现在返回里，本接口无需改动。
    # 统计**一次查完**（`used_today_map` = 一条 GROUP BY）：本接口覆盖 6 个能力 + 3 个对话用途
    # 共 9 个口径，逐条 `used_today()` 就是 9 条 COUNT —— 口径仍是同一份实现，只是查询粒度不同。
    chat_limit = chat_daily_limit()
    chat_edit_limit = chat_edit_daily_limit()
    actions = [f"ai_{ability}" for ability in ai_service.ABILITY_SPECS]
    actions += ["ai_chat", "ai_chat_edit", "ai_asr"]
    used_map = quota.used_today_map(user_id, actions)

    abilities = []
    for ability, spec in ai_service.ABILITY_SPECS.items():
        limit = ai_daily_limit(ability)
        used = used_map.get(f"ai_{ability}", 0)
        abilities.append({
            "ability": ability,
            "name": spec["name"],
            "used": used,
            "limit": limit,
            "remaining": max(0, limit - used),
        })

    def pack(action: str, limit: int) -> dict:
        used = used_map.get(action, 0)
        return {"used": used, "limit": limit, "remaining": max(0, limit - used)}

    chat = pack("ai_chat", chat_limit)
    chat_edit = pack("ai_chat_edit", chat_edit_limit)
    asr = pack("ai_asr", chat_limit)

    # 「整体额度」：**各用途的已用 / 上限各自相加**，供个人页的进度条使用。
    # `ai_chat` 与 `ai_asr` 的上限值相同（配置层面本就是同一个数字 `chat_daily_limit()`），
    # 但**计数是两个独立的 action**、实际可用次数互相独立；因此按"各算各的"相加，与真实行为一致
    # （若合并成一个池，界面会显示"合计只有 N 次"，与用户实际能用到的次数不符）。
    #
    # 个人页只展示 `percent`（剩余占比，百分比）—— 加总出来的绝对次数容易被误读成"总配额"。
    pools = abilities + [chat, chat_edit, asr]
    total_used = sum(p["used"] for p in pools)
    total_limit = sum(p["limit"] for p in pools)
    total_remaining = max(0, total_limit - total_used)

    return success(data={
        "abilities": abilities,
        "chat": chat,
        "chat_edit": chat_edit,
        "asr": asr,
        "total": {
            "used": total_used,
            "limit": total_limit,
            "remaining": total_remaining,
            # 剩余占比（进度条填充比例，整数百分比）：上限为 0 时给 0，避免除零
            "percent": round(total_remaining / total_limit * 100) if total_limit > 0 else 0,
        },
    })
