# Run Plato on a cloud host. Mount a persistent disk at /app/data or the map is lost on redeploy.
FROM python:3.14-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PLATO_HOST=0.0.0.0
# Required: set PLATO_PASSWORD in the host's secret settings. The host sets PORT.
CMD ["python", "server.py"]
