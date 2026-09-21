#!/bin/sh
set -eu

# 图形界面与 noVNC 均仅在容器内部监听；宿主机端口由 docker run 绑定到 127.0.0.1。
# 容器重启时 /tmp 可能残留上一次异常退出的显示锁；不清理会导致 Xvfb 静默退出。
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
# 浏览器异常退出会遗留资料目录锁；容器启动前尚无 Chromium 进程，安全清理锁文件，
# 登录 Cookie、历史和站点会话均保留。
rm -f "$TOUTIAO_PROFILE_DIR/SingletonLock" "$TOUTIAO_PROFILE_DIR/SingletonCookie" "$TOUTIAO_PROFILE_DIR/SingletonSocket"
Xvfb :99 -screen 0 1440x1000x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
for _ in $(seq 1 30); do
  [ -S /tmp/.X11-unix/X99 ] && break
  sleep 0.2
done
if [ ! -S /tmp/.X11-unix/X99 ]; then
  cat /tmp/xvfb.log >&2 || true
  exit 1
fi
x11vnc -display :99 -localhost -forever -shared -nopw -rfbport 5900 &
# Docker 端口映射会转发到容器网卡，不能只监听容器内的 127.0.0.1。
# 宿主机侧仍限制为 127.0.0.1:6080，不会暴露到公网。
websockify --web /usr/share/novnc 0.0.0.0:6080 127.0.0.1:5900 &

export DISPLAY=:99
exec deno task toutiao:relay
