import hashlib
import hmac
import json
import logging
import os
import re
import socket
import urllib.error
import urllib.request

from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

# M14: LOG_LEVEL is allowlisted — an invalid value falls back to INFO instead
# of crashing logging config or enabling unexpected verbosity.
_LOG_LEVEL = os.getenv("LOG_LEVEL", "info").upper()
LOG_LEVEL = _LOG_LEVEL if _LOG_LEVEL in ("DEBUG", "INFO", "WARNING", "ERROR") else "INFO"
logging.basicConfig(level=LOG_LEVEL)

GEMINI_API_KEY_FILE = "/run/secrets/gemini_api_key"
# M14: the upstream model name is allowlisted. Unknown values fall back to
# the approved default (fail safe, never a caller-controlled model string).
_ALLOWED_MODELS = {"gemini-2.0-flash", "gemini-2.0-flash-lite"}
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
if GEMINI_MODEL not in _ALLOWED_MODELS:
    logging.warning("unapproved GEMINI_MODEL rejected; using default")
    GEMINI_MODEL = "gemini-2.0-flash"
AI_INTERNAL_TOKEN_FILE = os.getenv("AI_INTERNAL_TOKEN_FILE", "/run/secrets/ai_internal_token")

bearer_scheme = HTTPBearer(auto_error=False)

app = FastAPI(title="careerpilot-ai", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


class ExtractionRequest(BaseModel):
    # The Node-owned path sends ONLY the already-minimized task payload.
    task: str = Field(pattern="^resume_extraction$")
    content: str = Field(max_length=50000)


def _internal_token() -> str | None:
    try:
        with open(AI_INTERNAL_TOKEN_FILE, encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None


def require_internal_caller(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> None:
    expected = _internal_token()
    if not expected or not creds or not creds.credentials:
        raise HTTPException(status_code=401, detail="unauthorized")
    if not hmac.compare_digest(creds.credentials, expected):
        raise HTTPException(status_code=401, detail="unauthorized")
    # Defense in depth: hash prefix only, never the token (ADR-015).
    logging.debug(
        "ai_caller_authorized hash_prefix=%s",
        hashlib.sha256(expected.encode()).hexdigest()[:8],
    )


def _gemini_api_key() -> str | None:
    try:
        with open(GEMINI_API_KEY_FILE, encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None


# O1: defense-in-depth minimization tripwire. Node-side redaction is
# authoritative (ADR-054); this scan is a backstop so a Node bug can never
# forward identifiers straight to the provider. Patterns mirror
# profile/minimization.ts so legitimate minimized text cannot trip it.
# Matches are counted, never logged (ADR-015).
_IDENTIFIER_PATTERNS = (
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    re.compile(r"\b\+?\d[\d\s().-]{8,15}\d\b"),
    re.compile(r"https?://\S+"),
    re.compile(
        r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
        re.IGNORECASE,
    ),
)


def _contains_identifiers(content: str) -> bool:
    return any(p.search(content) for p in _IDENTIFIER_PATTERNS)


def _call_gemini(content: str) -> dict:
    key = _gemini_api_key()
    if not key:
        raise HTTPException(status_code=503, detail="ai_disabled")
    # M14: untrusted task text is wrapped in explicit delimiters so it cannot
    # blur into the instruction, and generation is bounded.
    prompt = (
        "Extract a structured profile proposal from the candidate text below. "
        "Return STRICT JSON only, no markdown, matching exactly: "
        '{"summary"?: string, "skills": string[], '
        '"employment": [{"title": string, "company": string, "startDate": "YYYY"|"YYYY-MM", '
        '"endDate": same | null}], '
        '"education": [{"degree": string, "institution": string, "year": number}], '
        '"certifications": string[]}. '
        "CANDIDATE_TEXT_BEGIN\n" + content + "\nCANDIDATE_TEXT_END"
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "maxOutputTokens": 2048},
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
    # M14: transient-vs-nontransient mapping for ADR-044. Timeouts and
    # connection failures are retryable (503); upstream HTTP failures are 502
    # (Node retries both within its bounded budget via ai_unavailable).
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        # Status code only — never log request/response content (ADR-015).
        logging.info("gemini_http_error status=%s", e.code)
        raise HTTPException(status_code=502, detail="upstream_error") from e
    except (urllib.error.URLError, TimeoutError, socket.timeout) as e:
        logging.info("gemini_network_error kind=%s", type(e).__name__)
        raise HTTPException(status_code=503, detail="ai_unavailable") from e

    try:
        outer = json.loads(body)
    except ValueError as e:
        raise HTTPException(status_code=502, detail="unparseable_output") from e
    try:
        text = outer["candidates"][0]["content"]["parts"][0]["text"]
        proposal = json.loads(text)
    except (KeyError, IndexError, ValueError) as e:
        raise HTTPException(status_code=502, detail="unparseable_output") from e
    # Defense in depth only — Node-side validation is authoritative
    # (ADR-029/054). Non-object proposals never leave this service.
    if not isinstance(proposal, dict):
        raise HTTPException(status_code=502, detail="unparseable_output")
    return proposal


@app.post("/extract")
def extract(req: ExtractionRequest, _auth: None = Depends(require_internal_caller)) -> dict:
    # O1 tripwire before any upstream call: identifier-laden content is
    # rejected without touching the provider (Node remains authoritative).
    if _contains_identifiers(req.content):
        raise HTTPException(status_code=400, detail="identifier_detected")
    # The response is an untrusted proposal; validation happens Node-side.
    return {"proposal": _call_gemini(req.content)}
