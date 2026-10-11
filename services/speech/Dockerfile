FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 MODELS_DIR=/models HF_HOME=/models/huggingface HF_HUB_DISABLE_TELEMETRY=1 ONNX_PROVIDER=CPUExecutionProvider OMP_NUM_THREADS=4 HOST=0.0.0.0 PORT=8081
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY download_models.py ./
RUN python download_models.py && rm -rf /models/whisper-small.en/.cache /models/huggingface
COPY service.py engine.py ./
RUN useradd --uid 10001 --create-home speech && chown -R speech:speech /app /models
USER speech
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8081')+'/health',timeout=4)"
CMD ["python", "service.py"]
