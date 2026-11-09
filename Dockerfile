FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    AUDIVERIS_BIN=audiveris \
    HOME=/home/sonora

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg libsndfile1 tesseract-ocr-eng \
    && curl --fail --location --silent --show-error --retry 5 --retry-all-errors --retry-delay 2 \
       https://github.com/Audiveris/audiveris/releases/download/5.7.0/Audiveris-5.7.0-ubuntu22.04-x86_64.deb \
       --output /tmp/audiveris.deb \
    && mkdir -p /etc/xdg/menus /usr/share/applications /usr/share/desktop-directories \
    && apt-get install -y --no-install-recommends /tmp/audiveris.deb \
    && rm -f /tmp/audiveris.deb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/requirements.txt /app/server/requirements.txt
RUN python -m pip install --upgrade pip \
    && python -m pip install -r /app/server/requirements.txt

COPY index.html /app/index.html
COPY server /app/server
RUN useradd --create-home --home-dir /home/sonora --shell /usr/sbin/nologin sonora \
    && chown -R sonora:sonora /app /home/sonora

USER sonora
ENV AUDIVERIS_BIN=/opt/audiveris/bin/Audiveris
EXPOSE 8000
CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8000"]
