# 产品SKU管理系统 - 群晖 NAS 部署映像
# 基础镜像：Alpine 化部署用 slim 版（体积小）；如需更换 Python 版本改 3.12 即可
FROM python:3.12-slim

WORKDIR /app

# 先装依赖（利用层缓存）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 拷贝应用代码（数据 sku.db / 图片 uploads 不放镜像里，由 docker-compose 挂载宿主机 data/）
COPY app.py db.py import_shipping.py ./
COPY templates ./templates
COPY static/css ./static/css
COPY static/js ./static/js

# 应用启动时会自动创建 static/uploads（os.makedirs exist_ok）
ENV HOST=0.0.0.0 \
    PORT=5050 \
    PYTHONUNBUFFERED=1

EXPOSE 5050

# 容器默认以 root 运行，可写挂载的 data/ 目录；如需非 root 可加 USER
CMD ["python", "app.py"]
