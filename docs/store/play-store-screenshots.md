# Bluai — Play Store screenshots (FINAL SET)

6 screenshots. Slots for lock-screen push and educational modules were dropped.

## Asset spec
| Asset | Size | Notes |
|---|---|---|
| Phone screenshots | 1080×1920 (9:16) | Play allows max 8; we ship 6. First 2 carry conversion. |
| Feature graphic | 1024×500 | No alpha. Keep text out of the outer 10% — Google crops it. |

## Palette for the frames (`docs/BRAND.md`)
| Role | Hex |
|---|---|
| Canvas top | `#030810` |
| Canvas bottom | `#0a1c32` |
| Primary glow | `#3167ff` |
| Highlight glow | `#2ecaff` |
| Safe / connected | `#00e774` |
| Type | Poppins SemiBold (titular) / Poppins Light (subtítulo) |

---

## The six

### 1 — Mapa · `Screenshot_20260819-100848.png`
- **Titular:** Tu zona, en tiempo real
- **Subtítulo:** Inundaciones, refugios y riesgos cerca de ti.
- **Glow:** `#2ecaff`
- Status: ready

### 2 — Alerta SMN · `Screenshot_20260819-100353.png`
- **Titular:** Alertas oficiales del SMN
- **Subtítulo:** Nivel de riesgo y qué hacer, en un vistazo.
- **Glow:** `#00e774`
- Status: ready

### 3 — IA · `Screenshot_20260819-101335.png`
- **Titular:** Respuestas cuando más urgen
- **Subtítulo:** Qué hacer y a dónde ir, con o sin internet.
- **Glow:** `#3167ff`
- Verified: `app/ai/index.tsx:105-107` flips one banner between
  "Modo en línea — IA en la nube activa" and "Modo sin conexión — IA local activa".
  Offline = on-device Llama 3.2 SpinQuant via ExecuTorch (`ModelContext.tsx`).
- Status: ready. Optional upgrade — capture the offline state for a two-phone shot.

### 4 — SOS · `Contactos SOS` (12:22)
- **Titular:** Los tuyos, a un botón
- **Subtítulo:** Importa tus contactos y comparte tu ubicación al instante.
- **Glow:** `#2ecaff`
- Verified: `expo-contacts` import (`SOSContactsScreen.tsx:499`); `sos_trigger` sends lat/lon.
- Status: ready (phone number redacted).

### 5 — Chat Bluetooth · `app/local-chat/`
- **Titular:** Sin red, sigues conectado
- **Subtítulo:** Mensajes por Bluetooth entre teléfonos cercanos.
- **Glow:** `#00e774`
- Real p2p: native module, `NearbyTransport.android.ts` / `.ios.ts`, no server.
- **BLOCKED — recapture.** The 12:41 capture is the empty state (Desconectado,
  both toggles off, "Nadie por aquí todavía"). Capture the `connected` state:
  green "Conectado / Ya puedes enviar mensajes sin internet" (`StatusHero.tsx:47-53`).
  Best: `chat.tsx` thread, two phones in airplane mode.

### 6 — Reporte comunitario · `Screenshot_20260819-100800.png`
- **Titular:** Reporta. Ayuda a tu colonia.
- **Subtítulo:** Albergues, comida y auxilio marcados por vecinos.
- **Glow:** `#00e774`
- Status: ready

---

## Gemini — preamble (paste once at the start of the chat)

```
Eres un diseñador de creatividades para Google Play Store. Vas a producir 6 imágenes
de 1080x1920 px (vertical, 9:16), una por cada captura de pantalla que te voy a dar.

REGLA ABSOLUTA E INVIOLABLE: la captura de pantalla que te doy debe aparecer
EXACTAMENTE igual, píxel por píxel, dentro del marco del teléfono. No redibujes,
no reinterpretes, no "mejores", no traduzcas y no inventes ningún elemento de la
interfaz. No cambies textos, íconos, colores ni datos que aparezcan dentro de la
captura. Tu trabajo es ÚNICAMENTE componer un fondo y un marco alrededor de ella.
Si no puedes preservar la captura intacta, dímelo en lugar de generar la imagen.

ESTILO VISUAL (idéntico en las 6 imágenes):
- Fondo: degradado vertical de #030810 (arriba) a #0a1c32 (abajo).
- Resplandor radial suave detrás del teléfono, opacidad baja, del color que yo indique.
- Textura sutil de espiral de huracán al 6% de opacidad en el fondo, decorativa.
- Marco: teléfono moderno flotando, bisel negro delgado, esquinas muy redondeadas,
  sombra suave. Ocupa el 72% inferior del lienzo y se corta ligeramente por el
  borde inferior.
- Titular: parte superior, centrado, tipografía geométrica sans-serif gruesa
  (estilo Poppins SemiBold), blanco puro, muy grande y legible en miniatura.
- Subtítulo: debajo del titular, misma familia en peso ligero, blanco al 70%,
  la mitad del tamaño del titular.
- Sin logotipos, sin marcas de agua, sin texto adicional al que yo te indique.

CRÍTICO: respeta los acentos del español exactamente como los escribo
(á é í ó ú ñ). No los omitas ni los inventes.
```

## Gemini — one block per image

```
Imagen 1 de 6. Captura adjunta: mapa con pines.
Titular: "Tu zona, en tiempo real"
Subtítulo: "Inundaciones, refugios y riesgos cerca de ti."
Resplandor: #2ecaff
La captura va intacta dentro del marco.
```

```
Imagen 2 de 6. Captura adjunta: detalle de alerta del SMN.
Titular: "Alertas oficiales del SMN"
Subtítulo: "Nivel de riesgo y qué hacer, en un vistazo."
Resplandor: #00e774
La captura va intacta. No alteres datos, nombres, cifras ni fechas del boletín.
Acentos: "qué".
```

```
Imagen 3 de 6. Captura adjunta: chat con la IA.
Titular: "Respuestas cuando más urgen"
Subtítulo: "Qué hacer y a dónde ir, con o sin internet."
Resplandor: #3167ff
La captura va intacta. No reescribas ni acortes la conversación ni el encabezado.
Acentos: "más", "Qué", "dónde".
```

```
Imagen 4 de 6. Captura adjunta: pantalla "Contactos SOS".
Titular: "Los tuyos, a un botón"
Subtítulo: "Importa tus contactos y comparte tu ubicación al instante."
Resplandor: #2ecaff
La captura va intacta. No modifiques nombres, números, emojis ni parentescos.
Acentos: "botón", "ubicación".
```

```
Imagen 5 de 6. Captura adjunta: "Chat offline" en estado CONECTADO.
Titular: "Sin red, sigues conectado"
Subtítulo: "Mensajes por Bluetooth entre teléfonos cercanos."
Resplandor: #00e774
La captura va intacta. No inventes dispositivos ni mensajes.
Acentos: "teléfonos".
```

```
Imagen 6 de 6. Captura adjunta: tarjeta verde "AYUDA" sobre el mapa.
Titular: "Reporta. Ayuda a tu colonia."
Subtítulo: "Albergues, comida y auxilio marcados por vecinos."
Resplandor: #00e774
La captura va intacta.
```

## Feature graphic (1024×500)

```
Genera una imagen de 1024x500 px para el "feature graphic" de Google Play.
Sin capturas de pantalla y sin marcos de teléfono.

- Fondo: degradado de #030810 a #0a1c32, con un resplandor #3900ff en la esquina
  inferior derecha.
- A la derecha, una espiral de huracán estilizada en #2ecaff con trazo limpio,
  parcialmente cortada por el borde derecho, opacidad media.
- A la izquierda, alineado a la izquierda, en tipografía geométrica sans-serif:
  Línea 1, grande y en blanco: "Saber qué hacer, lo cambia todo"
  Línea 2, más pequeña, en #2ecaff: "Alertas, mapa y guía ante huracanes"
- Deja un margen libre del 10% en todos los bordes: no coloques texto ni
  elementos importantes ahí porque Google los recorta.
- Acentos: "qué", "guía".
```

---

## Before publishing
1. Recapture slot 5 in the connected state.
2. Verify every accent character-by-character on each render — image models drop
   `á é í ó ú ñ`. `más` sits in the largest text on slot 3; check it first.
3. Confirm no real phone numbers survive in slot 4.
