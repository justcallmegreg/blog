FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Non-root
RUN useradd -r -u 10001 app && chown -R app /app
USER app

EXPOSE 8080
# Default: run the API server. The digest CronJob overrides the command with
# `python -m app.digest`.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
