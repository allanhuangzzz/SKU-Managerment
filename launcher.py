# -*- coding: utf-8 -*-
"""
产品SKU管理系统 - 一键启动器

职责：
  1. 检查运行环境（自动创建独立虚拟环境 .venv）
  2. 自动安装缺失依赖（pip install -r requirements.txt）
  3. 启动 Flask 应用
  4. 等待服务就绪后自动打开浏览器网页

由「启动系统.bat」双击调用，也可手动运行：python launcher.py
"""
import os
import sys
import subprocess
import time
import urllib.request
import webbrowser

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VENV_DIR = os.path.join(BASE_DIR, ".venv")
REQUIREMENTS = os.path.join(BASE_DIR, "requirements.txt")
APP_FILE = os.path.join(BASE_DIR, "app.py")
HOST = "127.0.0.1"
PORT = 5000
URL = f"http://{HOST}:{PORT}"


def log(msg):
    print(msg, flush=True)


def venv_python():
    """返回虚拟环境中的 python.exe 路径，不存在则返回 None"""
    exe = os.path.join(VENV_DIR, "Scripts", "python.exe")
    return exe if os.path.isfile(exe) else None


def create_venv():
    """使用当前解释器创建虚拟环境"""
    log("首次运行，正在创建独立运行环境（.venv），请稍候 ...")
    subprocess.check_call([sys.executable, "-m", "venv", VENV_DIR])
    py = venv_python()
    if not py:
        raise RuntimeError("虚拟环境创建失败：未找到 .venv\\Scripts\\python.exe")
    log("运行环境创建完成。")
    return py


def module_installed(py, module):
    """检查虚拟环境中是否已安装某个模块"""
    r = subprocess.run(
        [py, "-c", f"import {module}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return r.returncode == 0


def ensure_dependencies(py):
    """缺失依赖时自动安装（统一用 venv 的 python -m pip，避免环境错配）"""
    if module_installed(py, "flask"):
        return
    log("检测到缺少依赖，正在自动安装（pip install -r requirements.txt）...")
    cmd = [py, "-m", "pip", "install", "--disable-pip-version-check", "-r", REQUIREMENTS]
    subprocess.check_call(cmd)
    if not module_installed(py, "flask"):
        raise RuntimeError("依赖安装后仍无法导入 flask，请检查网络后重试")
    log("依赖安装完成。")


def server_alive():
    """探测服务是否已就绪"""
    try:
        with urllib.request.urlopen(URL, timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def wait_for_server(timeout=60):
    """轮询等待服务启动"""
    for _ in range(int(timeout / 0.5)):
        if server_alive():
            return True
        time.sleep(0.5)
    return False


def open_browser():
    """打开网页；失败时提示手动访问"""
    try:
        webbrowser.open(URL)
    except Exception:
        log(f"浏览器自动打开失败，请手动在浏览器中访问：{URL}")


def main():
    # 保证 Windows 控制台下中文输出正常
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    log("=" * 50)
    log("  产品SKU管理系统 - 一键启动器")
    log("=" * 50)

    # 情况一：系统已在运行 -> 直接打开网页，不重复启动
    if server_alive():
        log(f"检测到系统已在运行：{URL}")
        open_browser()
        return 0

    # 情况二：准备运行环境
    py = venv_python()
    if not py:
        try:
            py = create_venv()
        except subprocess.CalledProcessError as e:
            log(f"[错误] 创建运行环境失败：{e}")
            return 1

    try:
        ensure_dependencies(py)
    except subprocess.CalledProcessError as e:
        log("[错误] 依赖安装失败，请检查网络连接后重新双击启动。")
        log("也可手动执行以下命令安装依赖：")
        log(f'  "{py}" -m pip install -r requirements.txt')
        log(f"详细错误：{e}")
        return 1

    # 情况三：启动应用
    log("正在启动系统 ...")
    proc = subprocess.Popen([py, APP_FILE], cwd=BASE_DIR)
    try:
        if wait_for_server():
            log(f"系统已启动：{URL}")
            log("正在打开网页 ...（关闭本窗口将停止系统）")
            open_browser()
        else:
            log("[警告] 等待服务启动超时，请查看上方日志排查原因。")
        proc.wait()
    except KeyboardInterrupt:
        log("\n正在停止系统 ...")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    return 0


if __name__ == "__main__":
    sys.exit(main())
