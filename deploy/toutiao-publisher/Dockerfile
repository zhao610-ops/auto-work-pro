FROM trendpublish:toutiao-relay

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Shanghai

USER root
WORKDIR /opt/toutiao-publisher
RUN apt-get -o Acquire::ForceIPv4=true update \
  && apt-get install -y --no-install-recommends python3-pip \
  && rm -rf /var/lib/apt/lists/*
COPY third_party/toutiao-auto-publisher/requirements.txt ./requirements.txt
# 基础镜像自带的 Debian Python 包没有 pip RECORD；容器内忽略系统包后安装
# 发布器自己的依赖，避免 pip 在卸载 typing_extensions 时失败。
RUN python3 -m pip install --break-system-packages --ignore-installed --no-cache-dir -r requirements.txt
COPY third_party/toutiao-auto-publisher/ ./upstream/
COPY deploy/toutiao-publisher/worker.py ./worker.py

RUN chown -R deno:deno /opt/toutiao-publisher
USER deno
ENTRYPOINT ["python3", "/opt/toutiao-publisher/worker.py"]
