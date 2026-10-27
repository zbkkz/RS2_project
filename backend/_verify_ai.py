"""四能力真实调用自测脚本（临时工具，检查完可删除，与 _verify_api.py 同一形态）。

用法：
    python _verify_ai.py                     # 四个能力各发一次真实请求（会消耗额度）
    python _verify_ai.py --ability matting   # 只验一个能力
    python _verify_ai.py --style 水彩 --ability style
    python _verify_ai.py --dry               # 只打印解析后的能力级配置，不发请求（不消耗额度）

为什么需要它：一键区分「配置问题」与「代码问题」——
真实请求失败时会把服务商的原始错误打出来（状态码 / request_id / code / message 片段），
例如 InvalidApiKey（密钥）、Model not exist（模型名）、Throttling/QuotaExceeded（额度）都一眼可辨。
"""
import argparse
import io
import os
import sys
import time

from PIL import Image, ImageDraw

from app import create_app
from app.services import ai as ai_service
from config import ai_api_key, ai_daily_limit, ai_model

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads", "ai", "_verify")


def make_test_image(width=1200, height=900) -> bytes:
    """造一张有明确主体 + 纹理背景的测试图：便于判断抠图/风格迁移是否真的生效。"""
    im = Image.new("RGB", (width, height), (70, 130, 200))
    d = ImageDraw.Draw(im)
    # 背景网格（若被风格化/磨平，肉眼可辨）
    for x in range(0, width, 120):
        d.line([(x, 0), (x, height)], fill=(120, 170, 230), width=3)
    for y in range(0, height, 120):
        d.line([(0, y), (width, y)], fill=(120, 170, 230), width=3)
    # 主体：中央橙色圆 + 深色描边
    d.ellipse([width * 0.30, height * 0.20, width * 0.70, height * 0.80],
              fill=(250, 180, 90), outline=(40, 40, 60), width=8)
    # 人像示意（供 AI 美颜有可处理区域）
    d.ellipse([width * 0.44, height * 0.30, width * 0.56, height * 0.44], fill=(248, 214, 190))
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def describe_config(app, ability: str) -> tuple[str, str, int]:
    """打印该能力解析出的密钥/模型/配额（只显示来源与长度，不打印密钥本身）。"""
    with app.app_context():
        key = ai_api_key(ability)
        model = ai_model(ability)
        limit = ai_daily_limit(ability)
        override = (app.config.get("AI_ABILITY_OVERRIDES") or {}).get(ability) or {}
        key_from = f"AI_API_KEY_{ability.upper()}" if override.get("api_key") else "AI_API_KEY"
        model_from = f"AI_MODEL_{ability.upper()}" if override.get("model") else "AI_MODEL"
        limit_from = (
            f"AI_DAILY_LIMIT_{ability.upper()}" if override.get("daily_limit") else "AI_DAILY_LIMIT"
        )
        print(
            f"   密钥 {key_from}（{'已配置 len=%d' % len(key) if key else '未配置 → 会返回 3005'}）"
            f" | 模型 {model_from}={model or '-'}"
            f" | 每日上限 {limit_from}={limit}"
            f" | 长边上限 AI_MAX_EDGE={app.config.get('AI_MAX_EDGE')}"
        )
    return key, model, limit


def run_one(app, ability: str, style: str | None) -> bool:
    with app.app_context():
        spec = ai_service.ability_spec(ability)
        if not spec:
            print(f"[SKIP] {ability}：不是受支持的能力（api 层会返回 3004）")
            return False
        print(f"[{ability}] {spec['name']}")
    key, model, _ = describe_config(app, ability)
    if not key:
        return False
    if spec["style_required"] and not style:
        print("   提示：该能力必须有风格，已使用默认 油画（可用 --style 指定）")
        style = "油画"

    img = make_test_image()
    started = time.monotonic()
    try:
        with app.app_context():
            data = ai_service.image_edit(
                img, "verify.png", ability, style, api_key=key, model=model
            )
    except Exception as e:  # noqa: BLE001 诊断脚本：任何异常都要打印出来
        elapsed = time.monotonic() - started
        print(f"  [FAIL] {type(e).__name__}: {e}（耗时 {elapsed:.1f}s）")
        return False

    elapsed = time.monotonic() - started
    try:
        with Image.open(io.BytesIO(data)) as im:
            size = im.size
    except Exception:  # noqa: BLE001
        size = ("?", "?")
    os.makedirs(OUT_DIR, exist_ok=True)
    name = f"{ability}{('_' + style) if style else ''}.jpg"
    path = os.path.join(OUT_DIR, name)
    with open(path, "wb") as f:
        f.write(data)
    print(f"  [OK] 耗时 {elapsed:.1f}s | 结果 {size[0]}x{size[1]} {len(data) // 1024}KB → {path}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="AI 四能力真实调用自测")
    parser.add_argument("--ability", help="只验某个能力（matting/style/enhance/beauty）")
    parser.add_argument("--style", help="风格迁移使用的风格（默认 油画）")
    parser.add_argument("--dry", action="store_true", help="只打印能力级配置，不发请求")
    args = parser.parse_args()

    abilities = [args.ability] if args.ability else list(ai_service.ABILITY_SPECS.keys())
    app = create_app()

    with app.app_context():
        print(f"能力标识：{', '.join(ai_service.ABILITY_SPECS.keys())}")
        print(f"风格白名单：{' / '.join(ai_service.STYLE_WHITELIST)}")
        print(f"服务商地址：{app.config.get('AI_API_BASE')}")

    if args.dry:
        for ability in abilities:
            if ai_service.ability_spec(ability):
                print(f"[{ability}]")
                describe_config(app, ability)
        return 0

    results = {ability: run_one(app, ability, args.style) for ability in abilities}
    print("\n==== 小结 ====")
    for ability, ok in results.items():
        print(f"  {ability}: {'出图成功' if ok else '未出图（详见上方日志）'}")
    print(f"结果图目录：{OUT_DIR}（诊断产物，可随时删除）")
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
