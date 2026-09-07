"""C2 validation: AI /extract caller authentication + input bounds.

- no token -> 401, wrong token -> 401, correct token -> 200 (gemini stubbed)
- oversized content -> 422 (pydantic max_length)
Upstream is never called on auth failures.
"""
import os
import tempfile

from fastapi.testclient import TestClient

import main


def _client_with_token(token: str | None):
    if token is None:
        # Point at a nonexistent file so _internal_token() returns None.
        os.environ["AI_INTERNAL_TOKEN_FILE"] = "/nonexistent-ai-token-c2-test"
    else:
        f = tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".txt")
        f.write(token)
        f.close()
        os.environ["AI_INTERNAL_TOKEN_FILE"] = f.name
    # main captures the path at import time; keep it in sync with the env.
    main.AI_INTERNAL_TOKEN_FILE = os.environ["AI_INTERNAL_TOKEN_FILE"]
    # Re-import semantics: main reads the file per request, so no reload needed.
    return TestClient(main.app)


def test_no_token_rejected():
    client = _client_with_token(None)
    r = client.post("/extract", json={"task": "resume_extraction", "content": "hello"})
    assert r.status_code == 401


def test_wrong_token_rejected(monkeypatch):
    client = _client_with_token("correct-token")
    called = []
    monkeypatch.setattr(main, "_call_gemini", lambda content: called.append(content) or {})
    r = client.post(
        "/extract",
        json={"task": "resume_extraction", "content": "hello"},
        headers={"Authorization": "Bearer wrong-token"},
    )
    assert r.status_code == 401
    assert called == []


def test_correct_token_accepted(monkeypatch):
    client = _client_with_token("correct-token")
    monkeypatch.setattr(main, "_call_gemini", lambda content: {"skills": ["go"]})
    r = client.post(
        "/extract",
        json={"task": "resume_extraction", "content": "hello"},
        headers={"Authorization": "Bearer correct-token"},
    )
    assert r.status_code == 200
    assert r.json() == {"proposal": {"skills": ["go"]}}


def test_oversized_content_rejected(monkeypatch):
    client = _client_with_token("correct-token")
    called = []
    monkeypatch.setattr(main, "_call_gemini", lambda content: called.append(content) or {})
    r = client.post(
        "/extract",
        json={"task": "resume_extraction", "content": "x" * 50001},
        headers={"Authorization": "Bearer correct-token"},
    )
    assert r.status_code == 422
    assert called == []
