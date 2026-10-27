# cleanup_temp.py
"""手动回收 `uploads/ai/` 的 AI 临时结果图（**判定逻辑与自动回收完全同一份**，见 README 7.5）。

正常情况下**不需要手动跑**：后端启动后会自动定期回收（后台线程，默认每 6 小时一次，
见 `app/services/maintenance.py`）。这个脚本保留用于：
- 想立刻回收一次（不想等后台线程的首次延迟 / 间隔）；
- 联调时用 `--hours 1` 更激进地清理；
- 用系统计划任务 / 容器 sidecar 代替后台线程（把 `AUTO_CLEANUP=0` 关掉自动线程即可）。

三类判定（判定顺序即优先级）：

| 情况 | 处理 | 依据 |
|------|------|------|
| 被**作品**引用（`works.image_path` / `thumb_path`） | **永不删除** | 已入作品库，删了就图裂 |
| 只被**对话消息**引用（`chat_messages.image_path`） | 超过 `--chat-hours`（默认 **168h = 7 天**）才删 | 用户会回头翻会话，图不该隔天就没了 |
| 谁都没引用 | 超过 `--hours`（默认 **24h**）删除 | 纯中间产物 |

删除「被对话引用」的文件时，**同时把那条消息的 `image_path` 置空**，不留悬空引用。
只处理 `uploads/ai/` 的**一层**（子目录如 `ai/_verify/` 不参与）。

    python cleanup_temp.py                  # 回收
    python cleanup_temp.py --dry-run        # 只列出，不删文件也不改库
    python cleanup_temp.py --hours 1        # 缩短无引用文件的保留期（联调可用）
    python cleanup_temp.py --chat-hours 24  # 缩短「仅对话引用」的保留期
"""
import argparse
import sys

from app import create_app
from app.services import maintenance


def _keep_hours(value: str) -> float:
    """保留期参数：负值会让 cutoff 落在「未来」，把所有无引用文件一并删掉，故在解析阶段就拒绝。"""
    number = float(value)
    if number < 0:
        raise argparse.ArgumentTypeError("保留期不能为负数")
    return number


def main() -> int:
    parser = argparse.ArgumentParser(description="回收 uploads/ai 下的 AI 临时结果图")
    # help 文案直接引用常量，避免「常量改了、帮助文本还写着旧数字」这类漂移
    parser.add_argument("--hours", type=_keep_hours, default=maintenance.DEFAULT_KEEP_HOURS,
                        help=f"无引用文件的保留期（小时），默认 {maintenance.DEFAULT_KEEP_HOURS:g}")
    parser.add_argument("--chat-hours", type=_keep_hours, default=maintenance.DEFAULT_CHAT_KEEP_HOURS,
                        help="仅被对话消息引用的文件的保留期（小时），"
                             f"默认 {maintenance.DEFAULT_CHAT_KEEP_HOURS:g}（7 天）")
    parser.add_argument("--dry-run", action="store_true", help="只列出，不删除也不改库")
    args = parser.parse_args()

    app = create_app()
    if args.dry_run:
        # dry-run 不改库、不删文件，没有并发风险，且**不该**写「上次运行时间」——
        # 否则一次试跑会把后台自动回收的节奏整体推迟一个周期（只探测却影响了调度）
        with app.app_context():
            result = maintenance.cleanup_temp_files(
                hours=args.hours, chat_hours=args.chat_hours, dry_run=True
            )
    else:
        # 与后台线程共用同一条**带锁**入口：手动跑时不会和自动回收同时删同一批文件
        # （抢不到锁返回 None → 直接告知用户，而不是硬跑一遍）
        result = maintenance.run_cleanup(app, hours=args.hours, chat_hours=args.chat_hours)
        if result is None:
            print("另一个实例（后台自动回收 / 另一个手动进程）正在清理，本次跳过")
            return 1

    for rel, size, reason in result["items"]:
        head = "[dry-run] 将删除" if args.dry_run else "已删除"
        print(f"  {head} {rel}（{size // 1024}KB，{reason}）")

    # dry-run 时 `deleted` 恒为 0（脚本按设计不删文件），汇总若照抄它就会与上面逐条列出的
    # 「将删除」自相矛盾；这里统一按「本次命中的条数」报数，并把动词一并切换
    count = len(result["items"]) if args.dry_run else result["deleted"]
    verb = "将删除" if args.dry_run else "删除"
    print(
        f"AI 临时图清理完成：{verb} {count} 个"
        f"（{result['freed'] / 1024 / 1024:.1f}MB），"
        f"保留 {result['kept_ref']} 个（被作品引用）、"
        f"{result['kept_chat']} 个（对话引用且 {args.chat_hours:g}h 内）、"
        f"{result['kept_fresh']} 个（{args.hours:g}h 内的新文件）"
        + (f"，清空悬空引用 {result['cleared']} 条" if result["cleared"] else "")
        + ("（dry-run，未真正删除）" if args.dry_run else "")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
