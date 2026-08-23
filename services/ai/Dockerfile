FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Run as non-root; the Gemini credential arrives only as a file-mounted secret.
USER 1000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
