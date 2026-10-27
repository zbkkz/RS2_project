# run.py
from app import create_app
from app.services.maintenance import start_cleanup_scheduler

app = create_app()

if __name__ == "__main__":
    # AI 临时图自动回收（后台守护线程，默认每 6 小时一次，见 app/services/maintenance.py）。
    # 只放在服务启动入口：迁移 / 自测脚本 import create_app() 时不会起线程。
    # 用其它 WSGI 入口（gunicorn/uwsgi）或不想让应用进程管这件事时：把 .env 的 AUTO_CLEANUP 设为 0，
    # 再交给系统计划任务跑 cleanup_temp.py（两者是同一份判定逻辑）。
    start_cleanup_scheduler(app)
    app.run(host="0.0.0.0", port=5000, debug=True)
