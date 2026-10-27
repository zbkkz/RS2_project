# app/services/maintenance.py
"""后台维护任务：自动回收 `uploads/ai/` 的 AI 临时结果图（见 README 7.5）。

**为什么需要自动**：临时图是**持续产生**的（每次 AI 调用落一张），只靠人工记得跑
`cleanup_temp.py` 必然堆积 —— 实测半天就攒了 17 张、12MB+。用户要的是「不用自己去检查」。

**调度设计**（单机 Flask 的务实做法，不引入 Celery 等重依赖）：

- `run.py` 启动服务时调用 `start_cleanup_scheduler(app)`，起一个 **daemon 线程**；
- 每 `AUTO_CLEANUP_INTERVAL_HOURS`（默认 6h）跑一次，首次延迟 `AUTO_CLEANUP_FIRST_DELAY_SEC`
  （默认 60s，避开启动期的建站/预热）；
- **幂等 + 防重入**：`uploads/.cleanup.last` 记上次完成时间（**跨重启生效**，重启不会立刻重跑）；
  `uploads/.cleanup.lock` 保证同一时刻只有一个实例在清理（Werkzeug 热重载会起两个进程、
  将来多 worker 部署同理）；陈旧锁（超过 30 分钟，通常是上次崩溃遗留）自动抢占，不会永久卡死；
- **失败只记日志**：异常全部吞掉并 `logger.exception`，绝不影响主服务；
- 线程是 daemon，进程退出即结束，不阻塞关停。

**两条入口共用同一份判定与同一把锁**（不要各写一份）：
`cleanup_temp.py`（手动 / 系统计划任务）走 `run_cleanup()`（带锁 + 记运行时间），
`run_cleanup()`（后台线程）内部再调 `cleanup_temp_files()`（纯判定与执行）。
想改用系统计划任务或容器 sidecar 时，把 `AUTO_CLEANUP=0` 关掉自动线程、交给外部调度即可。
"""
import os
import threading
import time

from flask import Flask, current_app
from sqlalchemy import or_

from app.extensions import db
from app.models import ChatMessage, Work

AI_SUB = "ai"
AI_URL_PREFIX = f"/uploads/{AI_SUB}/"  # `uploads/ai/` 下文件在库里的相对路径前缀
DEFAULT_KEEP_HOURS = 24        # 无引用文件的保留期
DEFAULT_CHAT_KEEP_HOURS = 168  # 仅被对话消息引用的文件的保留期（7 天）
LOCK_MAX_AGE_SEC = 1800        # 锁文件超过该时长视为陈旧（上次崩溃遗留）可抢占
LOOP_TICK_SEC = 600            # 线程醒来检查「是否到期」的间隔


# ==================== 判定与执行（唯一的实现，脚本与线程共用） ====================

def work_referenced_paths() -> set[str]:
    """被**作品**引用过的、位于 `uploads/ai/` 的相对路径（image_path + thumb_path，含历史作品）。

    只取 AI 目录下的引用：调用方逐一比对的就是 `uploads/ai/` 里的文件，
    把整张 works 表（含 `originals/` 等其它目录）全拉进内存既无意义，又随作品量线性增长。
    """
    refs = set()
    rows = db.session.query(Work.image_path, Work.thumb_path).filter(
        or_(
            Work.image_path.startswith(AI_URL_PREFIX),
            Work.thumb_path.startswith(AI_URL_PREFIX),
        )
    ).all()
    for image_path, thumb_path in rows:
        for p in (image_path, thumb_path):
            if p and p.startswith(AI_URL_PREFIX):
                refs.add(p)
    return refs


def chat_referenced_paths() -> set[str]:
    """仍被**对话消息**引用的、位于 `uploads/ai/` 的相对路径。

    聊天页的 AI 结果图不进作品库（用户没点保存），只查 works 会让它们被当「无引用」误删 ——
    用户回头翻会话就图裂（见 README 11.3 第 40 条）。同样只扫 AI 目录（NULL 行被 LIKE 自然排除）。
    """
    refs = set()
    rows = db.session.query(ChatMessage.image_path).filter(
        ChatMessage.image_path.startswith(AI_URL_PREFIX)
    ).all()
    for (image_path,) in rows:
        if image_path:
            refs.add(image_path)
    return refs


def cleanup_temp_files(
    *,
    hours: float = DEFAULT_KEEP_HOURS,
    chat_hours: float = DEFAULT_CHAT_KEEP_HOURS,
    dry_run: bool = False,
) -> dict:
    """按三类判定回收 `uploads/ai/` 下的临时图（**需在 app context 内调用**）。

    ① 被作品引用 → 永不删；② 仅被对话引用 → 超过 `chat_hours` 才删，并清空该消息的悬空引用；
    ③ 谁都没引用 → 超过 `hours` 删。返回统计（含将被删除/已删除的清单）。

    保留期为负时直接抛 `ValueError`（见下方说明）；单个文件读属性/删除失败只跳过它自己。

    只扫 `ai/` 的**一层**：子目录（如 AI 自测产物 `ai/_verify/`）整体不参与。
    """
    ai_dir = os.path.join(current_app.config["UPLOAD_DIR"], AI_SUB)
    result = {
        "deleted": 0, "freed": 0, "kept_ref": 0, "kept_chat": 0,
        "kept_fresh": 0, "cleared": 0, "items": [],
    }
    if not os.path.isdir(ai_dir):
        return result

    work_refs = work_referenced_paths()
    chat_refs = chat_referenced_paths()
    # 保留期**不接受负数**：负值会让 cutoff 落在「未来」，于是所有无引用文件都被判超期一并删掉
    # （`cleanup_temp.py --hours -1` 即可触发；直接把 -1 钳成 0 也一样是「全删」，没有意义）。
    # 宁可让本次清理失败并记日志，也不做这种危险动作。
    hours = float(hours)
    chat_hours = float(chat_hours)
    if hours < 0 or chat_hours < 0:
        raise ValueError(f"保留期不能为负数：hours={hours} chat_hours={chat_hours}")
    cutoff = time.time() - hours * 3600
    chat_cutoff = time.time() - chat_hours * 3600

    for name in sorted(os.listdir(ai_dir)):
        path = os.path.join(ai_dir, name)
        # 单个文件在「列目录」与「读属性」之间被别的实例/手动清理删掉时，
        # getmtime/getsize 会抛 FileNotFoundError 打断整轮清理（后台线程那边表现为
        # 本轮剩余文件全部漏清）。这里按文件隔离异常：出错的跳过，其余照常处理。
        try:
            if not os.path.isfile(path):
                continue
            rel = f"/uploads/{AI_SUB}/{name}"

            # ① 被作品引用：永不删除（与文件年龄无关）
            if rel in work_refs:
                result["kept_ref"] += 1
                continue

            # ② 仅被对话引用：过了更长的保留期才删
            in_chat = rel in chat_refs
            mtime = os.path.getmtime(path)
            if in_chat and mtime > chat_cutoff:
                result["kept_chat"] += 1
                continue
            # ③ 无引用：过了短保留期就删
            if not in_chat and mtime > cutoff:
                result["kept_fresh"] += 1
                continue

            size = os.path.getsize(path)
            result["items"].append((rel, size, "会话结果图超期" if in_chat else "无引用超期"))
            if dry_run:
                continue
            if in_chat:
                # **先清引用并提交，再删文件**：反过来（先 os.remove 再提交）一旦提交失败，
                # 库里就留下指向已删文件的路径 —— 会话图裂且无从修复；反序后最坏只是留下一个
                # 无引用的孤儿文件，由下一轮清理收掉（数据一致性优先于文件及时性）。
                result["cleared"] += ChatMessage.query.filter_by(image_path=rel).update(
                    {"image_path": None}, synchronize_session=False
                )
                db.session.commit()
            try:
                os.remove(path)
            except OSError as e:
                current_app.logger.warning("临时图删除失败 %s：%s", rel, e)
                result["items"].pop()  # 没删掉就不计进清单
                continue
            result["deleted"] += 1
            result["freed"] += size
        except OSError as e:
            current_app.logger.warning("临时图处理出错（已跳过）%s：%s", name, e)
            continue

    # 「清空悬空引用」已在上面的分支里逐条提交（避免提交失败后文件已删、引用还在）
    return result


# ==================== 调度：文件锁 + 上次运行时间（跨重启防重复） ====================

def _state_dir(app: Flask | None = None) -> str:
    """状态文件所在目录（= UPLOAD_DIR）。

    显式接收 `app` 而不是直接用 `current_app`：调度线程里的 `run_cleanup()` 需要在
    **进入 app context 之前**就先抢锁/读上次运行时间（否则会抛 Working outside of
    application context），因此这几个函数必须能在 app context 之外工作。
    """
    target = app if app is not None else current_app
    return target.config["UPLOAD_DIR"]


def _lock_path(app: Flask | None = None) -> str:
    return os.path.join(_state_dir(app), ".cleanup.lock")


def _last_run_path(app: Flask | None = None) -> str:
    return os.path.join(_state_dir(app), ".cleanup.last")


def acquire_lock(app: Flask | None = None, max_age_sec: int = LOCK_MAX_AGE_SEC) -> bool:
    """抢清理锁；陈旧锁自动抢占。抢不到返回 False（说明已有实例在清理）。"""
    path = _lock_path(app)
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
    except OSError:
        return False
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        try:
            if time.time() - os.path.getmtime(path) <= max_age_sec:
                return False
            os.remove(path)  # 上次崩溃遗留的陈旧锁 → 抢占
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except OSError:
            return False
    except OSError:
        return False
    try:
        os.write(fd, f"{os.getpid()} {time.time():.0f}".encode())
    except OSError:
        pass
    finally:
        os.close(fd)
    return True


def release_lock(app: Flask | None = None):
    try:
        os.remove(_lock_path(app))
    except OSError:
        pass


def last_run_at(app: Flask | None = None) -> float:
    """上次成功完成的时间戳；没有记录返回 0（表示从没跑过）。"""
    try:
        with open(_last_run_path(app), "r", encoding="utf-8") as f:
            return float((f.read() or "0").strip())
    except (OSError, ValueError):
        return 0.0


def mark_ran(app: Flask | None = None):
    try:
        with open(_last_run_path(app), "w", encoding="utf-8") as f:
            f.write(f"{time.time():.0f}")
    except OSError:
        pass


def run_cleanup(app: Flask, *, hours=None, chat_hours=None) -> dict | None:
    """带锁跑一次回收并记录时间；抢不到锁或失败返回 None（**不抛异常**）。

    注意：抢锁与读/写「上次运行时间」都发生在 **app context 之外**（用传入的 app 读配置），
    只有真正扫盘与改库才进 context —— 这样即使调用方没有 context 也能安全调用。
    """
    if not acquire_lock(app):
        app.logger.info("自动回收：另一实例正在清理，本次跳过")
        return None
    try:
        with app.app_context():
            try:
                result = cleanup_temp_files(
                    hours=hours if hours is not None else app.config.get("AI_TEMP_KEEP_HOURS", DEFAULT_KEEP_HOURS),
                    chat_hours=(
                        chat_hours if chat_hours is not None
                        else app.config.get("AI_TEMP_CHAT_KEEP_HOURS", DEFAULT_CHAT_KEEP_HOURS)
                    ),
                )
            finally:
                db.session.remove()  # 线程里的 session 用完即弃，别留给下一次复用
        mark_ran(app)
        if result["deleted"] or result["cleared"]:
            app.logger.info(
                "自动回收：删除 %s 个临时图（%.1fMB），清空悬空引用 %s 条；保留 %s 个（作品引用）/%s 个（对话引用）/%s 个（新文件）",
                result["deleted"], result["freed"] / 1024 / 1024, result["cleared"],
                result["kept_ref"], result["kept_chat"], result["kept_fresh"],
            )
        else:
            app.logger.info(
                "自动回收：无需清理（保留 %s 个作品引用 / %s 个对话引用 / %s 个新文件）",
                result["kept_ref"], result["kept_chat"], result["kept_fresh"],
            )
        return result
    except Exception:  # noqa: BLE001 维护任务绝不能把主服务带崩
        app.logger.exception("自动回收失败（已忽略）")
        return None
    finally:
        release_lock(app)


def start_cleanup_scheduler(app: Flask) -> bool:
    """启动自动回收后台线程（幂等）。返回是否真的启动了。"""
    if not app.config.get("AUTO_CLEANUP_ENABLED", True):
        app.logger.info("自动回收已关闭（AUTO_CLEANUP=0），可改用系统计划任务跑 cleanup_temp.py")
        return False
    if getattr(app, "_cleanup_scheduler_started", False):
        return False
    interval = max(0.2, float(app.config.get("AUTO_CLEANUP_INTERVAL_HOURS") or 6)) * 3600
    first_delay = max(1.0, float(app.config.get("AUTO_CLEANUP_FIRST_DELAY_SEC") or 60))
    app._cleanup_scheduler_started = True

    def loop():
        app.logger.info(
            "自动回收已启动：首次 %.0fs 后检查，之后每 %.1fh 一次（保留期 %.0fh / 会话图 %.0fh）",
            first_delay, interval / 3600,
            float(app.config.get("AI_TEMP_KEEP_HOURS") or DEFAULT_KEEP_HOURS),
            float(app.config.get("AI_TEMP_CHAT_KEEP_HOURS") or DEFAULT_CHAT_KEEP_HOURS),
        )
        time.sleep(first_delay)
        while True:
            try:
                # 用传入的 app 读状态（此处在 app context 之外）
                if time.time() - last_run_at(app) >= interval:
                    run_cleanup(app)
            except Exception:  # noqa: BLE001 双保险：循环本身也不能死
                app.logger.exception("自动回收循环异常（已忽略）")
            time.sleep(min(LOOP_TICK_SEC, interval))

    threading.Thread(target=loop, name="ai-temp-cleanup", daemon=True).start()
    return True
