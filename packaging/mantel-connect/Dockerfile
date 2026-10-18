FROM python:3.12-alpine
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir aiohttp==3.14.5
WORKDIR /app
COPY mantel_connect/ /app/mantel_connect/
CMD ["python", "-m", "mantel_connect.proxy"]
