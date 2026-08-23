import json
import logging
import os
import urllib.error
import urllib.request

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

LOG_LEVEL = os.getenv("LOG_LEVEL", "info").upper()
logging.basicConfig(level=LOG_LEVEL)

GEMINI_API_KEY_FILE = "/run/secrets/gemini_api_key"
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

app = FastAPI(title="careerpilot-ai", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


class ExtractionRequest(BaseModel):
    # The Node-owned path sends ONLY the already-minimized task payload.
    task: str = Field(pattern="^resume_extraction$")
    content: str


def _gemini_api_key() -> str | None:
    try:
        with open(GEMINI_API_KEY_FILE, encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None


def _call_gemini(content: str) -> dict:
    key = _gemini_api_key()
    if not key:
        raise HTTPException(status_code=503, detail="ai_disabled")
    prompt = (
        "Extract a structured profile proposal from the candidate text below. "
        "Return STRICT JSON only, no markdown, matching exactly: "
        '{"summary"?: string, "skills": string[], '
        '"employment": [{"title": string, "company": string, "startDate": "YYYY"|"YYYY-MM", '
        '"endDate": same | null}], '
        '"education": [{"degree": string, "institution": string, "year": number}], '
        '"certifications": string[]}. '
        "Text:\n" + content
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={key}"
    )
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        # Status code only — never log request/response content (ADR-015).
        logging.info("gemini_http_error status=%s", e.code)
        raise HTTPException(status_code=502, detail="upstream_error") from e

    outer = json.loads(body)
    try:
        text = outer["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(text)
    except (KeyError, IndexError, ValueError) as e:
        raise HTTPException(status_code=502, detail="unparseable_output") from e


@app.post("/extract")
def extract(req: ExtractionRequest) -> dict:
    # The response is an untrusted proposal; validation happens Node-side.
    return {"proposal": _call_gemini(req.content)}
