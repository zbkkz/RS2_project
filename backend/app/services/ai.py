# app/services/ai.py
"""AI 图像能力服务层（服务商无关）。

默认对接阿里云百炼 DashScope 的图像编辑（I2I）：
    POST {AI_API_BASE}/services/aigc/multimodal-generation/generation
输入 Base64 图片 + 文本指令 → 输出临时图 URL（有效期有限，因此立即下载落盘）。

**能力隔离**（见 README 7.3）：每个能力的处理指令与参数只在本文件的 `ABILITY_SPECS` 中定义，
客户端只能传「图片 +（风格迁移的）风格名」，无法传入或覆盖指令、模型与其它参数；
风格名必须命中 `STYLE_WHITELIST`（与前端 editor.js 的 `AI_STYLES` 同源）。
这样即使有人改前端或直接打接口，也做不出「用风格迁移去抠图」这类越界调用。

更换服务商只需重写本文件的 `image_edit()`，api 层不变。
"""
import base64
import io
import mimetypes
import time

import requests
from flask import current_app

# ==================== 能力规格表：服务端唯一权威 ====================
# prompt        该能力**固定**的处理指令（只有风格迁移含 {style} 占位符）
# name          能力中文名（用于提示文案与日志）
# style_required 是否必须携带风格名（且必须命中白名单）
# params        透传给服务商的 parameters（同样由服务端固定，客户端不可改）

# 与对话链路（`services/chat.py` 的 CHAT_INTENT_SPECS）**共用**的固定指令：
# 「换背景」「发型发色」这两项同时在编辑页（本表）与聊天页出图（chat.py）里可用，
# 同一能力只能有一份指令文案，否则改一处忘一处就会出现两套口径（见 README 11.3 第 48 条）。
# 其余四项（抠图/风格/修复/美颜）在两条链路里的文案本就略有差异，未做合并 ——
# 合并会牵动对话链路（提示词口径与 _verify_chat.py 断言），属额外的回归风险。
ABILITY_PROMPTS = {
    "background": "把画面背景替换为干净简洁的纯色或柔和渐变背景，主体完整保留、边缘自然贴合、光照方向一致。",
    "hair": "只修改图中人物的发型与发色，发丝自然、与画面光照一致；保持五官、表情、肤色、衣着与背景完全不变。",
}

ABILITY_SPECS = {
    "matting": {
        "name": "智能抠图",
        "prompt": "把图中的主体物体完整抠出来，仅保留前景主体，背景处理为纯白纯净透明，边缘干净无残留。",
        "style_required": False,
        "params": {"negative_prompt": "低质量、模糊、变形、噪点、背景残留", "watermark": False},
    },
    "style": {
        "name": "风格迁移",
        "prompt": "将图片整体转换为{style}风格，保留主体结构与内容不变，只改变艺术风格。",
        "style_required": True,
        "params": {"negative_prompt": "低质量、模糊、变形、噪点、改变主体结构", "watermark": False},
    },
    "enhance": {
        "name": "画质修复",
        "prompt": (
            "对图片进行画质增强：提高清晰度与分辨率感，去除噪点、模糊与压缩痕迹，"
            "增强细节质感，保持内容真实不变。"
        ),
        "style_required": False,
        "params": {"negative_prompt": "低质量、模糊、噪点、过度磨皮、改变画面内容", "watermark": False},
    },
    "beauty": {
        "name": "AI美颜",
        "prompt": "对图中人像进行自然美颜：适度磨皮、提亮肤色美白、优化五官轮廓，保持真实自然不过度。",
        "style_required": False,
        "params": {"negative_prompt": "低质量、模糊、变形、过度磨皮、塑料感", "watermark": False},
    },
    # 下面两项的指令取自 ABILITY_PROMPTS（与聊天页出图共用同一份文案）
    "background": {
        "name": "换背景",
        "prompt": ABILITY_PROMPTS["background"],
        "style_required": False,
        "params": {"negative_prompt": "低质量、模糊、变形、噪点、改变主体结构", "watermark": False},
    },
    "hair": {
        "name": "发型发色",
        "prompt": ABILITY_PROMPTS["hair"],
        "style_required": False,
        "params": {"negative_prompt": "低质量、模糊、变形、噪点、改变人物身份与五官", "watermark": False},
    },
}

# 风格白名单（仅风格迁移使用）：只认这五个，与前端 AI_STYLES 一一对应
STYLE_WHITELIST = ("油画", "素描", "动漫", "水彩", "赛博朋克")

# 允许的输入图片 mime（与上传白名单一致）
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}


class AIError(Exception):
    """AI 调用异常（业务错误码 3002）。

    message 里带可诊断信息（状态码 / request_id / 响应片段截断），**不得包含密钥**。
    """

    def __init__(self, message="AI 服务处理失败", *args):
        super().__init__(message, *args)


class AITimeout(AIError):
    """上游在总预算内没返回结果（3002，但文案是「超时」而不是「处理失败」）。

    单独一类的原因有两条：
    ① 给客户端的提示要能区分「可重试的超时」与「上游报错的失败」；
    ② 它**不是**网络类错误，绝不能被重试逻辑吞掉 —— 长耗时生成重试一次就把耗时与费用翻倍，
       而且大概率再超时一次（见 `_call_provider`）。
    """


# ==================== 能力与风格校验 ====================

def ability_spec(ability: str) -> dict | None:
    """取能力规格；不支持的能力返回 None（api 层据此返回 3004）。"""
    return ABILITY_SPECS.get(str(ability or "").strip())


def validate_style(style: str | None) -> str:
    """风格白名单校验：通过返回规范化风格名，否则抛 ValueError（api 层映射 3004）。

    这是「风格迁移只能做风格迁移」的关键一环：风格值只能取白名单里的枚举，
    不存在把任意指令塞进 {style} 占位符的通道（旧实现是任意文本，已收紧）。
    """
    value = (style or "").strip()
    if value not in STYLE_WHITELIST:
        raise ValueError("风格不在白名单内")
    return value


def build_prompt(ability: str, style: str | None = None) -> str:
    """按能力规格拼装固定指令（内部使用；风格迁移会先行校验风格）。"""
    spec = ABILITY_SPECS.get(ability)
    if not spec:
        raise ValueError("不支持的 AI 能力")
    template = spec["prompt"]
    if "{style}" in template:
        return template.format(style=validate_style(style))
    return template


# ==================== 图片预处理与编码 ====================

def guess_mime(filename: str = "") -> str:
    mime = mimetypes.guess_type(filename or "")[0] or "image/jpeg"
    return mime if mime in ALLOWED_MIME else "image/jpeg"


def encode_image(image_bytes: bytes, filename: str = "", mime: str | None = None) -> str:
    """转为 data URI，供百炼 I2I 输入。支持 jpg/jpeg/png/webp。"""
    return f"data:{mime or guess_mime(filename)};base64,{base64.b64encode(image_bytes).decode()}"


def preprocess(image_bytes: bytes, filename: str = "") -> tuple[bytes, str]:
    """送 AI 前的预缩放：长边超过 AI_MAX_EDGE 时等比缩小并转 JPEG，返回 (字节, mime)。

    图生图要把图片 base64 内联进 JSON，长边越大体积与耗时增长越快（易触发超时），
    因此统一压到上限；`AI_MAX_EDGE` 配 0/负数表示不缩放（原样返回，mime 按文件名推断）。
    解析失败（图片损坏等）不在这里抛错，原样返回交给服务商报错，保证错误来源单一。
    """
    max_edge = int(current_app.config.get("AI_MAX_EDGE") or 0)
    mime = guess_mime(filename)
    if max_edge <= 0:
        return image_bytes, mime
    try:
        from PIL import Image, ImageOps

        with Image.open(io.BytesIO(image_bytes)) as im:
            im = ImageOps.exif_transpose(im)
            if max(im.width, im.height) <= max_edge:
                return image_bytes, mime
            im.thumbnail((max_edge, max_edge), Image.LANCZOS)
            if im.mode != "RGB":
                im = im.convert("RGB")
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=92)
            current_app.logger.info(
                "AI 入参预缩放：%sx%s → 长边 %s（%sKB → %sKB）",
                im.width, im.height, max_edge, len(image_bytes) // 1024, buf.tell() // 1024,
            )
            return buf.getvalue(), "image/jpeg"
    except Exception:  # noqa: BLE001 图片不可解析时不缩放，交给服务商报错
        current_app.logger.warning("AI 入参预缩放失败，改用原图")
        return image_bytes, mime


# ==================== 服务商调用 ====================

def _auth_headers(api_key: str) -> dict:
    return {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}


def provider_name(config_key: str = "AI_API_BASE") -> str:
    """服务商标识（写进 `edit_records.params`，便于事后核对某次调用走的哪家）。

    图像能力看 `AI_API_BASE`，对话 / 语音识别看 `AI_CHAT_API_BASE` —— 解析规则只有这一份，
    避免 api 层各写一遍后两边口径漂移（见 README 11.3 第 48 条）。
    """
    base = (current_app.config.get(config_key) or "").strip()
    return base.split("//")[-1].split("/")[0] or "unknown"


def _read_timeout() -> int:
    """取配置里的读取超时（AI_TIMEOUT 为 (连接, 读取) 元组）。

    兜底值与 `config.py` 的 `AI_TIMEOUT` 保持一致（配置缺失时才走到这里）：
    两处不一致会让「配置没了」这种异常状态下悄悄退回一个更短的超时，表现为高分辨率偶发 3002。
    """
    timeout = current_app.config.get("AI_TIMEOUT") or (10, 300)
    return int(timeout[1] if isinstance(timeout, (tuple, list)) else timeout)


def _total_budget() -> float:
    """单次 AI 能力的总墙钟预算（秒），覆盖所有重试与异步轮询。

    它必须**严格小于**小程序端 `uploadFile` 的等待时间（前端 `AI_UPLOAD_TIMEOUT`）：
    否则客户端会先放弃连接、服务端随后才出图并落库 —— 用户看到「处理失败」，
    却在「我的作品」里多出一张图，同时这一次调用照样计费（2026-09 实测复现过一次）。
    """
    # 兜底值与 config.py 的 AI_TOTAL_TIMEOUT 默认值保持一致（240，见 7.x「耗时预算」）
    return float(current_app.config.get("AI_TOTAL_TIMEOUT") or 240)


def _describe_failure(resp) -> str:
    """从失败响应里提取可诊断信息（状态码 / request_id / 错误码与消息），不含密钥。"""
    try:
        body = resp.json()
    except ValueError:
        body = None
    if isinstance(body, dict):
        request_id = body.get("request_id") or (body.get("output") or {}).get("task_id")
        parts = [str(x) for x in (body.get("code"), body.get("message")) if x]
        detail = " | ".join(parts) or str(body)[:200]
    else:
        request_id = None
        detail = (resp.text or "")[:200]
    return f"HTTP {resp.status_code} request_id={request_id or '-'} {detail}"


def extract_image_url(body: dict) -> str | None:
    """解析结果图 URL，兼容两种返回形态：

    - 同步：`output.choices[0].message.content[*].image`
    - 异步任务：`output.results[*].url`（配合 `output.task_id` 轮询）
    """
    output = body.get("output") or {}
    choices = output.get("choices") or []
    if choices:
        content = (choices[0].get("message") or {}).get("content") or []
        for part in content if isinstance(content, list) else []:
            if isinstance(part, dict) and part.get("image"):
                return part["image"]
    results = output.get("results") or []
    for item in results if isinstance(results, list) else []:
        if isinstance(item, dict) and (item.get("url") or item.get("image")):
            return item.get("url") or item.get("image")
    return None


def _poll_task(base: str, task_id: str, headers: dict, deadline: float) -> str:
    """异步任务兜底：轮询 `GET {base}/tasks/<task_id>` 直到成功、失败或耗尽总预算。

    `deadline` 由 `_call_provider` 透传（绝对单调时间），因此轮询不会另起一份超时，
    整个能力的墙钟耗时始终由 `AI_TOTAL_TIMEOUT` 兜住。
    """
    url = f"{base}/tasks/{task_id}"
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 5:
            raise AITimeout(f"AI 任务轮询超出总预算（task_id={task_id}）")
        resp = requests.get(url, headers=headers, timeout=(10, min(30, remaining)))
        if resp.status_code != 200:
            raise AIError(f"AI 任务查询失败：{_describe_failure(resp)}")
        body = resp.json()
        status = str((body.get("output") or {}).get("task_status") or "").upper()
        if status in ("SUCCEEDED", "SUCCESS"):
            image_url = extract_image_url(body)
            if image_url:
                return image_url
            raise AIError(f"AI 任务完成但无结果图：{str(body)[:200]}")
        if status in ("FAILED", "CANCELED", "CANCELLED", "UNKNOWN"):
            raise AIError(f"AI 任务失败：{_describe_failure(resp)}")
        time.sleep(min(2, max(0.0, deadline - time.monotonic())))


def _call_provider(
    data_uri: str, prompt: str, params: dict, *, api_key: str, model: str, deadline: float
) -> str:
    """调用服务商图像编辑，返回结果图 URL。

    超时口径（见 README 7.x「耗时预算」）：
    - `deadline` 是本次能力的总墙钟预算终点，重试与轮询都在它之内，**不会**各算一份超时；
    - 单次请求的读取超时取 `min(AI_TIMEOUT.read, 剩余预算)`；
    - 重试只针对「请求没发出去」的瞬时故障（连接超时、连不上、DNS 等）；
      上游**读超时**（请求已发出但预算内没出图）直接判超时并抛出 —— 重试一次就翻倍耗时与费用，
      而且大概率再超一次，纯属把用户的等待时间拉长一倍。
    """
    base = (current_app.config.get("AI_API_BASE") or "").rstrip("/")
    url = f"{base}/services/aigc/multimodal-generation/generation"
    payload = {
        "model": model,
        "input": {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"image": data_uri},
                        {"text": prompt},
                    ],
                }
            ]
        },
        "parameters": dict(params or {}),
    }
    headers = _auth_headers(api_key)

    attempts = int(current_app.config.get("AI_RETRY") or 0) + 1
    last_err = None
    for attempt in range(attempts):
        remaining = deadline - time.monotonic()
        if remaining <= 5:
            raise AITimeout(f"AI 处理超出总预算 {_total_budget():.0f}s")
        read_to = min(_read_timeout(), remaining)
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=(10, read_to))
        except requests.Timeout as e:
            if isinstance(e, requests.ConnectTimeout):
                # 连接都没建立：请求没发出去，属于可重试的瞬时故障
                last_err = e
                if attempt < attempts - 1:
                    current_app.logger.warning("AI 连接超时，准备重试：%s", e)
                    continue
                break
            raise AITimeout(
                f"AI 处理超时（单次读取上限 {read_to:.0f}s，总预算 {_total_budget():.0f}s）"
            ) from e
        except requests.RequestException as e:
            # 连接类错误：可重试
            last_err = e
            if attempt < attempts - 1:
                current_app.logger.warning("AI 请求网络异常，准备重试：%s", e)
                continue
            break

        if resp.status_code != 200:
            # 4xx/5xx 是业务失败（鉴权/模型/参数/额度），重试没有意义
            raise AIError(f"AI 服务返回异常：{_describe_failure(resp)}")
        try:
            body = resp.json()
        except ValueError:
            raise AIError(f"AI 返回非 JSON：{(resp.text or '')[:200]}")
        image_url = extract_image_url(body)
        if image_url:
            return image_url
        task_id = (body.get("output") or {}).get("task_id")
        if task_id:
            # 兼容异步任务形态（部分模型/账号会返回 task_id 而不是直接给图）
            return _poll_task(base, task_id, headers, deadline)
        raise AIError(f"AI 无返回结果：{str(body)[:200]}")

    current_app.logger.warning("AI 请求重试仍失败：%s", last_err)
    raise AIError(f"AI 服务网络异常：{last_err}")


def download(url: str) -> bytes:
    """下载结果图（结果 URL 有有效期，必须立即取回后落盘）。

    读取上限 30s：该阶段不计入 `AI_TOTAL_TIMEOUT`（图已出好，不该因为预算刚好用完而丢弃），
    但它属于「服务端最坏耗时」，必须与前端等待留出的余量对齐（见 config.AI_TOTAL_TIMEOUT 注释）。
    """
    resp = requests.get(url, timeout=(10, 30))
    resp.raise_for_status()
    return resp.content


def encode_result(result_bytes: bytes) -> tuple[bytes, str]:
    """整理上游结果图，返回 (落盘字节, 扩展名)。

    上游返回的是 PNG，实测 2064×2016 有 3.7MB —— 出图后客户端还要再下载这张图才能显示，
    存储与作品列表也都背着它。转 JPEG(q92) 后通常降到 0.5MB 左右，客户端等待明显变短。
    只在**没有透明通道**时才转：模型将来若真的输出带 alpha 的抠图结果，
    转 JPEG 会把透明区域压成黑色，那种情况原样保留 PNG。
    """
    try:
        from PIL import Image

        with Image.open(io.BytesIO(result_bytes)) as im:
            if im.mode in ("RGBA", "LA") or "transparency" in im.info:
                return result_bytes, ".png"
            buf = io.BytesIO()
            im.convert("RGB").save(buf, "JPEG", quality=92, optimize=True)
            return buf.getvalue(), ".jpg"
    except Exception:  # noqa: BLE001 转码失败就用原图落盘，不能因为「优化」把结果弄丢
        current_app.logger.warning("AI 结果图转 JPEG 失败，按原图落盘")
        return result_bytes, ".png"


# ==================== 对外入口 ====================

def edit_with_prompt(
    image_bytes: bytes,
    filename: str,
    prompt: str,
    params: dict | None = None,
    *,
    api_key: str,
    model: str,
    label: str = "",
) -> bytes:
    """按**服务端给定**的指令执行一次图像编辑，返回结果图字节。

    这是图像能力的底层出口：`image_edit()`（六能力白名单）与对话链路的
    `services/chat.py`（按 `CHAT_INTENT_SPECS` 固定模板）都走它。

    **它不是「客户端可传指令」的通道**：`prompt` 只能由服务端模块构造，
    面向客户端的两个入口都只接受「图片 +（白名单内的）枚举值」，指令一律服务端生成
    （见 README 7.3 / 11.3 第 32 条）。入参按 `AI_MAX_EDGE` 预缩放，结果图立即下载。
    """
    prepared, mime = preprocess(image_bytes, filename)
    data_uri = encode_image(prepared, mime=mime)

    started = time.monotonic()
    deadline = started + _total_budget()
    result_url = _call_provider(
        data_uri, prompt, dict(params or {}), api_key=api_key, model=model, deadline=deadline
    )
    result = download(result_url)
    current_app.logger.info(
        "AI 指令编辑 %s 完成：model=%s 入参 %sKB → 结果 %sKB，耗时 %.1fs",
        label or "-", model, len(prepared) // 1024, len(result) // 1024,
        time.monotonic() - started,
    )
    return result


def image_edit(
    image_bytes: bytes,
    filename: str,
    ability: str,
    style: str | None = None,
    *,
    api_key: str,
    model: str,
) -> bytes:
    """执行一次 AI 图像处理（六能力），返回处理后的图片字节。

    - 指令与参数取自 `ABILITY_SPECS`（客户端不可注入）；
    - 风格迁移会先过 `STYLE_WHITELIST` 校验，非法直接抛 ValueError（api 层映射 3004）；
    - 密钥与模型由 api 层按能力解析后注入（缺省回落全局，见 config.ai_api_key / ai_model）；
    - 入参预缩放、结果图下载与**生成阶段**的 `AI_TOTAL_TIMEOUT` 预算约束都在
      `edit_with_prompt()` 里（含结果图下载，图已出好时不该因为预算刚好用完而丢弃）。
    """
    spec = ABILITY_SPECS.get(ability)
    if not spec:
        raise ValueError("不支持的 AI 能力")
    prompt = build_prompt(ability, style)
    return edit_with_prompt(
        image_bytes, filename, prompt, spec["params"],
        api_key=api_key, model=model, label=ability,
    )
