# L6: digest-pinned base; requirements carry exact pins.
FROM python:3.15-slim@sha256:65a65fc7b30b06cb6df4930fd4650697cb23f4c2698ab81fc87e4b031bc36928

WORKDIR /app

COPY requirements.txt requirements.lock .
# O5: reproducible, hash-verified install — no floating transitives in prod.
RUN pip install --no-cache-dir --require-hashes -r requirements.lock

COPY main.py .

# Run as non-root; the Gemini credential arrives only as a file-mounted secret.
USER 1000

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
