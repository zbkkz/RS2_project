# app/services/asr.py
"""语音识别服务：把一段录音转成文字（「AI 智能处理」聊天页的麦克风输入，见 README 7.4）。

契约（2026-10 用本项目 .env 的真实 key 实测通过）：
    POST {AI_CHAT_API_BASE}/chat/completions
    {"model": "qwen3-asr-flash",
     "messages": [{"role": "user", "content": [
         {"type": "input_audio", "input_audio": {"data": "data:audio/wav;base64,...", "format": "wav"}}]}]}
    → choices[0].message.content = 识别文本（annotations[].language / emotion）

**关键坑**：`input_audio.data` 必须是 **data URI**（`data:audio/wav;base64,...`），
直接传裸 base64 会被上游判为「The provided URL does not appear to be valid」而 400
（同一次实测里对照验证过）。这里统一由服务端拼 data URI，客户端只上传音频字节。
"""
import base64

from flask import current_app

from app.services.chat import compatible_chat
from config import asr_model

# 允许的录音格式（小程序 RecorderManager 的 format 取值：mp3 / aac / wav / pcm 的子集）
# pcm 不在内：它是无头裸流，裸传给 ASR 无法自描述时长与声道，需要额外封装，故不支持
ALLOWED_AUDIO_EXT = ("mp3", "wav", "aac", "m4a")

# 扩展名 → data URI 的 mime
_MIME = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "aac": "audio/aac",
    "m4a": "audio/mp4",
}


def normalize_ext(filename: str = "") -> str:
    """取规范化的音频扩展名；不支持的格式抛 ValueError（api 层映射 3012）。"""
    ext = (filename or "").rsplit(".", 1)[-1].strip().lower()
    if ext == "mp4":  # 微信录音在部分安卓机上报 .mp4，本质是 m4a 容器
        ext = "m4a"
    if ext not in ALLOWED_AUDIO_EXT:
        raise ValueError("不支持的音频格式")
    return ext


def max_audio_size() -> int:
    """音频大小上限：复用上传大小上限（默认 10MB）。

    60s 的 mp3 录音约 0.5MB，正常远不会触及；设这条线是为了挡住「把大文件当语音传」。
    """
    return int(current_app.config.get("MAX_UPLOAD_SIZE") or 10 * 1024 * 1024)


def transcribe(audio_bytes: bytes, filename: str = "") -> dict:
    """把音频转写为文本，返回 `{"text": str, "ext": str}`。

    - 格式/大小不合法 → ValueError（api 层 3012）；
    - 上游超时 → `AITimeout`、其它失败 → `AIError`（api 层 3002，细节只进日志）；
    - 静音或无有效语音 → 返回空串（不是错误，由前端提示「没听清」）。
    """
    ext = normalize_ext(filename)
    if not audio_bytes:
        raise ValueError("音频内容为空")
    limit = max_audio_size()
    if len(audio_bytes) > limit:
        raise ValueError(f"音频过大（上限 {limit // (1024 * 1024)}MB）")

    data_uri = f"data:{_MIME[ext]};base64,{base64.b64encode(audio_bytes).decode()}"
    messages = [{
        "role": "user",
        "content": [{"type": "input_audio", "input_audio": {"data": data_uri, "format": ext}}],
    }]
    # compatible_chat 的第二个返回值（usage）本链路不使用：原先顺手塞进返回体的
    # `"seconds"` 恒为 None 且无人读取，已删除（docstring 里的返回结构才是真实契约）
    text, _usage = compatible_chat(
        messages, model=asr_model(), temperature=0.0, max_tokens=1024, label="语音识别"
    )
    return {"text": text, "ext": ext}
