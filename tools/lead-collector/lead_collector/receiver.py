"""Приёмник для режима «через Chrome»: слушает ТОЛЬКО 127.0.0.1 и складывает присланные страницы карточек в data/inbox.

Нужен, когда VPN включён только в Chrome и Python сайт ЕИС не видит: страницы читает сам браузер и
отправляет их сюда, а разбор делает тот же код (`parse-folder data/inbox`). Наружу ничего не уходит.
"""
from __future__ import annotations

import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .config import DATA_DIR

INBOX = DATA_DIR / "inbox"
ALLOWED_ORIGIN = "https://zakupki.gov.ru"
MAX_BYTES = 3_000_000


class Handler(BaseHTTPRequestHandler):
    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        """/have — какие карточки уже получены (чтобы скрипт в Chrome продолжал с места остановки)."""
        if self.path != "/have" or self.headers.get("Origin") != ALLOWED_ORIGIN:
            self.send_response(400)
            self._cors()
            self.end_headers()
            return
        import json

        have = sorted(p.stem for p in INBOX.glob("*.html")) if INBOX.is_dir() else []
        body = json.dumps(have).encode("utf-8")
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        m = re.fullmatch(r"/card/(\d{19})", self.path)
        size = int(self.headers.get("Content-Length") or 0)
        if not m or size <= 0 or size > MAX_BYTES or self.headers.get("Origin") != ALLOWED_ORIGIN:
            self.send_response(400)
            self._cors()
            self.end_headers()
            return
        INBOX.mkdir(parents=True, exist_ok=True)
        (INBOX / f"{m.group(1)}.html").write_bytes(self.rfile.read(size))
        self.send_response(204)
        self._cors()
        self.end_headers()

    def log_message(self, *args) -> None:  # в журнал ничего не пишем
        pass


def serve(port: int = 8765) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Приёмник слушает 127.0.0.1:{port}, складывает страницы в {INBOX}. Остановка: Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
