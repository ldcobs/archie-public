#!/usr/bin/env python3
"""archie-installer — the bootstrap-owned web setup wizard service.

Stdlib-only (no Node, no pip) so it runs on a *fresh* host before any dependency
is installed. It is the SEPARATE installer runtime — not the product dashboard
container, which it later builds and restarts. It serves the wizard UI and a
small JSON API that reuses the install engine (``lib/detect``, ``lib/apply``).

Security (per INSTALL_WIZARD_DEFINITION §7):
- Binds ``127.0.0.1`` by default (reach it via SSH tunnel). ``--host 0.0.0.0`` is
  the "advanced / temporary exposure" path and SHOULD be paired with ``--token``.
- When a token is set, every ``/api/*`` request must present it
  (``X-Archie-Token`` header or ``?token=``) — a simple gate + CSRF guard.

Runtime (per §7.2, §10): the install runs as a background job with state +
per-step logs persisted under ``--state-dir`` (default ``/opt/archie/.install``),
so the UI survives refresh/disconnect. ``GET /api/job`` re-attaches to it.

The install job runs the *real* plan from ``lib/apply`` when launched as root on
the target host (off-target / non-root it falls back to a safe simulation that
never mutates the host). On failure the UI offers recovery: ``/api/install``
re-run resumes (each plan step self-skips when already satisfied), and
``/api/verify`` re-runs only the read-only self-check.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

HERE = Path(__file__).resolve().parent          # .../install/wizard
INSTALL_ROOT = HERE.parent                       # .../install
UI_DIR = HERE / "ui"
sys.path.insert(0, str(INSTALL_ROOT))            # so `from lib import ...` works

from lib import detect                            # noqa: E402
from lib.common import Params                     # noqa: E402

# ── module state ─────────────────────────────────────────────────────────────
CONFIG = {"token": "", "state_dir": "/opt/archie/.install"}
_JOB_LOCK = threading.Lock()


# ── host facts (cross-platform-ish, degrades gracefully off Linux) ───────────
def _mem_total_mb() -> int:
    try:
        for line in open("/proc/meminfo"):
            if line.startswith("MemTotal:"):
                return int(line.split()[1]) // 1024
    except OSError:
        pass
    try:
        return (os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")) // (1024 * 1024)
    except (ValueError, OSError):
        return 0


def detect_facts() -> dict:
    p = Params()
    p.mode = "A"
    try:
        detect.run_all_detection(p, insecure_ip=True)
    except Exception:
        pass
    total, _, free = shutil.disk_usage("/")
    return {
        "os_id": p.os_id, "os_version": p.os_version, "arch": p.arch,
        "cpu": os.cpu_count() or 0,
        "mem_total_mb": _mem_total_mb(),
        "disk_total_gb": round(total / 2**30, 1),
        "disk_free_gb": round(free / 2**30, 1),
        "docker": p.docker_present,
        "public_ip": p.server_ip,
        "wan_iface": p.wan_iface,
        "is_root": os.geteuid() == 0 if hasattr(os, "geteuid") else False,
    }


def preflight(f: dict) -> list[dict]:
    """Return [{key,label,status,detail}] — status: pass|install|warn|action."""
    out = []

    def add(key, label, status, detail):
        out.append({"key": key, "label": label, "status": status, "detail": detail})

    supported = (f["os_id"] in ("ubuntu", "debian", "amzn", "rocky", "almalinux",
                                "fedora", "centos", "rhel"))
    add("os", "Operating system", "pass" if supported else "warn",
        f"{f['os_id'] or 'unknown'} {f['os_version']} · {f['arch']}")
    add("cpu", "CPU", "pass" if f["cpu"] >= 1 else "warn", f"{f['cpu']} cores")
    ram_ok = f["mem_total_mb"] >= 2000
    add("ram", "Memory", "pass" if ram_ok else "warn",
        f"{f['mem_total_mb']} MB" + ("" if ram_ok else " — 2 GB+ recommended"))
    disk_ok = f["disk_free_gb"] >= 20
    add("disk", "Disk space", "pass" if disk_ok else "warn",
        f"{f['disk_free_gb']} GB free" + ("" if disk_ok else " — 20 GB+ recommended"))
    add("root", "Root / sudo", "pass" if f["is_root"] else "warn",
        "granted" if f["is_root"] else "the installer must run as root on the host")
    add("docker", "Docker + compose", "pass" if f["docker"] else "install",
        "present" if f["docker"] else "will be installed")
    add("binaries", "Xray, Hysteria2, WireGuard", "install", "will be installed")
    add("ip", "Public IP", "pass" if f["public_ip"] else "warn",
        f["public_ip"] or "could not detect — you'll enter it")
    listening = set()
    try:
        listening = detect.ports_listening()
    except Exception:
        pass
    busy = [p for p in (443, 2096, 51820, 8388) if p in listening]
    add("ports", "Required host ports free", "pass" if not busy else "warn",
        "443, 2096, 51820, 8388" if not busy else f"in use: {busy}")
    # The installer sets the on-box firewall (UFW) but CANNOT touch a cloud
    # provider's security group — that's an API outside this host. List every
    # port a client/browser must reach, per mode, or the operator opens the VPN
    # ports but not the dashboard/cert ports and the install looks broken.
    add("sg", "Cloud security group", "action",
        "Open these inbound in your cloud firewall — it's outside this host, "
        "so the installer can't do it for you.\n"
        "\n"
        "All modes — 443/tcp, 2096/udp, 51820/udp, 8388/tcp\n"
        "Mode A (IP only) — also 8080/tcp (dashboard)\n"
        "Mode B (Cloudflare) — also 8443/tcp (dashboard); no port 80, the cert is uploaded\n"
        "Mode C (Let's Encrypt) — also 80/tcp (cert) + 8443/tcp (dashboard)")
    return out


# ── install job (dry-run simulation over the real plan) ──────────────────────
def _to_int(s: str, default: int = 0) -> int:
    try:
        return int(s)
    except (TypeError, ValueError):
        return default


def _job_path() -> Path:
    return Path(CONFIG["state_dir"]) / "job.json"


def _read_job() -> dict | None:
    try:
        return json.loads(_job_path().read_text())
    except (OSError, ValueError):
        return None


def _write_job(job: dict) -> None:
    p = _job_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(job, indent=2))


def _params_from_answers(answers: dict) -> Params:
    from lib import detect, crypto
    p = Params()
    p.mode = answers.get("mode", "A")
    p.install_dir = "/opt/archie"
    p.staging_dir = "/opt/archie/.install/staging"
    # Option B: bootstrap.sh exports ARCHIE_PREBUILT=1 to install from pre-built
    # images (docker-compose.release.yml + docker pull) instead of building the
    # source on the box. Default off keeps the source-build path.
    p.prebuilt = os.environ.get("ARCHIE_PREBUILT") == "1"
    detect.run_all_detection(p, insecure_ip=True)
    if answers.get("server_ip"):
        p.server_ip = answers["server_ip"]
    if p.mode in ("B", "C"):
        p.server_domain = answers.get("domain", "")
    if p.mode == "B":
        p.cf_origin_cert = answers.get("cf_origin_cert", "")
        p.cf_origin_key = answers.get("cf_origin_key", "")
    crypto.ensure_all(p)
    return p


def _dashboard_url(p) -> str:
    # Mode A publishes the dashboard directly on :8080. Modes B/C route it
    # through nginx on :8443 (archie.conf's TLS server block) — port 443
    # itself is reserved for direct VLESS Reality (Xray), not nginx, so a
    # bare https://<domain>/v3 (implicit :443) never reaches the dashboard.
    if p.mode == "A":
        return f"http://{p.server_ip}:8080/v3"
    return f"https://{p.server_domain}:8443/v3"


def _set_step(i: int, status: str) -> None:
    with _JOB_LOCK:
        j = _read_job()
        if j and 0 <= i < len(j["steps"]):
            j["steps"][i]["status"] = status
            j["current"] = i
            _write_job(j)


def _set_state(state: str, **extra) -> None:
    with _JOB_LOCK:
        j = _read_job() or {}
        j["state"] = state
        j.update(extra)
        _write_job(j)


def _run_job(answers: dict) -> None:
    """Real install when root (on the target host); safe simulation otherwise."""
    real = (os.geteuid() == 0) if hasattr(os, "geteuid") else False
    try:
        from lib import apply
        from lib.assemble_install_dir import assemble
        p = _params_from_answers(answers)
        if p.mode == "B" and not (p.cf_origin_cert.strip() and p.cf_origin_key.strip()):
            # Mode B can't proceed without the operator's Cloudflare Origin
            # cert + key. Write a CLEAN job (no steps) so the UI shows a plain
            # message, never a failure overlaid on stale green steps.
            return _write_job({"state": "unsupported", "real": real, "answers": answers,
                               "steps": [], "reason": (
                "Cloudflare mode (B) needs a Cloudflare Origin certificate and "
                "private key — paste both, then start the install.")})
        staging = assemble(p)                    # build staging tree (no host mutation)
        steps = apply.build_plan(p, Path(str(staging)))
        _write_job({"state": "running", "real": real, "answers": answers,
                    "started": time.time(), "current": 0,
                    "steps": [{"name": s.name, "desc": s.desc, "status": "pending"} for s in steps]})

        if not real:
            for i in range(len(steps)):          # preview: simulate, never mutate
                _set_step(i, "running"); time.sleep(0.35); _set_step(i, "done")
            return _set_state("done", note="preview (not root): simulated — host unchanged")

        log_path = str(Path(CONFIG["state_dir"]) / "install.log")
        open(log_path, "w").close()              # fresh log per install
        rc = apply.run_plan(steps, dry_run=False, on_step=_set_step, log_path=log_path)
        if rc != 0:
            return _set_state("failed", reason="a step failed — see the install log")

        # All steps are done (progress bar at 100%), but self_check below does
        # live probes (container health, a TLS handshake, an HTTP fetch) that
        # take real seconds with zero visible feedback otherwise — the UI
        # would look frozen right after the last step. Surface it explicitly.
        _set_state("verifying")
        url = _dashboard_url(p)
        verify = apply.self_check(p, dashboard_url=url)
        with _JOB_LOCK:
            j = _read_job() or {}
            j["verify"] = [{"label": lbl, "ok": ok, "detail": d} for (lbl, ok, d) in verify]
            j["state"] = "done" if all(ok for _, ok, _ in verify) else "verify-failed"
            _write_job(j)
    except Exception as e:
        _set_state("failed", reason=f"{type(e).__name__}: {e}")


def _run_verify() -> None:
    """Re-run only the read-only post-install self-check and update job state.

    Recovery path for the ``verify-failed`` state: the install itself succeeded
    but a probe didn't pass (often a service still warming up or a closed cloud
    port). Re-checks without touching the host; reuses the answers from the job.
    """
    try:
        from lib import apply
        answers = (_read_job() or {}).get("answers", {})
        p = _params_from_answers(answers)
        url = _dashboard_url(p)
        verify = apply.self_check(p, dashboard_url=url)
        with _JOB_LOCK:
            j = _read_job() or {}
            j["verify"] = [{"label": lbl, "ok": ok, "detail": d} for (lbl, ok, d) in verify]
            j["state"] = "done" if all(ok for _, ok, _ in verify) else "verify-failed"
            _write_job(j)
    except Exception as e:
        _set_state("verify-failed", reason=f"verification error: {type(e).__name__}: {e}")


def _test_integration(kind: str, vals: dict) -> tuple[bool, str]:
    """Really validate an optional-integration credential by contacting the
    service — NOT a stub. Returns (ok, human message). stdlib only."""
    import urllib.request
    import urllib.error
    import urllib.parse
    import ssl

    def _get(url: str, headers: dict | None = None, data: bytes | None = None):
        req = urllib.request.Request(url, headers=headers or {}, data=data)
        return urllib.request.urlopen(req, timeout=12)

    try:
        if kind == "abuseipdb":
            apikey = str(vals.get("key", "")).strip()
            if not apikey:
                return False, "no API key entered"
            try:
                with _get(
                    "https://api.abuseipdb.com/api/v2/check"
                    "?ipAddress=1.1.1.1&maxAgeInDays=1",
                    headers={"Key": apikey, "Accept": "application/json"},
                ) as r:
                    return (r.status == 200), (
                        "valid API key" if r.status == 200 else f"unexpected HTTP {r.status}"
                    )
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    return False, "invalid API key — AbuseIPDB rejected it"
                return False, f"AbuseIPDB returned HTTP {e.code}"

        if kind == "telegram":
            token = str(vals.get("token", "")).strip()
            chat = str(vals.get("chat", "")).strip()
            if not token:
                return False, "no bot token entered"
            try:
                with _get(f"https://api.telegram.org/bot{token}/getMe") as r:
                    data = json.loads(r.read() or b"{}")
                if not data.get("ok"):
                    return False, "invalid bot token"
            except urllib.error.HTTPError as e:
                if e.code in (401, 404):
                    return False, "invalid bot token"
                return False, f"Telegram returned HTTP {e.code}"
            if chat:
                payload = urllib.parse.urlencode(
                    {"chat_id": chat, "text": "✅ Archie: integration test — this bot works."}
                ).encode()
                try:
                    with _get(
                        f"https://api.telegram.org/bot{token}/sendMessage", data=payload
                    ) as r:
                        d2 = json.loads(r.read() or b"{}")
                    if not d2.get("ok"):
                        return False, "token valid, but couldn't message that Chat ID"
                    return True, "bot token valid — test message sent"
                except urllib.error.HTTPError:
                    return False, "token valid, but Chat ID rejected (send /start to the bot first)"
            return True, "bot token valid"

        if kind == "smtp":
            import smtplib
            host = str(vals.get("host", "")).strip()
            port = _to_int(str(vals.get("port", "")).strip(), 0)
            user = str(vals.get("user", "")).strip()
            pw = str(vals.get("pass", "")).strip()
            if not (host and port and user and pw):
                return False, "fill host, port, username and password"
            ctx = ssl.create_default_context()
            try:
                if port == 465:
                    srv = smtplib.SMTP_SSL(host, port, timeout=12, context=ctx)
                else:
                    srv = smtplib.SMTP(host, port, timeout=12)
                    srv.ehlo()
                    srv.starttls(context=ctx)
                    srv.ehlo()
                try:
                    srv.login(user, pw)
                finally:
                    try:
                        srv.quit()
                    except Exception:
                        pass
                return True, "SMTP login succeeded"
            except smtplib.SMTPAuthenticationError:
                return False, "SMTP auth failed — wrong username/password"
            except (OSError, smtplib.SMTPException) as e:
                return False, f"SMTP connection failed: {type(e).__name__}"

        return False, f"unknown integration '{kind}'"
    except urllib.error.URLError as e:
        return False, f"could not reach service: {getattr(e, 'reason', e)}"
    except Exception as e:  # noqa: BLE001 — surface any failure as a clean test result
        return False, f"test error: {type(e).__name__}"


# ── HTTP ─────────────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    server_version = "archie-installer/0.1"

    def log_message(self, *a):                   # quieter
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _authed(self, q) -> bool:
        tok = CONFIG["token"]
        if not tok:
            return True
        given = self.headers.get("X-Archie-Token") or (q.get("token", [""])[0])
        return given == tok

    def _static(self, path):
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        f = (UI_DIR / rel).resolve()
        if UI_DIR not in f.parents and f != UI_DIR or not f.is_file():
            return self._send(404, b"not found", "text/plain")
        ctype = {"html": "text/html", "css": "text/css", "js": "text/javascript",
                 "svg": "image/svg+xml"}.get(f.suffix.lstrip("."), "text/plain")
        self._send(200, f.read_bytes(), ctype + "; charset=utf-8")

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if not u.path.startswith("/api/"):
            return self._static(u.path)
        if not self._authed(q):
            return self._send(401, {"error": "token required"})
        if u.path == "/api/detect":
            return self._send(200, detect_facts())
        if u.path == "/api/preflight":
            return self._send(200, {"checks": preflight(detect_facts())})
        if u.path == "/api/job":
            return self._send(200, _read_job() or {"state": "none"})
        if u.path == "/api/log":
            p = Path(CONFIG["state_dir"]) / "install.log"
            try:
                txt = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                txt = ""
            if q.get("raw"):                     # plain-text download
                return self._send(200, txt.encode(), "text/plain; charset=utf-8")
            # `since` (byte offset the client already has) returns only the
            # new tail instead of the whole log every poll — the UI polls
            # every ~1s and the full log can reach 40KB, so re-sending it in
            # full on every tick was most of the wasted round-trip time.
            total = len(txt)
            since = max(0, min(_to_int(q.get("since", ["0"])[0]), total))
            if total - since > 40000:            # first attach to a long-running job
                since = total - 40000
            return self._send(200, {"log": txt[since:], "total": total})
        return self._send(404, {"error": "unknown endpoint"})

    def do_POST(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if not self._authed(q):
            return self._send(401, {"error": "token required"})
        if u.path == "/api/install":
            n = int(self.headers.get("Content-Length", 0) or 0)
            answers = {}
            if n:
                try:
                    answers = json.loads(self.rfile.read(n) or b"{}")
                except ValueError:
                    answers = {}
            if (_read_job() or {}).get("state") == "running":
                return self._send(409, {"error": "install already running"})
            threading.Thread(target=_run_job, args=(answers,), daemon=True).start()
            return self._send(202, {"ok": True})
        if u.path == "/api/verify":
            if (_read_job() or {}).get("state") == "running":
                return self._send(409, {"error": "install still running"})
            _set_state("verifying")
            threading.Thread(target=_run_verify, daemon=True).start()
            return self._send(202, {"ok": True})
        if u.path == "/api/test-integration":
            n = int(self.headers.get("Content-Length", 0) or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}") if n else {}
            except ValueError:
                body = {}
            kind = str(body.get("key", "")).strip()
            vals = body.get("vals") or {}
            ok, message = _test_integration(kind, vals)
            return self._send(200, {"ok": ok, "message": message})
        return self._send(404, {"error": "unknown endpoint"})


def main() -> int:
    ap = argparse.ArgumentParser(description="Archie installer wizard service")
    ap.add_argument("--host", default="127.0.0.1",
                    help="bind address (default localhost; 0.0.0.0 = advanced/public)")
    ap.add_argument("--port", type=int, default=8899)
    ap.add_argument("--token", default="", help="require this token on /api/* (advised for public)")
    ap.add_argument("--state-dir", default="/opt/archie/.install")
    a = ap.parse_args()

    CONFIG["token"] = a.token
    CONFIG["state_dir"] = a.state_dir
    public = a.host not in ("127.0.0.1", "localhost", "::1")
    if public and not a.token:
        print("[!] WARNING: public bind without --token — the installer would be "
              "open to the network. Add --token.", file=sys.stderr)

    httpd = ThreadingHTTPServer((a.host, a.port), Handler)
    where = f"http://{a.host}:{a.port}/"
    print(f"[+] archie-installer on {where}", file=sys.stderr)
    if not public:
        print(f"    reach it via SSH tunnel:  ssh -L {a.port}:localhost:{a.port} <user>@<server>",
              file=sys.stderr)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[+] stopped", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
