# L6: digest-pinned base; requirements carry exact pins.
FROM python:3.14-slim@sha256:cad9a2c871761c413caa6fdd6441c783451e740a48aaeba60ae62a8b53525ef6

WORKDIR /app

COPY requirements.txt requirements.lock .
# O5: reproducible, hash-verified install — no floating transitives in prod.
RUN pip install --no-cache-dir --require-hashes -r requirements.lock

COPY main.py .

# Run as non-root; the Gemini credential arrives only as a file-mounted secret.
USER 1000

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
