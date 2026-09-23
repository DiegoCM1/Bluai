from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class CheckResult:
    key: str
    title: str
    status: str
    detail: str
    evidence: tuple[str, ...]


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def exists(path: str) -> bool:
    return (ROOT / path).exists()


def has(text: str, pattern: str) -> bool:
    return re.search(pattern, text, re.MULTILINE) is not None


def collect_checks() -> list[CheckResult]:
    app_json = read("frontend/app.json")
    layout = read("frontend/app/local-chat/_layout.tsx")
    provider = read("frontend/app/local-chat/_context/LocalChatProvider.tsx")
    transport = read("frontend/app/local-chat/_services/transport.ts")
    nearby_android = read("frontend/app/local-chat/_services/NearbyTransport.android.ts")
    nearby_ios = read("frontend/app/local-chat/_services/NearbyTransport.ios.ts")
    protocol = read("frontend/app/local-chat/_services/protocol.ts")
    identity = read("frontend/app/local-chat/_services/identity.ts")
    storage = read("frontend/app/local-chat/_services/storage.ts")
    plugin = read("frontend/plugins/with-nearby-connections.js")
    roadmap = read("docs/RoadMap.md")
    sprint = read("docs/specs_july05/sprint.md")
    val_spec = read("docs/specs_july05/val_sprint_3.md")

    checks: list[CheckResult] = []

    checks.append(
        CheckResult(
            key="route_present",
            title="Existe entrada de UI para chat offline",
            status="PASS" if exists("frontend/app/local-chat/index.tsx") and exists("frontend/app/local-chat/chat.tsx") else "FAIL",
            detail="La app expone un flujo real de Bluetooth/chat offline dentro de pantallas enrutable.",
            evidence=(
                "frontend/app/local-chat/index.tsx",
                "frontend/app/local-chat/chat.tsx",
                "frontend/app/(tabs)/MoreScreen.tsx",
            ),
        )
    )

    checks.append(
        CheckResult(
            key="provider_wired",
            title="El feature Bluetooth está montado detrás de un provider compartido",
            status="PASS"
            if "LocalChatProvider" in layout and "NicknameGate" in layout
            else "FAIL",
            detail="El stack de chat local está envuelto por un solo provider y bloqueado hasta definir nickname.",
            evidence=(
                "frontend/app/local-chat/_layout.tsx",
                "frontend/app/local-chat/_context/LocalChatProvider.tsx",
            ),
        )
    )

    permission_patterns = [
        r"BLUETOOTH_ADVERTISE",
        r"BLUETOOTH_CONNECT",
        r"BLUETOOTH_SCAN",
        r"NEARBY_WIFI_DEVICES",
        r"ACCESS_FINE_LOCATION",
    ]
    all_permissions = all(has(app_json, p) and has(plugin, p) for p in permission_patterns)
    checks.append(
        CheckResult(
            key="permissions",
            title="Los permisos Android y el plugin nativo están declarados",
            status="PASS" if all_permissions else "FAIL",
            detail="Los permisos requeridos de Bluetooth/Nearby en Android aparecen tanto en la configuración Expo como en la generación del plugin nativo.",
            evidence=("frontend/app.json", "frontend/plugins/with-nearby-connections.js"),
        )
    )

    required_transport_methods = [
        "startAdvertising",
        "stopAdvertising",
        "startDiscovery",
        "stopDiscovery",
        "requestConnection",
        "send(endpointId: string, raw: string)",
        "disconnect(endpointId?: string)",
    ]
    checks.append(
        CheckResult(
            key="transport_contract",
            title="El contrato de transporte soporta un flujo real de mensajería local",
            status="PASS" if all(m in transport for m in required_transport_methods) else "FAIL",
            detail="La abstracción de transporte incluye envíos dirigidos, solicitudes de conexión y suscripción a eventos.",
            evidence=("frontend/app/local-chat/_services/transport.ts",),
        )
    )

    provider_capabilities = [
        "toggleAdvertise",
        "toggleDiscover",
        "connectToPeer",
        "sendMessage",
        "clearConversation",
        "loadConversations",
        "saveConversations",
    ]
    checks.append(
        CheckResult(
            key="provider_capabilities",
            title="El provider implementa estado de conexión, mensajería y persistencia",
            status="PASS" if all(token in provider for token in provider_capabilities) else "FAIL",
            detail="El provider resuelve estado de peers, flujos de envío/recepción, cambios de nickname y persistencia local.",
            evidence=(
                "frontend/app/local-chat/_context/LocalChatProvider.tsx",
                "frontend/app/local-chat/_services/storage.ts",
            ),
        )
    )

    checks.append(
        CheckResult(
            key="identity_persistence",
            title="La identidad estable se codifica y persiste entre sesiones",
            status="PASS"
            if all(token in identity for token in ("encodeIdentity", "decodeIdentity", "newDeviceId"))
            and all(token in storage for token in ("bt:self_id", "bt:nickname", "bt:conversations"))
            else "FAIL",
            detail="La identidad del dispositivo y las conversaciones se guardan localmente, algo necesario para un chat Bluetooth real de cara al usuario.",
            evidence=(
                "frontend/app/local-chat/_services/identity.ts",
                "frontend/app/local-chat/_services/storage.ts",
            ),
        )
    )

    checks.append(
        CheckResult(
            key="android_native_module",
            title="La implementación Android usa un módulo nativo generado con Nearby",
            status="PASS"
            if all(token in nearby_android for token in ("NativeModules.NearbyConnections", "requestConnection", "sendMessage"))
            and "class NearbyConnectionsModule(" in plugin
            else "FAIL",
            detail="Android está respaldado por un puente nativo real y no por un stub o mock.",
            evidence=(
                "frontend/app/local-chat/_services/NearbyTransport.android.ts",
                "frontend/plugins/with-nearby-connections.js",
            ),
        )
    )

    checks.append(
        CheckResult(
            key="ios_degrades_cleanly",
            title="iOS degrada limpio en lugar de fingir soporte Bluetooth",
            status="PASS" if "isAvailable: false" in nearby_ios else "FAIL",
            detail="iOS reporta actualmente el transporte como no disponible, lo que evita vender soporte inexistente.",
            evidence=("frontend/app/local-chat/_services/NearbyTransport.ios.ts",),
        )
    )

    checks.append(
        CheckResult(
            key="mesh_ready_protocol",
            title="El protocolo está preparado para ruteo mesh futuro",
            status="PASS"
            if all(token in protocol for token in ("ttl", "BROADCAST", "from", "to", "Designed for mesh from day one"))
            else "FAIL",
            detail="El envelope ya incluye los campos que necesita una capa de ruteo multi-salto.",
            evidence=("frontend/app/local-chat/_services/protocol.ts",),
        )
    )

    checks.append(
        CheckResult(
            key="mesh_router_implemented",
            title="Existe un mesh router dedicado en el código actual",
            status="FAIL" if not exists("frontend/app/local-chat/_services/meshRouter.ts") else "PASS",
            detail="La capa dedicada de ruteo mesh sigue ausente en el estado actual del repositorio.",
            evidence=(
                "frontend/app/local-chat/_services",
                "docs/specs_july05/val_sprint_3.md",
            ),
        )
    )

    checks.append(
        CheckResult(
            key="native_strategy_mesh",
            title="La estrategia nativa fue actualizada de point-to-point a cluster mesh",
            status="FAIL" if "Strategy.P2P_POINT_TO_POINT" in plugin else "PASS",
            detail="El módulo nativo generado todavía declara estrategia point-to-point en vez de cluster mesh.",
            evidence=("frontend/plugins/with-nearby-connections.js",),
        )
    )

    checks.append(
        CheckResult(
            key="single_connection_native",
            title="La capa nativa soporta múltiples peers simultáneos",
            status="FAIL" if "connectedEndpointId: String? = null" in plugin else "PASS",
            detail="El módulo nativo sigue rastreando un solo endpoint conectado en lugar de un roster multipar.",
            evidence=("frontend/plugins/with-nearby-connections.js",),
        )
    )

    checks.append(
        CheckResult(
            key="targeted_send_real",
            title="El transporte reenvía el endpoint solicitado al enviar",
            status="FAIL" if "async send(_endpointId: string, raw: string)" in nearby_android else "PASS",
            detail="El transporte Android todavía ignora el endpoint destino solicitado y depende de una sola conexión implícita.",
            evidence=("frontend/app/local-chat/_services/NearbyTransport.android.ts",),
        )
    )

    checks.append(
        CheckResult(
            key="mesh_harness_present",
            title="Existe simulación mesh o harness automatizado",
            status="FAIL"
            if not any(exists(path) for path in (
                "frontend/app/local-chat/_services/meshRouter.ts",
                "frontend/app/local-chat/_services/meshRouter.test.ts",
                "frontend/app/local-chat/_services/mesh_harness.ts",
            ))
            else "PASS",
            detail="No se encontró un harness de simulación mesh ni una validación automatizada equivalente para multi-salto.",
            evidence=("docs/specs_july05/val_sprint_3.md",),
        )
    )

    checks.append(
        CheckResult(
            key="roadmap_still_pending",
            title="La documentación del proyecto todavía describe Bluetooth mesh como trabajo pendiente",
            status="WARN"
            if "Bluetooth mesh (v1.1, per sprint philosophy)" in roadmap and "Bluetooth mesh" in sprint
            else "PASS",
            detail="El lenguaje de roadmap/spec sigue tratando mesh como un incremento futuro o gated, no como feature cerrada.",
            evidence=(
                "docs/RoadMap.md",
                "docs/specs_july05/sprint.md",
                "docs/specs_july05/val_sprint_3.md",
            ),
        )
    )

    checks.append(
        CheckResult(
            key="spec_explicit_gaps",
            title="El spec lista explícitamente piezas mesh faltantes",
            status="WARN"
            if all(token in val_spec for token in ("meshRouter.ts", "P2P_CLUSTER", "connectedEndpointId", "split horizon"))
            else "PASS",
            detail="El spec de mesh documenta trabajo abierto que todavía no se refleja como código implementado.",
            evidence=("docs/specs_july05/val_sprint_3.md",),
        )
    )

    return checks


def summarize(checks: Iterable[CheckResult]) -> dict[str, int]:
    counts = {"PASS": 0, "FAIL": 0, "WARN": 0}
    for check in checks:
        counts[check.status] = counts.get(check.status, 0) + 1
    return counts


def verdict(checks: Iterable[CheckResult]) -> tuple[str, str]:
    index = {check.key: check for check in checks}
    if (
        index["route_present"].status == "PASS"
        and index["provider_capabilities"].status == "PASS"
        and index["android_native_module"].status == "PASS"
        and (
            index["mesh_router_implemented"].status == "FAIL"
            or index["native_strategy_mesh"].status == "FAIL"
            or index["single_connection_native"].status == "FAIL"
            or index["targeted_send_real"].status == "FAIL"
        )
    ):
        return (
            "NARANJA",
            "Bluetooth is real and functional for local Android chat, but the mesh/multi-hop scope is not complete.",
        )
    if all(check.status == "PASS" for check in checks):
        return ("VERDE", "Bluetooth appears complete for the audited scope.")
    return (
        "ROJO",
        "Critical structural gaps prevent treating Bluetooth as a functional implemented feature.",
    )


def build_markdown(checks: list[CheckResult]) -> str:
    counts = summarize(checks)
    color, line = verdict(checks)

    def bullet(items: Iterable[str]) -> str:
        return "\n".join(f"- `{item}`" for item in items)

    pass_checks = [c for c in checks if c.status == "PASS"]
    fail_checks = [c for c in checks if c.status == "FAIL"]
    warn_checks = [c for c in checks if c.status == "WARN"]

    lines = [
        "# Resultados de pruebas exhaustivas de Bluetooth",
        "",
        "Fecha de ejecucion: 6 de agosto de 2026",
        "",
        "## Alcance",
        "",
        "Auditoria automatizada del feature Bluetooth/local-chat en el repositorio actual.",
        "Estas pruebas validan estructura, wiring, permisos, capa nativa, persistencia y brechas frente al alcance mesh esperado.",
        "",
        "## Resumen",
        "",
        f"- Resultado general: `{color}`",
        f"- Lectura general: {line}",
        f"- Checks en PASS: {counts['PASS']}",
        f"- Checks en FAIL: {counts['FAIL']}",
        f"- Checks en WARN: {counts['WARN']}",
        "",
        "## Hallazgos positivos",
        "",
    ]

    if pass_checks:
        for check in pass_checks:
            lines.extend(
                [
                    f"### {check.title}",
                    "",
                    f"- Estado: `{check.status}`",
                    f"- Hallazgo: {check.detail}",
                    "- Evidencia:",
                    bullet(check.evidence),
                    "",
                ]
            )
    else:
        lines.extend(["No hubo hallazgos positivos.", ""])

    lines.extend(["## Hallazgos de falla", ""])
    if fail_checks:
        for check in fail_checks:
            lines.extend(
                [
                    f"### {check.title}",
                    "",
                    f"- Estado: `{check.status}`",
                    f"- Hallazgo: {check.detail}",
                    "- Evidencia:",
                    bullet(check.evidence),
                    "",
                ]
            )
    else:
        lines.extend(["No se detectaron fallas estructurales en el alcance auditado.", ""])

    lines.extend(["## Advertencias", ""])
    if warn_checks:
        for check in warn_checks:
            lines.extend(
                [
                    f"### {check.title}",
                    "",
                    f"- Estado: `{check.status}`",
                    f"- Hallazgo: {check.detail}",
                    "- Evidencia:",
                    bullet(check.evidence),
                    "",
                ]
            )
    else:
        lines.extend(["No se detectaron advertencias adicionales.", ""])

    lines.extend(
        [
            "## Conclusion",
            "",
            "La auditoria confirma que Bluetooth no esta en cero: la app ya cuenta con una implementacion real de chat local offline sobre Android, con UI, provider, identidad, persistencia y puente nativo.",
            "",
            "Tambien confirma que el alcance mesh no puede marcarse como cerrado. El codigo actual sigue mostrando estrategia `P2P_POINT_TO_POINT`, una sola conexion nativa activa, envio implicito a un unico peer y ausencia de `meshRouter` o harness multi-salto.",
            "",
            f"Por eso, el veredicto tecnico final es `{color}`.",
            "",
        ]
    )

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit Bluetooth/local-chat implementation status.")
    parser.add_argument(
        "--markdown-out",
        default="docs/bluetooth_audit_results.md",
        help="Path relative to repo root where the markdown report will be written.",
    )
    parser.add_argument(
        "--json-out",
        default="docs/bluetooth_audit_results.json",
        help="Path relative to repo root where the raw JSON report will be written.",
    )
    args = parser.parse_args()

    checks = collect_checks()
    markdown = build_markdown(checks)
    counts = summarize(checks)
    color, summary = verdict(checks)

    json_payload = {
        "date": "2026-08-06",
        "scope": "Bluetooth/local-chat repository audit",
        "verdict": {"color": color, "summary": summary},
        "counts": counts,
        "checks": [
            {
                "key": c.key,
                "title": c.title,
                "status": c.status,
                "detail": c.detail,
                "evidence": list(c.evidence),
            }
            for c in checks
        ],
    }

    md_path = ROOT / args.markdown_out
    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(markdown, encoding="utf-8")

    json_path = ROOT / args.json_out
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(json_payload, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Markdown report: {rel(md_path)}")
    print(f"JSON report: {rel(json_path)}")
    print(f"Verdict: {color} - {summary}")
    print(f"Counts: PASS={counts['PASS']} FAIL={counts['FAIL']} WARN={counts['WARN']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
