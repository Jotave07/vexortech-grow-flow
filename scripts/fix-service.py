#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Corrige o systemd service e reinicia a aplicacao na VPS."""

import paramiko
import sys
import time
from pathlib import Path

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "187.77.54.38"
USER = "root"
PASS = "#Joaovitor07"
PORT = 22

PROJECT_DIR = Path(r"c:\Users\ADM\Desktop\Flow-drive\vexortech-grow-flow")
SERVICE_NAME = "vexortech"
DEPLOY_DIR = "/var/www/vexortech/current"

ssh = None
sftp = None

def log(msg):
    print(f"  {msg}")

def connect():
    global ssh, sftp
    log(f"Conectando em {USER}@{HOST}:{PORT}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=30)
    sftp = ssh.open_sftp()
    log("Conectado.")

def run_remote(cmd):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=120)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out.strip():
        print(out.strip())
    if err.strip():
        print(f"  [stderr] {err.strip()}")
    return out, err

def main():
    print("=" * 60)
    print("  Corrigindo systemd service + restart")
    print("=" * 60)

    try:
        connect()

        # 1. Para o servico
        log("Parando vexortech...")
        run_remote(f"systemctl stop {SERVICE_NAME}")

        # 2. Upload novo .service
        log("Enviando novo vexortech.service...")
        sftp.put(str(PROJECT_DIR / "deploy" / "vexortech.service"), "/tmp/vexortech.service")
        run_remote("cp /tmp/vexortech.service /etc/systemd/system/vexortech.service")
        run_remote("rm /tmp/vexortech.service")
        run_remote("systemctl daemon-reload")
        log("Servico atualizado.")

        # 3. Verifica se o build existe
        out, _ = run_remote(f"ls {DEPLOY_DIR}/server/index.mjs 2>&1")
        if "index.mjs" not in out:
            log("ERRO: build nao encontrado. Execute deploy-vps.py primeiro.")
            sys.exit(1)
        log("Build encontrado.")

        # 4. Verifica node
        log("Verificando Node.js...")
        run_remote("which node && node -v")

        # 5. Testa se o index.mjs carrega
        log("Testando server/index.mjs (rapido)...")
        out, _ = run_remote(f"cd {DEPLOY_DIR} && timeout 3 node --check server/index.mjs 2>&1 || true")
        log(f"Check: {out.strip()[:200]}")

        # 6. Inicia
        log("Iniciando vexortech...")
        run_remote(f"systemctl start {SERVICE_NAME}")
        time.sleep(6)

        # 7. Status
        out, _ = run_remote(f"systemctl is-active {SERVICE_NAME}")
        status = out.strip()
        log(f"Status: {status}")

        # 8. Logs
        log("Ultimos logs:")
        out, _ = run_remote(f"journalctl -u {SERVICE_NAME} --no-pager -n 30")
        print(out)

        # 9. Health
        log("Health check...")
        time.sleep(2)
        out, _ = run_remote("curl -sf http://127.0.0.1:3000/api/health 2>&1 || echo 'FAIL'")
        log(f"Health: {out.strip()[:300]}")

        if status == "active" and "FAIL" not in out:
            print(f"\n{'='*60}")
            print("  [OK] APLICACAO RODANDO!")
            print(f"  https://hypedelivery.com.br")
            print(f"{'='*60}")
        else:
            print(f"\n{'='*60}")
            print("  [AVISO] Verificar manualmente")
            print(f"{'='*60}")

    except Exception as e:
        print(f"\n  [ERRO] {e}")
        import traceback
        traceback.print_exc()
    finally:
        if sftp: sftp.close()
        if ssh: ssh.close()

if __name__ == "__main__":
    main()
