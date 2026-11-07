import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException
from starlette.testclient import TestClient

from app.main import app
from app.features.sos_trigger.service import trigger_sos

client = TestClient(app)

FAKE_USER = {"uid": "firebase-test-uid", "name": "Boro"}
AUTH_HEADERS = {"Authorization": "Bearer faketoken"}
FAKE_DB_USER = {"id": 42, "firebase_uid": "firebase-test-uid", "lat": None, "lon": None,
                "created_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}

TRIGGER_OK     = {"notified_count": 2, "skipped_count": 0, "sos_event_id": 1}
TRIGGER_ZERO   = {"notified_count": 0, "skipped_count": 0, "sos_event_id": 2}
TRIGGER_SKIP   = {"notified_count": 0, "skipped_count": 1, "sos_event_id": 3}


def _mock_auth():
    return patch("app.core.auth.auth.verify_id_token", return_value=FAKE_USER)


def _mock_user(rv=FAKE_DB_USER):
    return patch("app.features.sos_trigger.router.get_user_by_firebase_uid",
                 new_callable=AsyncMock, return_value=rv)


def _mock_svc(rv=None, exc=None):
    return patch("app.features.sos_trigger.router.trigger_sos",
                 new_callable=AsyncMock, return_value=rv, side_effect=exc)


def test_trigger_200_with_tokens():
    with _mock_auth(), _mock_user(), _mock_svc(rv=TRIGGER_OK):
        r = client.post("/api/v1/sos/trigger",
                        json={"lat": 20.97, "lon": -89.62},
                        headers=AUTH_HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["notified_count"] == 2
    assert body["skipped_count"] == 0
    assert body["sos_event_id"] == 1


def test_trigger_200_no_linked_contacts():
    with _mock_auth(), _mock_user(), _mock_svc(rv=TRIGGER_ZERO):
        r = client.post("/api/v1/sos/trigger", json={}, headers=AUTH_HEADERS)
    assert r.status_code == 200
    assert r.json()["notified_count"] == 0
    assert r.json()["sos_event_id"] == 2


def test_trigger_200_contacts_no_tokens():
    with _mock_auth(), _mock_user(), _mock_svc(rv=TRIGGER_SKIP):
        r = client.post("/api/v1/sos/trigger", json={}, headers=AUTH_HEADERS)
    assert r.status_code == 200
    assert r.json()["skipped_count"] == 1
    assert r.json()["notified_count"] == 0


def test_trigger_429_rate_limited():
    exc = HTTPException(429, "Demasiadas alertas SOS.",
                        headers={"Retry-After": "600"})
    with _mock_auth(), _mock_user(), _mock_svc(exc=exc):
        r = client.post("/api/v1/sos/trigger", json={}, headers=AUTH_HEADERS)
    assert r.status_code == 429


def test_trigger_requires_auth():
    assert client.post("/api/v1/sos/trigger", json={}).status_code == 422


def test_trigger_user_not_found():
    with _mock_auth(), _mock_user(rv=None):
        r = client.post("/api/v1/sos/trigger", json={}, headers=AUTH_HEADERS)
    assert r.status_code == 404


# ── trigger_sos unit tests ────────────────────────────────────────────────────
# trigger_sos runs its queries in this order: rate limit → sender phone → contacts →
# device tokens (only if anyone is linked) → INSERT sos_events. The mock DB answers
# them in that same order.

def _scalar(value):
    m = MagicMock()
    m.scalar.return_value = value
    return m


def _rows(rows):
    m = MagicMock()
    m.mappings.return_value = rows
    return m


def _contact(name, link_status, linked_user_id=None):
    return {"name": name, "link_status": link_status, "linked_user_id": linked_user_id}


def _db(contacts, tokens=None, event_id=7):
    """Mock session answering trigger_sos's queries in order."""
    db = AsyncMock()
    answers = [_scalar(0), _scalar("+520000000000"), _rows(contacts)]
    if any(c["link_status"] == "linked" and c["linked_user_id"] for c in contacts):
        answers.append(_rows(tokens or []))
    answers.append(_scalar(event_id))
    db.execute.side_effect = answers
    db.commit = AsyncMock()
    return db


def _batch(*successes):
    """A Firebase BatchResponse whose responses[i].success follows `successes`."""
    resp = MagicMock()
    resp.responses = [MagicMock(success=ok) for ok in successes]
    resp.success_count = sum(successes)
    resp.failure_count = len(successes) - sum(successes)
    return resp


def _send(rv=None, exc=None):
    return patch(
        "app.features.sos_trigger.service._send_multicast_with_retry",
        new_callable=AsyncMock, return_value=rv, side_effect=exc,
    )


@pytest.mark.asyncio
async def test_trigger_sos_firebase_failure_notified_zero():
    """Si Firebase falla después de retries, trigger_sos registra el evento con notified_count=0 (diseño intencional)."""
    db = _db([_contact("Ana", "linked", 99)], tokens=[{"user_id": 99, "token": "tok1"}])

    with _send(exc=RuntimeError("Firebase down")):
        result = await trigger_sos(db, sender_id=1, sender_display_name="Boro", lat=20.0, lon=-90.0)

    assert result["notified_count"] == 0
    assert result["sos_event_id"] == 7
    assert result["contacts"] == [{"name": "Ana", "status": "failed"}]
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_trigger_sos_reports_every_contact_status():
    """Cada contacto vuelve con el motivo exacto: el remitente sabe quién recibió y quién no."""
    contacts = [
        _contact("Ana", "linked", 10),          # 1 device, delivered
        _contact("Luis", "linked", 11),         # 2 devices, only the 2nd delivered
        _contact("Marta", "linked", 12),        # no registered device
        _contact("Pedro", "invite_sent"),
        _contact("Juan", "unlinked"),
    ]
    tokens = [
        {"user_id": 10, "token": "ana-1"},
        {"user_id": 11, "token": "luis-1"},
        {"user_id": 11, "token": "luis-2"},
    ]
    db = _db(contacts, tokens=tokens)

    with _send(rv=_batch(True, False, True)):
        result = await trigger_sos(db, sender_id=1, sender_display_name="Boro", lat=None, lon=None)

    assert result["contacts"] == [
        {"name": "Ana", "status": "notified"},
        {"name": "Luis", "status": "notified"},
        {"name": "Marta", "status": "no_device"},
        {"name": "Pedro", "status": "invite_pending"},
        {"name": "Juan", "status": "not_linked"},
    ]
    # People, not devices: Luis's two phones count once.
    assert result["notified_count"] == 2
    assert result["skipped_count"] == 1


@pytest.mark.asyncio
async def test_trigger_sos_linked_contact_all_devices_fail():
    db = _db([_contact("Ana", "linked", 10)], tokens=[{"user_id": 10, "token": "ana-1"}])

    with _send(rv=_batch(False)):
        result = await trigger_sos(db, sender_id=1, sender_display_name="Boro", lat=None, lon=None)

    assert result["notified_count"] == 0
    assert result["contacts"] == [{"name": "Ana", "status": "failed"}]


@pytest.mark.asyncio
async def test_trigger_sos_nobody_linked_sends_no_push():
    """Sin contactos vinculados no hay push que mandar, pero sí se reporta a cada contacto."""
    db = _db([_contact("Pedro", "invite_sent"), _contact("Juan", "unlinked")])

    with _send() as send:
        result = await trigger_sos(db, sender_id=1, sender_display_name="Boro", lat=None, lon=None)

    send.assert_not_awaited()
    assert result["notified_count"] == 0
    assert result["contacts"] == [
        {"name": "Pedro", "status": "invite_pending"},
        {"name": "Juan", "status": "not_linked"},
    ]


@pytest.mark.asyncio
async def test_trigger_sos_no_contacts_at_all():
    db = _db([])

    with _send() as send:
        result = await trigger_sos(db, sender_id=1, sender_display_name="Boro", lat=None, lon=None)

    send.assert_not_awaited()
    assert result["contacts"] == []
    assert result["notified_count"] == 0
    db.commit.assert_awaited_once()


def test_trigger_200_returns_contacts():
    payload = {**TRIGGER_OK, "contacts": [{"name": "Ana", "status": "notified"}]}
    with _mock_auth(), _mock_user(), _mock_svc(rv=payload):
        r = client.post("/api/v1/sos/trigger", json={}, headers=AUTH_HEADERS)
    assert r.status_code == 200
    assert r.json()["contacts"] == [{"name": "Ana", "status": "notified"}]
