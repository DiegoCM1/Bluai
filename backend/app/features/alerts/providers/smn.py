"""
SMN (Servicio Meteorológico Nacional) boletín provider.

Scrapes the official SMN Pronóstico Meteorológico General page.
The RSS feed is non-functional; the bulletin is embedded in the HTML.

Encoding note: the SMN page declares UTF-8 but serves ISO-8859-1 characters.
We force latin-1 decoding to get clean Spanish text.

Cached in-memory for 30 minutes.
"""

import logging
import re
from datetime import datetime, timezone, timedelta

import httpx

logger = logging.getLogger(__name__)

_SMN_URL = (
    "https://smn.conagua.gob.mx/es/pronosticos"
    "/pronosticossubmenu/pronostico-meteorologico-general"
)
_CACHE_TTL = timedelta(minutes=30)
_cache: dict = {}

_MESES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4,
    "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
    "septiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}


async def fetch_latest_bulletin() -> dict | None:
    """
    Returns a dict with the latest SMN bulletin, or None on failure.
    Cached for 30 minutes. Returns stale cache on network error.
    """
    now = datetime.now(timezone.utc)
    if _cache.get("fetched_at") and now - _cache["fetched_at"] < _CACHE_TTL:
        return _cache.get("data")

    try:
        async with httpx.AsyncClient(timeout=15.0, verify=False,
                                      headers={"User-Agent": "BluEye/1.0"}) as client:
            resp = await client.get(_SMN_URL, follow_redirects=True)
            resp.raise_for_status()
            # SMN page has occasional invalid UTF-8 bytes; replace them
            html = resp.content.decode("utf-8", errors="replace")
    except Exception as exc:
        logger.warning("SMN fetch failed: %s", exc)
        return _cache.get("data")

    try:
        parsed = _parse_bulletin(html)
    except Exception as exc:
        logger.error("SMN parse raised unexpectedly: %s", exc, exc_info=True)
        parsed = None

    _cache["fetched_at"] = now
    _cache["data"] = parsed
    logger.info("SMN bulletin fetched: aviso=%s", parsed.get("aviso_num") if parsed else "None")
    return parsed


def _strip_tags(html: str) -> str:
    text = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", text).strip()


def _parse_bulletin(html: str) -> dict | None:
    # aviso_num — pattern: noaviso_valor' >227
    aviso_match = re.search(r"noaviso_valor[^>]*>\s*(\d+)", html)
    aviso_num = int(aviso_match.group(1)) if aviso_match else None
    if aviso_num is None:
        logger.debug("SMN parse: aviso_num selector not found")

    # headline — first non-empty <strong> inside the sintesis block
    # The block can contain a leading empty <strong> </strong> before the real title.
    sintesis_match = re.search(r"sintesis[^>]*>(.*?)</div>", html, re.DOTALL)
    headline: str | None = None
    if sintesis_match:
        for m in re.finditer(r"<strong>(.*?)</strong>", sintesis_match.group(1), re.DOTALL):
            candidate = _strip_tags(m.group(1))
            if candidate:
                headline = candidate
                break
    if not headline:
        logger.warning(
            "SMN parse failed: headline not found — the 'sintesis/<strong>' "
            "structure may have changed. Page length: %d chars", len(html)
        )
        return None

    # issued_at — "24 de Abril del 2026" + "06:00h"
    date_match = re.search(
        r"(\d{1,2})\s+de\s+(\w+)\s+del\s+(\d{4})",
        html, re.IGNORECASE
    )
    time_match = re.search(r"(\d{1,2}):(\d{2})h", html)
    issued_at: str | None = None
    if date_match:
        day = int(date_match.group(1))
        month = _MESES.get(date_match.group(2).lower(), 0)
        year = int(date_match.group(3))
        hour = int(time_match.group(1)) if time_match else 6
        minute = int(time_match.group(2)) if time_match else 0
        if month:
            try:
                issued_at = datetime(year, month, day, hour, minute,
                                     tzinfo=timezone.utc).isoformat()
            except ValueError:
                logger.debug("SMN parse: invalid date values d=%s m=%s y=%s", day, month, year)
                issued_at = None
        else:
            logger.debug("SMN parse: unknown month name '%s'", date_match.group(2))
    else:
        logger.debug("SMN parse: date pattern not found in HTML")

    # body — full bulletin text. `summary` (500 chars) is what the raw card/push
    # showed before the plain-language rewrite; `full_text` is the actual source
    # material for that rewrite (see ai/service.py:generate_plain_summary) — an
    # LLM asked to simplify an already-truncated 500-char fragment has nothing
    # real to work with, so it needs more than the display-sized summary.
    body_match = re.search(
        r"visforms_contenedor_cuerpo[^>]*>(.*?)</div>\s*<div id='ProximoAviso",
        html, re.DOTALL
    )
    summary: str | None = None
    full_text: str | None = None
    if body_match:
        body_text = _strip_tags(body_match.group(1))
        summary = body_text[:500]
        full_text = body_text[:8000]
    else:
        logger.debug("SMN parse: summary selector 'visforms_contenedor_cuerpo' not found")

    # pdf_url — direct download link embedded in the page
    pdf_match = re.search(
        r"href='(https://smn\.conagua\.gob\.mx/tools/DATA/[^']*\.pdf)'",
        html
    )
    pdf_url = pdf_match.group(1) if pdf_match else None
    if not pdf_url:
        logger.debug("SMN parse: PDF link not found")

    logger.debug(
        "SMN parse complete: aviso=%s issued_at=%s has_summary=%s has_pdf=%s",
        aviso_num, issued_at, summary is not None, pdf_url is not None,
    )

    return {
        "aviso_num": aviso_num,
        "issued_at": issued_at,
        "headline": headline,
        "summary": summary,
        "full_text": full_text,
        "pdf_url": pdf_url,
        "source": "SMN/CONAGUA",
    }
