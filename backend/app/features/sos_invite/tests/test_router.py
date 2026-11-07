import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from starlette.testclient import TestClient

from app.main import app

client = TestClient(app)

FAKE_USER = {"uid": "firebase-test-uid", "name": "Boro"}
AUTH_HEADERS = {"Authorization": "Bearer faketoken"}
FAKE_DB_USER = {"id": 42, "firebase_uid": "firebase-test-uid", "lat": None, "lon": None,
                "created_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}

_exp = datetime.now(timezone.utc) + timedelta(hours=72)
INVITE_RESP   = {"share_url": "blueye://sos-invite/abc123", "expires_at": _exp, "push_sent": False}
PREVIEW_RESP  = {"inviter_display_name": "Boro", "contact_name": "Mamá", "expires_at": _exp}
ACCEPT_RESP   = {"inviter_display_name": "Boro", "contact_name": "Mamá"}


def _mock_auth():
    return patch("app.core.auth.auth.verify_id_token", return_value=FAKE_USER)


def _mock_user(rv=FAKE_DB_USER):
    return patch("app.features.sos_invite.router.get_user_by_firebase_uid",
                 new_callable=AsyncMock, return_value=rv)


def _mock_svc(fn_path, *, rv=None, exc=None):
    return patch(fn_path, new_callable=AsyncMock,
                 return_value=rv, side_effect=exc)


# ── POST invite ────────────────────────────────────────────────────────────────

def test_create_invite_201():
    with _mock_auth(), _mock_user(), \
         _mock_svc("app.features.sos_invite.router.create_invite", rv=INVITE_RESP):
        r = client.post("/api/v1/sos-contacts/1/invite", headers=AUTH_HEADERS)
    assert r.status_code == 201
    assert r.json()["share_url"].startswith("blueye://sos-invite/")
    assert "expires_at" in r.json()


def test_create_invite_requires_auth():
    assert client.post("/api/v1/sos-contacts/1/invite").status_code == 422


def test_create_invite_user_not_found():
    with _mock_auth(), _mock_user(rv=None):
        assert client.post("/api/v1/sos-contacts/1/invite",
                           headers=AUTH_HEADERS).status_code == 404


def test_create_invite_409_already_linked():
    exc = HTTPException(409, "Contact is already linked to an app user")
    with _mock_auth(), _mock_user(), \
         _mock_svc("app.features.sos_invite.router.create_invite", exc=exc):
        assert client.post("/api/v1/sos-contacts/1/invite",
                           headers=AUTH_HEADERS).status_code == 409


def test_create_invite_403_wrong_owner():
    exc = HTTPException(403, "SOS contact does not belong to this user")
    with _mock_auth(), _mock_user(), \
         _mock_svc("app.features.sos_invite.router.create_invite", exc=exc):
        assert client.post("/api/v1/sos-contacts/1/invite",
                           headers=AUTH_HEADERS).status_code == 403


# ── GET preview (no auth) ──────────────────────────────────────────────────────

def test_preview_200():
    with _mock_svc("app.features.sos_invite.router.get_invite_preview", rv=PREVIEW_RESP):
        r = client.get("/api/v1/sos-invitations/preview/sometoken")
    assert r.status_code == 200
    assert r.json()["inviter_display_name"] == "Boro"
    assert r.json()["contact_name"] == "Mamá"


def test_preview_no_auth_required():
    """Endpoint is public — succeeds without Authorization header."""
    with _mock_svc("app.features.sos_invite.router.get_invite_preview", rv=PREVIEW_RESP):
        assert client.get("/api/v1/sos-invitations/preview/t").status_code == 200


def test_preview_404_unknown_token():
    exc = HTTPException(404, "Invitation not found")
    with _mock_svc("app.features.sos_invite.router.get_invite_preview", exc=exc):
        assert client.get("/api/v1/sos-invitations/preview/bad").status_code == 404


def test_preview_410_expired():
    exc = HTTPException(410, "Invitation expired or revoked")
    with _mock_svc("app.features.sos_invite.router.get_invite_preview", exc=exc):
        assert client.get("/api/v1/sos-invitations/preview/exp").status_code == 410


def test_preview_409_already_accepted():
    exc = HTTPException(409, "Invitation already accepted")
    with _mock_svc("app.features.sos_invite.router.get_invite_preview", exc=exc):
        assert client.get("/api/v1/sos-invitations/preview/used").status_code == 409


# ── POST accept ────────────────────────────────────────────────────────────────

def test_accept_200():
    with _mock_auth(), _mock_user(), \
         _mock_svc("app.features.sos_invite.router.accept_invite", rv=ACCEPT_RESP):
        r = client.post("/api/v1/sos-invitations/sometoken/accept", headers=AUTH_HEADERS)
    assert r.status_code == 200
    assert r.json()["inviter_display_name"] == "Boro"


def test_accept_requires_auth():
    assert client.post("/api/v1/sos-invitations/t/accept").status_code == 422


def test_accept_user_not_found():
    with _mock_auth(), _mock_user(rv=None):
        assert client.post("/api/v1/sos-invitations/t/accept",
                           headers=AUTH_HEADERS).status_code == 404


def test_accept_404_unknown_token():
    with _mock_auth(), _mock_user(), \
         _mock_svc("app.features.sos_invite.router.accept_invite",
                   exc=HTTPException(404, "Invitation not found")):
        assert client.post("/api/v1/sos-invitations/bad/accept",
                           headers=AUTH_HEADERS).status_code == 404


def test_accept_410_expired():
    with _mock_auth(), _mock_user(), \
         _mock_svc("app.features.sos_invite.router.accept_invite",
                   exc=HTTPException(410, "Invitation expired or revoked")):
        assert client.post("/api/v1/sos-invitations/exp/accept",
                           headers=AUTH_HEADERS).status_code == 410


def test_accept_409_already_used():
    with _mock_auth(), _mock_user(), \
         _mock_svc("app.features.sos_invite.router.accept_invite",
                   exc=HTTPException(409, "Invitation already accepted")):
        assert client.post("/api/v1/sos-invitations/used/accept",
                           headers=AUTH_HEADERS).status_code == 409


def test_accept_400_self_invite():
    with _mock_auth(), _mock_user(), \
         _mock_svc("app.features.sos_invite.router.accept_invite",
                   exc=HTTPException(400, "Cannot accept your own invitation")):
        assert client.post("/api/v1/sos-invitations/self/accept",
                           headers=AUTH_HEADERS).status_code == 400


# ── Resend cooldown (service level) ───────────────────────────────────────────

from unittest.mock import MagicMock as _MagicMock
from app.features.sos_invite.service import create_invite


@pytest.mark.asyncio
async def test_create_invite_429_within_cooldown():
    db = AsyncMock()
    contact = _MagicMock()
    contact.mappings.return_value.first.return_value = {
        "name": "Ana", "link_status": "invite_sent", "user_id": 42,
        "phone": "9991234567", "invitee_user_id": None,
    }
    recent = _MagicMock()
    recent.scalar.return_value = 1  # an invite was created < 10 min ago
    db.execute.side_effect = [contact, recent]
    with pytest.raises(HTTPException) as exc:
        await create_invite(db, inviter_id=42, inviter_display_name="Boro", contact_id=5)
    assert exc.value.status_code == 429
    db.commit.assert_not_called()
