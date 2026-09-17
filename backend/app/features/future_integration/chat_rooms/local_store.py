import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.core.config import settings

_STORE_LOCK = asyncio.Lock()


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _store_path() -> Path:
    configured = Path(settings.DEV_LOCAL_CHAT_STORE_PATH)
    if configured.is_absolute():
        return configured
    return _backend_root() / configured


def _default_state() -> dict[str, Any]:
    return {
        "last_room_id": 0,
        "last_message_id": 0,
        "rooms": [],
        "members": [],
        "messages": [],
    }


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _normalize_state(raw_state: dict[str, Any] | None) -> dict[str, Any]:
    state = _default_state()
    if raw_state:
        state.update(raw_state)
    return state


def _load_state_unlocked() -> dict[str, Any]:
    path = _store_path()
    if not path.exists():
        return _default_state()
    return _normalize_state(json.loads(path.read_text(encoding="utf-8")))


def _save_state_unlocked(state: dict[str, Any]) -> None:
    path = _store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _is_member(state: dict[str, Any], room_id: int, user_uid: str) -> bool:
    return any(
        member["room_id"] == room_id and member["user_uid"] == user_uid
        for member in state["members"]
    )


def _deserialize_room(room: dict[str, Any]) -> dict[str, Any]:
    return {
        **room,
        "created_at": _parse_timestamp(room["created_at"]),
    }


def _deserialize_message(message: dict[str, Any]) -> dict[str, Any]:
    return {
        **message,
        "created_at": _parse_timestamp(message["created_at"]),
    }


async def create_room(name: str | None, room_type: str, user_uid: str) -> dict[str, Any]:
    async with _STORE_LOCK:
        state = _load_state_unlocked()
        room_id = state["last_room_id"] + 1
        state["last_room_id"] = room_id

        room = {
            "id": room_id,
            "name": name,
            "type": room_type,
            "created_at": _utc_now_iso(),
        }
        state["rooms"].append(room)
        state["members"].append(
            {
                "room_id": room_id,
                "user_uid": user_uid,
                "joined_at": _utc_now_iso(),
            }
        )
        _save_state_unlocked(state)
        return _deserialize_room(room)


async def list_rooms(user_uid: str) -> list[dict[str, Any]]:
    async with _STORE_LOCK:
        state = _load_state_unlocked()
        member_room_ids = {
            member["room_id"]
            for member in state["members"]
            if member["user_uid"] == user_uid
        }
        rooms = [
            _deserialize_room(room)
            for room in state["rooms"]
            if room["id"] in member_room_ids
        ]
        return sorted(rooms, key=lambda room: room["id"], reverse=True)


async def join_room(room_id: int, user_uid: str) -> bool:
    async with _STORE_LOCK:
        state = _load_state_unlocked()
        room_exists = any(room["id"] == room_id for room in state["rooms"])
        if not room_exists:
            return False
        if not _is_member(state, room_id, user_uid):
            state["members"].append(
                {
                    "room_id": room_id,
                    "user_uid": user_uid,
                    "joined_at": _utc_now_iso(),
                }
            )
            _save_state_unlocked(state)
        return True


async def send_message(room_id: int, user_uid: str, body: str) -> dict[str, Any] | None:
    async with _STORE_LOCK:
        state = _load_state_unlocked()
        if not _is_member(state, room_id, user_uid):
            return None

        message_id = state["last_message_id"] + 1
        state["last_message_id"] = message_id
        message = {
            "id": message_id,
            "room_id": room_id,
            "user_uid": user_uid,
            "body": body,
            "created_at": _utc_now_iso(),
        }
        state["messages"].append(message)
        _save_state_unlocked(state)
        return _deserialize_message(message)


async def list_messages(
    room_id: int,
    user_uid: str,
    limit: int,
    offset: int,
) -> list[dict[str, Any]] | None:
    async with _STORE_LOCK:
        state = _load_state_unlocked()
        if not _is_member(state, room_id, user_uid):
            return None

        room_messages = [
            _deserialize_message(message)
            for message in state["messages"]
            if message["room_id"] == room_id
        ]
        room_messages.sort(key=lambda message: message["id"], reverse=True)
        return room_messages[offset : offset + limit]
