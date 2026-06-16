FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt

# V6.M2.A.13: 预下载 bge-m3 到镜像层，避免首次启动等 600MB 模型下载
# 注：本层 ~600MB；如需 BuildKit 缓存复用可在 build 时启 DOCKER_BUILDKIT=1 加
#   `--mount=type=cache,target=/root/.cache/huggingface`
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-m3')"

COPY app ./app

EXPOSE 8200

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8200"]
