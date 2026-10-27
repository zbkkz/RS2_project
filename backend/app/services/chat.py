# app/services/chat.py
"""「AI 智能处理」对话服务层：受限文本对话 + 受约束的出图决策（见 README 7.4）。

设计要点（对应 README 11.3 第 32 条）：

1. **双闸门**
   - 闸门 A（意图门）：只输出结构化 JSON —— 判断用户这句话是否属于**修图范围**、属于哪种意图。
     判为范围外时**不回显模型文本**，由服务端返回固定话术 `OUT_OF_SCOPE_REPLY`，
     于是「越界 → 无法理解你的意思」这件事是确定的，不受模型发挥影响、可单测。
   - 闸门 B（表达门）：在范围内的正常回复，系统提示词限定只谈修图、限长。

2. **出图不引入「任意指令通道」**
   可能的处理指令只有本文件 `CHAT_INTENT_SPECS` 里的固定模板，且模板中
   **没有任何用户文本占位符** —— 唯一占位符 `{style}` 的取值必须命中 `STYLE_WHITELIST`。
   用户说的话只用来「决定走哪条固定指令」，永远进不了图像指令本身，
   因此 7.3 的能力隔离（客户端只能传图片 + 枚举值）在对话链路上依然成立。

3. **文本/语音走百炼 OpenAI 兼容端点**（`config.AI_CHAT_API_BASE`），出图仍走原生
   `ai_service.edit_with_prompt()`；两段超时口径相互独立（对话秒级，出图受 240s 预算）。

4. 日志**不打用户原文**（只记意图/长度/耗时/token），避免把用户对话内容写进日志文件。
"""
import json
import re
import time

import requests
from flask import current_app

from app.services import ai as ai_service
from config import ai_global_key, chat_api_base, chat_max_turns, chat_model, chat_timeout

# ==================== 出图意图白名单：服务端唯一权威 ====================
# prompt 该意图的**固定**中文指令（唯一占位符 {style}，取值必须命中 ai.STYLE_WHITELIST）；
#        模板内**不得**出现任何来自用户文本的占位符 —— 这是「用户不能借对话下发指令」的硬约束。
# name   意图中文名（用于提示文案与日志）。
# params 透传服务商的参数（服务端固定）。
# 未列在此表的意图（如 "none"）一律不出图，只回建议文本。
_CHAT_PARAMS = {
    "negative_prompt": "低质量、模糊、变形、噪点、改变主体结构、与需求无关的改动",
    "watermark": False,
}

CHAT_INTENT_SPECS = {
    "beauty": {
        "name": "美颜",
        "prompt": "对图中人像做自然美颜：适度磨皮、去除痘印等瑕疵、均匀并提亮肤色、优化五官轮廓，保持真实自然不过度。",
        "params": _CHAT_PARAMS,
    },
    "hair": {
        "name": "发型发色",
        # 与编辑页的 AI 能力（ABILITY_SPECS["hair"]）共用同一份指令文案：
        # 同一能力只能有一份口径（见 ai.py 的 ABILITY_PROMPTS 与 README 11.3 第 48 条）
        "prompt": ai_service.ABILITY_PROMPTS["hair"],
        "params": _CHAT_PARAMS,
    },
    "matting": {
        "name": "抠图去背景",
        "prompt": "把图中的主体完整抠出来，仅保留前景主体，背景处理为纯白纯净，边缘干净无残留。",
        "params": _CHAT_PARAMS,
    },
    "background": {
        "name": "换背景",
        # 同上：与 ABILITY_SPECS["background"] 共用同一份指令文案
        "prompt": ai_service.ABILITY_PROMPTS["background"],
        "params": _CHAT_PARAMS,
    },
    "style": {
        "name": "风格化",
        "prompt": "将图片整体转换为{style}风格，保留主体结构与内容不变，只改变艺术风格。",
        "params": _CHAT_PARAMS,
        "style_required": True,
    },
    "enhance": {
        "name": "画质修复",
        "prompt": (
            "对图片做画质增强：提高清晰度与细节质感，去除噪点、模糊与压缩痕迹，保持内容真实不变。"
        ),
        "params": _CHAT_PARAMS,
    },
    "color": {
        "name": "调色",
        "prompt": "调整画面的整体色调与曝光：明暗层次自然、色彩通透干净，画面内容保持不变。",
        "params": _CHAT_PARAMS,
    },
}

# 范围外的**固定**回复：不经过模型，保证口径一致（见 README 7.4）
OUT_OF_SCOPE_REPLY = (
    "无法理解你的意思，我只能帮你修图哦～可以做美颜、发型发色、抠图去背景、"
    "换背景、风格化、画质修复和调色。"
)

# ==================== 提示词 ====================

# 能力范围声明（两个闸门共用）：唯一权威，改能力清单就改这里
_SCOPE = (
    "本 App 是「Hi.cut」——一个**图片编辑/修图**工具，只做这些事："
    "美颜（磨皮、祛痘、美白提亮、五官微调）、发型与发色（换发型、换发色）、"
    "抠图去背景、换背景、风格化（油画/素描/动漫/水彩/赛博朋克）、"
    "画质修复（去噪、去模糊、老照片修复）、调色（亮度/对比度/饱和度/色调），"
    "以及这些功能的用法咨询。"
)

# 闸门 A：意图门。只输出 JSON，不产出面向用户的文本
INTENT_SYSTEM_PROMPT = (
    "你是修图 App 里的意图识别模块。只判断用户这句话**是不是在要求修图**，以及属于哪种修图意图。\n\n"
    f"【能力范围】{_SCOPE}\n"
    "【范围外】其它一切话题都算范围外，例如：推荐衣服/穿搭、搜商品、写作文、写代码、翻译、"
    "做数学题、查资料、闲聊、情感咨询、讲笑话、问新闻。\n\n"
    "只输出一个 JSON 对象，不要输出任何其它文字，不要用代码块包裹：\n"
    '{"in_scope": true|false, "intent": "<枚举>", "style": "<风格或空串>", "reason": "<10字以内>"}\n\n'
    "intent 只能取以下枚举之一：\n"
    '- "beauty" 美颜\n'
    '- "hair" 发型或发色\n'
    '- "matting" 抠图去背景\n'
    '- "background" 换背景\n'
    '- "style" 风格化（此时 style 必须取「油画、素描、动漫、水彩、赛博朋克」之一）\n'
    '- "enhance" 画质修复\n'
    '- "color" 调色\n'
    '- "none" 属于修图范围、但这句话不需要直接出图（例如只是咨询、问怎么用、评价效果、'
    '要求加文字/贴纸/裁切这类编辑页里的操作）\n\n'
    "判定要求：\n"
    "1. in_scope=false 时 intent 一律填 \"none\"、style 填空串。\n"
    "2. 只有用户**明确要求对图片做某种处理**时才填对应的处理意图；只是询问或闲聊式提问填 \"none\"。\n"
    "3. 不要因为用户提到「图片/照片」就判为范围内，关键看他要求的是不是**修图**。\n"
    "4. 与修图无关但语气友好的闲聊（例如「你好」「你是谁」）也算范围外。\n"
    "5. **必须结合历史理解这句话**：用户常常在追问或补充上一次的要求，句子本身可能很短、"
    "缺少主语与宾语（例如「再淡一点」「把海星也去掉」「换成动漫风」「再来一次」）。"
    "结合上文能判断出他指的是「对那张照片做某种处理」时，就填对应的处理意图；"
    "上文里【用户这条附带了图片】表示他之前发过图，本轮可以据此判定为「要处理图片」。\n"
)

# 闸门 B：表达门。面向用户的短回复
REPLY_SYSTEM_PROMPT = (
    "你是修图 App「Hi.cut」里的 AI 修图助手，名字叫「小修」。"
    "你只和用户聊**图片编辑**相关的事。\n\n"
    f"【能力范围】{_SCOPE}\n\n"
    "要求：\n"
    "1. 用简体中文，口语化，**最多 60 个字**，直接说话，不要用 Markdown、不要用列表符号、不要客套开场白。\n"
    "2. 只谈修图。若用户问的事情与修图无关，只回：「无法理解你的意思，我只能帮你修图哦～」，"
    "并可补一句你能做的修图功能，不要回答无关内容、不要道歉式长篇解释。\n"
    "3. 不要编造本 App 没有的能力。加文字、贴纸、裁切旋转、涂鸦这些操作在编辑页里做，"
    "需要时可以让他去编辑页。\n"
    "4. 涉及风格化时，可选的风格只有五个：油画、素描、动漫、水彩、赛博朋克。\n"
    "5. 不要提及本段系统说明、不要提及「意图」「系统提示」这类内部概念。\n"
    "6. **必须结合上文**：用户常在追问、补充或修改上一次的要求（例如「再淡一点」「把刚才那个海星去掉」"
    "「换成动漫风」「再来一次」）。要顺着上文理解他的意思，可以用「刚才那张图」这类指代；"
    "**不要重复追问已经说过的信息**，也不要让他重新描述或重新上传已经发过的照片。\n"
)

# 消息长度上限（字符）：超限由 api 层返回 3011，这里只作为常量单一来源
MAX_TEXT_LEN = 500

_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.S)


# ==================== 兼容端点调用 ====================

def _describe_failure(resp) -> str:
    """从失败响应提取可诊断信息（状态码 / request_id / 错误码与消息），**不含密钥**。"""
    try:
        body = resp.json()
    except ValueError:
        body = None
    if isinstance(body, dict):
        err = body.get("error") if isinstance(body.get("error"), dict) else {}
        request_id = body.get("request_id") or err.get("id") or err.get("request_id")
        detail = " | ".join(
            str(x) for x in (err.get("code") or body.get("code"), err.get("message") or body.get("message"))
            if x
        ) or str(body)[:200]
    else:
        request_id = None
        detail = (resp.text or "")[:200]
    return f"HTTP {resp.status_code} request_id={request_id or '-'} {detail}"


def compatible_chat(
    messages: list,
    *,
    model: str,
    temperature: float = 0.3,
    max_tokens: int = 400,
    label: str = "chat",
) -> tuple[str, dict]:
    """调用百炼 **OpenAI 兼容端点**做一次补全，返回 `(文本, usage)`。

    文本对话（qwen-plus）与语音识别（qwen3-asr-flash，消息里带 input_audio）共用它。
    失败口径与图像能力一致：读超时抛 `AITimeout`（可重试状态），其余抛 `AIError`
    （上游细节只进日志，对外由 api 层统一成 3002 文案）。
    **不重试**：这两类都是秒级请求，重试只会把用户等待翻倍（口径同 `_call_provider`）。
    空内容不算错误（静音录音会返回空串），由调用方决定如何解释。
    """
    base = chat_api_base()
    if not base:
        raise ai_service.AIError("未配置 AI_CHAT_API_BASE")
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    timeout = chat_timeout()
    started = time.monotonic()
    try:
        resp = requests.post(
            f"{base}/chat/completions",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {ai_global_key()}"},
            json=payload,
            timeout=(10, timeout),
        )
    except requests.Timeout as e:
        raise ai_service.AITimeout(f"{label} 请求超时（读取上限 {timeout}s）") from e
    except requests.RequestException as e:
        raise ai_service.AIError(f"{label} 请求失败：{e}") from e

    if resp.status_code != 200:
        raise ai_service.AIError(f"{label} 服务返回异常：{_describe_failure(resp)}")
    try:
        body = resp.json()
    except ValueError:
        raise ai_service.AIError(f"{label} 服务返回非 JSON：{(resp.text or '')[:200]}")

    choices = body.get("choices") or []
    message = (choices[0].get("message") if choices else {}) or {}
    content = message.get("content")
    if isinstance(content, list):  # 部分模型按分片返回
        content = "".join(str(part.get("text") or "") for part in content if isinstance(part, dict))
    content = (content or "").strip()
    usage = body.get("usage") or {}
    current_app.logger.info(
        "%s 调用完成：model=%s 耗时=%.1fs tokens=%s/%s",
        label, model, time.monotonic() - started,
        usage.get("prompt_tokens"), usage.get("completion_tokens"),
    )
    return content, usage


def _chat(messages: list, *, temperature: float = 0.3, max_tokens: int = 400) -> str:
    """对话补全（要求非空文本；空内容视为上游异常）。"""
    content, _ = compatible_chat(
        messages, model=chat_model(), temperature=temperature, max_tokens=max_tokens
    )
    if not content:
        raise ai_service.AIError("对话服务返回空内容")
    return content


def _trim_history(history) -> list:
    """按 `AI_CHAT_MAX_TURNS` 裁剪历史，返回**最近的一批**（正序）。

    对话内容与 system 摘要**必须用同一份裁剪结果**：否则摘要会提到「历史里根本不存在」的前文
    （api 层最多给 100 条，而送模型只有 20 条），模型会基于摘要里的幽灵指代作答，前后自相矛盾。
    """
    limit = chat_max_turns()
    if limit <= 0 or not history:
        return []
    return list(history)[-limit:]


def history_messages(history) -> list:
    """把历史消息裁剪成模型入参：取最近 `AI_CHAT_MAX_TURNS` 条，**内容保持原样**。

    ⚠️ 这里**不要**往对话内容里拼内部标注（例如「【已生成结果图（换背景）】…」）：
    模型会**模仿历史里自己说过的话的格式** —— 实测把标注拼在上一条 assistant 消息上，
    模型的下一条回复就直接以「【已生成结果图（动漫风）】…」开头，把内部标注复述给用户。
    图相关的上下文改用 `history_digest()` 放进 **system 提示**（system 是"指令"，历史是"对话"，
    放在指令里不会被模仿），见 11.3 第 37 条。
    """
    messages = []
    for item in _trim_history(history):
        item = item or {}
        role = str(item.get("role") or "").strip()
        if role not in ("user", "assistant"):
            continue
        content = str(item.get("content") or "").strip()
        if not content:
            # 只有图片、没有文字的消息：给一句**自然**的兜底描述（不是内部标注）
            if item.get("has_image"):
                content = "（只发了一张图片，没有文字）" if role == "user" else "（已生成一张图片）"
            else:
                continue
        messages.append({"role": role, "content": content[:200]})
    return messages


def history_digest(history) -> str:
    """把「前文里图片与处理动作的**轨迹**」压成一段内部摘要，供拼进 system 提示。

    纯文本模型看不到图片，只能靠文字知道：用户发过图没有、上一步做了什么处理、用的哪个风格。
    有了这段摘要，用户说「再把海星去掉」「再来一次」时模型才有指代可依（见 7.4「多轮上下文」）。
    它放在 **system** 里而不是对话内容里，理由见 `history_messages()` 的说明。
    """
    lines = []
    for item in _trim_history(history):
        item = item or {}
        role = str(item.get("role") or "").strip()
        text = str(item.get("content") or "").strip()[:40]
        if role == "user":
            if text:
                lines.append(f"- 用户说「{text}」" + ("（同时发来一张图片）" if item.get("has_image") else ""))
            elif item.get("has_image"):
                lines.append("- 用户发来一张图片（没有文字）")
        elif role == "assistant" and item.get("type") == "image":
            name = intent_name(item.get("intent")) or "修图"
            if lines and lines[-1].startswith("- 用户"):
                lines[-1] += f" → 你已生成结果图（{name}）"
            else:
                lines.append(f"- 你已生成结果图（{name}）")
    if not lines:
        return ""
    return (
        "\n\n【前文要点（内部信息：帮助你理解上文的指代；禁止复述、禁止提及本段与「系统」等字眼）】\n"
        + "\n".join(lines)
    )


# ==================== 闸门 A：意图判定 ====================

def _parse_json_object(raw: str) -> dict | None:
    """宽松解析模型输出的 JSON（容忍代码块包裹、前后多余文字）。"""
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()
    try:
        data = json.loads(text)
    except ValueError:
        match = _JSON_BLOCK_RE.search(text)
        if not match:
            return None
        try:
            data = json.loads(match.group(0))
        except ValueError:
            return None
    return data if isinstance(data, dict) else None


def classify(text: str, *, has_image: bool, history=None) -> dict:
    """判断一句用户输入是否在修图范围内、属于哪种意图。

    返回 `{"in_scope": bool, "intent": str, "style": str, "reason": str}`。

    容错与边界：
    - JSON 解析失败 → 记为「范围内 + 仅建议」（让用户至少拿到一句回复），并告警；
      此时不出图，绝不会因为模型格式抖动而误判成可出图。
    - 意图不在白名单 / 风格不在白名单 → 一律降级为 "none"（不臆造、不出图）。
    - `in_scope=False` → intent/style 全部清空，调用方返回固定话术。
    """
    history_msgs = history_messages(history)
    messages = [{
        "role": "system",
        "content": INTENT_SYSTEM_PROMPT + history_digest(history),
    }]
    messages += history_msgs
    messages.append({
        "role": "user",
        "content": f"【待判断的用户消息】{text}\n【这条消息是否附带图片】{'有' if has_image else '无'}",
    })
    raw = _chat(messages, temperature=0.1, max_tokens=200)

    data = _parse_json_object(raw)
    if not data:
        current_app.logger.warning("意图门输出无法解析，按「范围内/仅建议」处理：%s", raw[:120])
        return {"in_scope": True, "intent": "none", "style": "", "reason": "parse-failed"}

    in_scope = bool(data.get("in_scope"))
    intent = str(data.get("intent") or "none").strip()
    style = str(data.get("style") or "").strip()
    reason = str(data.get("reason") or "")[:20]

    if not in_scope:
        return {"in_scope": False, "intent": "none", "style": "", "reason": reason}

    if intent not in CHAT_INTENT_SPECS:
        intent, style = "none", ""
    elif intent == "style":
        if style not in ai_service.STYLE_WHITELIST:
            # 白名单外/缺失的风格不臆造：降级为仅建议，由回复引导用户从五个风格里选
            current_app.logger.warning("意图门给出白名单外风格（%r），降级为仅建议", style)
            intent, style = "none", ""
    else:
        style = ""
    return {"in_scope": True, "intent": intent, "style": style, "reason": reason}


# ==================== 闸门 B：用户可见回复 ====================

def _reply_context(
    intent: str, style: str, has_image: bool, outcome: str, inherited: bool = False
) -> str:
    """把「本次系统内部信息」交给表达门，让回复与真实结果一致（不要逐字复述）。"""
    name = (CHAT_INTENT_SPECS.get(intent) or {}).get("name") or "无（仅咨询或建议）"
    if outcome == "ok":
        how = (
            "已经按识别到的意图处理好了图片，结果图已展示在对话里。"
            "用一句话告诉用户处理好了、邀请他看效果，可提示可「保存到作品」或「去编辑」继续精修。"
        )
    elif outcome == "fail":
        how = "本次图像处理失败了（上游超时或报错）。用一句话表示这次没成功、可以再试一次，不要编造原因。"
    elif outcome == "no_image":
        how = "确实没有可处理的图片（本会话里也没有）。用一句话请他点输入框左侧的相册图标上传一张照片再发一次。"
    elif outcome == "no_text":
        how = (
            "用户只上传了图片、没有写要求。用一句话问他这张图想怎么修，并给一两个例子"
            "（例如「帮我磨皮美白」「换个干净的背景」）。"
        )
    else:
        how = "本次没有做图像处理（只是咨询或建议）。直接回答他的问题，或给一条具体可操作的建议。"
    lines = [
        "",
        "",
        "【本次上下文（内部信息，不要逐字复述，也不要提及这是系统提示）】",
        f"- 识别到的意图：{name}",
        f"- 是否附带图片（本条）：{'有' if has_image and not inherited else '无'}",
        f"- 本次结果：{how}",
    ]
    if inherited:
        # 用户「发图 → 出图 → 接着说要求」是高频路径：此时客服式地让他「再上传一次」会显得像 bug，
        # 因此服务端已自动沿用会话里最近一张图（见 api/chat.py 的 _latest_image），回复要说清这一点。
        lines.append(
            "- 重要：用户这条消息**没有附图**，本次是**自动沿用会话里最近的那张图**继续处理的；"
            "回复里用「在刚才那张图上」这类说法即可，**不要**让他重新上传照片。"
        )
    if style:
        lines.append(f"- 涉及风格：{style}")
    return "\n".join(lines)


def compose_reply(
    text: str, *, intent: str, style: str, has_image: bool, outcome: str,
    inherited: bool = False, history=None,
) -> str:
    """生成面向用户的回复（范围内）。history 为最近若干条历史（role/content）。"""
    history_msgs = history_messages(history)
    system = (
        REPLY_SYSTEM_PROMPT
        + history_digest(history)
        + _reply_context(intent, style, has_image, outcome, inherited)
    )
    messages = [{"role": "system", "content": system}]
    messages += history_msgs
    messages.append({"role": "user", "content": text})
    return _chat(messages, temperature=0.6, max_tokens=300)


# ==================== 出图指令（服务端固定模板） ====================

def is_editable(intent: str) -> bool:
    """该意图是否可出图（"none" 与非法值都不可）。"""
    return intent in CHAT_INTENT_SPECS


def build_edit(intent: str, style: str | None = None) -> tuple[str, dict]:
    """取某意图的固定指令与参数。

    这是对话链路里**唯一**的图像指令来源：调用方（api 层）只能传意图名与风格名，
    两者都必须先过白名单；模板里没有用户文本占位符，因此不存在指令注入面。
    """
    spec = CHAT_INTENT_SPECS.get(intent)
    if not spec:
        raise ValueError("不可出图的意图")
    prompt = spec["prompt"]
    if "{style}" in prompt:
        prompt = prompt.format(style=ai_service.validate_style(style))
    return prompt, dict(spec.get("params") or {})


def intent_name(intent: str) -> str:
    """意图中文名（用于日志与响应，不用于出图）。"""
    return (CHAT_INTENT_SPECS.get(intent) or {}).get("name") or ""
