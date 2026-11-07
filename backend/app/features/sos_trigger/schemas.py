from typing import Literal

from pydantic import BaseModel


class SOSTriggerRequest(BaseModel):
    lat: float | None = None
    lon: float | None = None


# Per-contact outcome of one SOS. Only `linked` contacts can be reached (the alert is
# a push to their Bluai app — there is no SMS), so the other states exist to tell the
# sender exactly who did NOT get it and why, instead of a bare count.
SOSContactStatus = Literal[
    "notified",        # linked, and at least one of their devices accepted the push
    "no_device",       # linked, but no registered device (signed out / notifications off)
    "failed",          # linked with devices, but Firebase didn't deliver to any of them
    "invite_pending",  # invited, hasn't accepted yet
    "not_linked",      # never invited (or the invite was rejected)
]


class SOSContactResult(BaseModel):
    name: str
    status: SOSContactStatus


class SOSTriggerResponse(BaseModel):
    # PEOPLE notified — not devices. (Before 2.0.0 (23) this counted push tokens, so a
    # contact with two phones counted twice.)
    notified_count: int
    skipped_count: int
    sos_event_id: int
    # Additive: older app builds ignore it and keep reading the counts above.
    contacts: list[SOSContactResult] = []
