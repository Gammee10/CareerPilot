"""M14 + O1 validation: AI input limits, identifier tripwire, upstream mapping."""
import importlib
import os
import tempfile
import urllib.error

from fastapi.testclient import TestClient

import main


def _authed_client():
    f = tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".txt")
    f.write("test-token")
    f.close()
    os.environ["AI_INTERNAL_TOKEN_FILE"] = f.name
    main.AI_INTERNAL_TOKEN_FILE = f.name
    return TestClient(main.app)


def _post(client, content):
    return client.post(
        "/extract",
        json={"task": "resume_extraction", "content": content},
        headers={"Authorization": "Bearer test-token"},
    )


def test_identifier_tripwire_rejects_without_upstream_call(monkeypatch):
    client = _authed_client()
    called = []
    monkeypatch.setattr(main, "_call_gemini", lambda content: called.append(content) or {})
    for bad in [
        "Contact jane.doe@example.com for details",
        "Call +1 (415) 555-0132 anytime",
        "See https://example.com/portfolio for more",
        "Ref 3f2504e0-4f89-11d3-9a0c-0305e82c3301 closed",
    ]:
        r = _post(client, bad)
        assert r.status_code == 400
        assert r.json() == {"detail": "identifier_detected"}
    assert called == []


def test_minimized_like_content_passes_tripwire(monkeypatch):
    client = _authed_client()
    monkeypatch.setattr(main, "_call_gemini", lambda content: {"skills": ["go"]})
    content = (
        "Backend engineer with Go and PostgreSQL. "
        "Worked 2020 to 2024 on distributed systems. "
        "BSc State University 2015. Salary hope 90000."
    )
    r = _post(client, content)
    assert r.status_code == 200
    assert r.json() == {"proposal": {"skills": ["go"]}}


def test_network_failure_maps_to_503_retryable(monkeypatch):
    client = _authed_client()
    monkeypatch.setattr(main, "_gemini_api_key", lambda: "key")
    monkeypatch.setattr(
        main.urllib.request,
        "urlopen",
        lambda req, timeout: (_ for _ in ()).throw(
            urllib.error.URLError("connection refused")
        ),
    )
    r = _post(client, "plain candidate text")
    assert r.status_code == 503
    assert r.json() == {"detail": "ai_unavailable"}


def test_upstream_http_failure_maps_to_502(monkeypatch):
    client = _authed_client()
    monkeypatch.setattr(main, "_gemini_api_key", lambda: "key")

    def boom(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 503, "overloaded", {}, None)

    monkeypatch.setattr(main.urllib.request, "urlopen", boom)
    r = _post(client, "plain candidate text")
    assert r.status_code == 502
    assert r.json() == {"detail": "upstream_error"}


def test_malformed_upstream_body_maps_to_502(monkeypatch):
    client = _authed_client()
    monkeypatch.setattr(main, "_gemini_api_key", lambda: "key")

    class FakeResp:
        def read(self):
            return b"not json at all"

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(main.urllib.request, "urlopen", lambda req, timeout: FakeResp())
    r = _post(client, "plain candidate text")
    assert r.status_code == 502
    assert r.json() == {"detail": "unparseable_output"}


def test_non_object_proposal_rejected(monkeypatch):
    client = _authed_client()
    monkeypatch.setattr(main, "_gemini_api_key", lambda: "key")
    inner = '["not", "an", "object"]'
    outer = (
            '{"candidates": [{"content": {"parts": [{"text": '
            + inner.replace('"', '\\"')
            + "}]}}]}"
    )

    class FakeResp:
        def read(self):
            return outer.encode()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(main.urllib.request, "urlopen", lambda req, timeout: FakeResp())
    r = _post(client, "plain candidate text")
    assert r.status_code == 502


def test_model_allowlist_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "evil-model")
    reloaded = importlib.reload(main)
    try:
        assert reloaded.GEMINI_MODEL == "gemini-2.0-flash"
    finally:
        monkeypatch.delenv("GEMINI_MODEL", raising=False)
        importlib.reload(main)
        main.AI_INTERNAL_TOKEN_FILE = os.environ.get(
            "AI_INTERNAL_TOKEN_FILE", "/run/secrets/ai_internal_token"
        )
