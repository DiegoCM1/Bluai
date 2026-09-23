# Sprint 4 — Edgar

**6 ago → 14 ago 2026**

Spec técnico de tu semana: **unificar el lenguaje de alertas** y, al final, **arrancar el Bluetooth mesh**. Para coordinación general (orden, checkpoints, cut criteria) → `sprint.md`.

**Orden: primero todo lo de alertas** (lo que ya traías), **y el Bluetooth al final.** No lo empieces antes — es la tarea grande y se come la semana si la dejas entrar temprano.

---

## Bloque 1 — Semáforo de colores y peligrosidad SIAT (🟠) — tu tarea principal

### El problema

**Hay seis definiciones distintas de nivel → color → nombre**, ninguna importa de otra:

| # | Dónde | Qué define |
|---|---|---|
| 1 | `frontend/app/alerts/_components/AlertCard.tsx:9-16` `labelForLevel` | 1 Aviso · 2 Prevención · 3 Preparación · 4 Alarma · 5 Afectación |
| 2 | `frontend/app/alerts/_components/AlertCard.tsx:18-25` `colorForLevel` | 1 `brandTeal #4ed5de` · 2 `brandGreen #00e774` · 3 `#ffce00` · 4 `#ff8500` · 5 `#e24337` |
| 3 | `frontend/app/map/index.tsx:68-74` `LEVEL_COLORS` | 1 `#4CAF50` · 2 `#4CAF50` · 3 `#FFC107` · 4 `#FF9800` · 5 `#F44336` (Material, no tokens de marca) |
| 4 | `backend/app/features/siat/evaluator.py:32-36` (+ docstring 5-9) | 1 AZUL "aviso preventivo" · 2 VERDE "preparación" · 3 AMARILLO "alerta" · 4 NARANJA "peligro alto" · 5 ROJO |
| 5 | `backend/app/features/siat/service.py:38-44` `_COLOR_LABELS` | AZUL→"Azul" … ROJO→"Rojo" — **es lo que sale en el título del push**: `f"Alerta SIAT-CT {label}"` (`service.py:303-304`) |
| 6 | `docs/BRAND.md:88-94` "canonical mapping" | Safe/Clear→verde · Watch→amarillo · Advisory→**morado** · Warning→naranja · Emergency→rojo |

### Las contradicciones concretas

1. **Dos vocabularios para el mismo evento.** El push dice *"Alerta SIAT-CT **Amarillo**"*; el usuario abre la app y ve *"**PREPARACIÓN** / Nivel 3"* (`alerts/[id].tsx:197,200`). La palabra-color y la palabra-fase **nunca aparecen juntas** en ningún lado, así que no hay forma de conectarlas.
2. **Backend y frontend están corridos un escalón.** `evaluator.py:7-8` llama al nivel 2 *"preparación"* y al 3 *"alerta"*. `AlertCard.tsx:11-12` llama al 2 *"Prevención"* y al 3 *"Preparación"*.
3. **`BRAND.md` se contradice con el código que dice gobernar.** `BRAND.md:96-98` dice literal: *"`brand-teal`/`brand-cyan` son acentos de mapa/icono, **no** colores de severidad"* — y `colorForLevel(1)` devuelve `colors.brandTeal`. Además `brand-purple` ("Advisory") **no aparece en ningún mapa de niveles**. Y el verde de BRAND es *"No active threat"*, pero el nivel 2 = VERDE es el **mínimo que dispara push** (`siat/service.py:35 _NOTIFY_MIN_LEVEL = 2`): estamos pintando de "seguro" una alerta que sí notifica.
4. **Mapa y lista discrepan en el mismo nivel.** El 1 es teal en la lista y verde en el mapa; y el mapa **colapsa 1 y 2 en el mismo verde** (`map/index.tsx:69-70`).
5. **Saffir-Simpson filtrándose en la escala SIAT.** `backend/app/features/alerts/service.py:9-18` `_smn_headline_to_level()` mapea el string del boletín *"CATEGORÍA 4"/"CATEGORÍA 5"* al **nivel SIAT 5**. Son dos escalas distintas: SIAT es fase operativa, Saffir-Simpson es intensidad física. *(También `openweather_service.py:37-49` devuelve una categoría Saffir-Simpson bajo el nombre `risk_level` — hoy latente, el frontend no lo consume.)*
6. **El código ya lo sabe:** `AlertCard.tsx:8` tiene `// TODO: replace with backend field once AlertDetail exposes SIAT label`.

### ⚠️ Lo que ya está bien — no lo rompas

`map/index.tsx:76-82` y `backend/app/features/siat/classification.py:1-7` mantienen los colores de **intensidad de tormenta** (HU/TS/TD) separados de los de **nivel SIAT**, con comentarios explicando por qué. **Esa separación es correcta y tiene que sobrevivir** al refactor. La discrepancia está *dentro* de las paletas de nivel SIAT, no entre esas dos familias.

Y la mitad de esto **ya la arreglaste** en el PR #229: `alerts/[id].tsx:200` y `AlarmScreen.jsx:52` ya dicen "Nivel" en vez de "Categoría". *(Queda el nombre interno del prop `category` en `AlarmScreen.jsx:7,17,34` y `_layout.tsx:280` — cosmético, no lo ve el usuario.)*

### Lo que tiene que salir de esta tarea

- **Un mapa canónico** `nivel → { color, fase, etiqueta }` en **un** lugar, del que importen la lista, el mapa, el detalle y AlarmScreen
- **Palabras de fase alineadas** entre backend y frontend (decidir cuál es la correcta según SIAT-CT oficial)
- **Push y app hablando el mismo idioma** — que el usuario pueda conectar lo que le llegó con lo que ve
- **`BRAND.md` reconciliado** con lo que quede: si teal deja de ser severidad, fuera de `colorForLevel`; si se queda, actualiza BRAND
- **Decisión escrita sobre `_smn_headline_to_level()`** — meter "CATEGORÍA 5" en nivel 5 puede estar bien como heurística, pero que sea decisión y no accidente

**Cut criteria (`sprint.md` #4):** si no llegas completo, ship del canónico **backend + lista de alertas** y difiere el mapa. Lo importante es que **exista una sola fuente de verdad**, aunque no todos la consuman todavía.

---

## Bloque 2 — Dejar de mandar datos personales a Sentry (🟡, ~2 h)

**El mejor retorno por hora del sprint.** Dos cambios chicos.

### (a) `transform-remove-console` en Babel

`frontend/babel.config.js` **no** lo tiene, así que los **181 `console.*`** del proyecto **se embarcan en release** — y con Sentry como está configurado, se capturan como breadcrumbs. Agrégalo solo para producción.

### (b) Borrar a mano los peores

| Archivo:línea | Qué imprime |
|---|---|
| `SOSContactsScreen.tsx:209` | nombre completo + teléfono (`JSON.stringify`) |
| `SOSContactsScreen.tsx:225` | payload completo del contacto con teléfono |
| `SOSContactsScreen.tsx:301` | **la URL de invitación completa** — equivale a un bearer token |
| `SOSContactsScreen.tsx:200` | teléfono del selector de contactos |
| `sos-invite/[token].tsx:30,70,85` | el token de invitación en crudo |
| `_layout.tsx:232,378` | token de invitación desde el push |
| `sos-receiver/index.tsx:22` | lat/lon de quien manda el SOS |
| `map/index.tsx:89,261,322` | GPS en vivo del usuario |
| `pushNotifications.ts:219` | `console.log("FCM token →", fcmToken)` |

### Por qué importa

`frontend/app/_layout.tsx:36-53` está así, **sin `beforeSend` ni `beforeBreadcrumb` que filtren nada**:

```js
sendDefaultPii: true,              // :41
enableLogs: true,                  // :44
replaysSessionSampleRate: 0.1,     // :47
replaysOnErrorSampleRate: 1,       // :48
```

Y el usuario va identificado (`AuthContext.tsx:36` → `Sentry.setUser({ id, email })`). O sea: teléfonos de contactos SOS, coordenadas y tokens de un solo uso, **atados a un usuario con nombre**, en un servicio de terceros, con replay de sesión en 10% de las sesiones y 100% de las que tienen error.

*Opcional y barato: un `beforeBreadcrumb` en la init como red de seguridad.*

---

## Bloque 3 — Que un usuario ciego pueda mandar un SOS (🟡, ~1 día)

### El problema

`frontend/app/map/index.tsx:902-916` — el botón de SOS:

```jsx
<TouchableOpacity onPress={handleSOSTrigger} disabled={isSosSending} style={{...}}>
  {isSosSending ? <ActivityIndicator .../> : <MaterialCommunityIcons name="alarm-light-outline" .../>}
</TouchableOpacity>
```

Sin `accessibilityLabel`, sin `accessibilityRole`, sin `accessibilityState`. **Su único hijo es un ícono**, así que no hay texto de respaldo: el lector de pantalla anuncia un botón sin nombre. En toda la app, **15 de 97 touchables** llevan alguna prop de accesibilidad, y `accessibilityState` aparece **una sola vez** en todo el repo.

### Solo el camino crítico

| Dónde | Qué falta |
|---|---|
| `map/index.tsx:902-916` | el FAB de SOS — label, role, y `state` para el `disabled` |
| `AlarmScreen.jsx:69,78,89` | los botones sí tienen `<Text>` (se anuncian) pero sin `role` |
| `(tabs)/_layout.tsx:80` | tab bar custom — sin `accessibilityRole="tab"` ni `accessibilityState={{selected}}` |

**Referencia de cómo se hace bien en este repo:** `frontend/components/OptionCard.tsx:36-37` y `frontend/components/ScreenHeader.tsx:26-27` ya lo implementan correctamente. Copia ese patrón.

---

## Bloque 4 — Trayectoria del huracán (🟡)

Construye sobre el trabajo de ciclones de los PRs #226/#229.

**Aviso antes de agregarle carga al mapa:** `list_map_events` (`backend/app/features/map_events/service.py:157-192`) hace `SELECT e.id FROM map_events e ORDER BY e.created_at DESC` — **sin WHERE, sin bounding box, sin LIMIT** — y luego llama `get_map_event_with_votes` **una vez por fila** (N+1), filtrando por Haversine **en Python**. El `radius_km` es post-proceso, no filtro. Y **no existe un solo `CREATE INDEX` en todo el backend**; `ensure_map_events_table` además re-consulta `information_schema.columns` **en cada request**.

No es tu tarea arreglarlo esta semana, pero sábelo antes de medir.

---

## Bloque 5 — Bluetooth mesh (⬜) — **hasta el final, cuando lo de alertas esté cerrado**

### Goal

Que un mensaje **salte de teléfono en teléfono**: si A no alcanza a C pero B está en medio, el mensaje de A llega a C **pasando por B**.

### ⚠️ Antes de nada: ya hay una especificación escrita

**`docs/specs_july05/val_sprint_3.md` tiene el diseño completo del mesh** — el algoritmo, el archivo nuevo a crear, la lógica de recibir/enviar, los failure modes, y un harness de pruebas en memoria. Se especificó y no se construyó. **Léela primero; no rediseñes.**

### Context

**Lo que ya existe — y es más de lo que parece.** `frontend/app/local-chat/_services/protocol.ts` ya define el sobre con todo lo que el mesh necesita:

```ts
export interface Envelope {
  v: 1; id: string; from: string;
  to: string;       // peerId | BROADCAST
  ttl: number;
  kind: MessageKind; body: string; ts: number;
}
export const BROADCAST = "*";
```

Con el comentario: *"Keeping this envelope now means the mesh router is purely additive later — the transport and UI never learn about hops."* **No hay que tocar el formato de mensaje.**

**Lo que falta — dos piezas de dificultad muy distinta:**

| Pieza | Qué es | Riesgo |
|---|---|---|
| **1. Router JS** (`_services/meshRouter.ts`, archivo nuevo) | Dedup por `id`, decrementar `ttl`, relay, split horizon, descartar en `ttl<=0` | **Bajo** — lógica pura, se prueba sin hardware |
| **2. Modo grupo nativo** | `with-nearby-connections.js:123` está en `Strategy.P2P_POINT_TO_POINT`; el mesh necesita `P2P_CLUSTER` | **Alto** — Kotlin, y el Sprint 3 ya lo marcó como el punto de mayor riesgo |

Hoy `ttl` default es **1** (`protocol.ts:49`) — o sea, sin relay. Y no existe ningún router: buscar `relay`/`dedup`/`hop` en `_services/` no devuelve nada más que comentarios.

### El piso — lo mínimo el viernes 14

> **El router funcionando y demostrable**, aunque el modo grupo no haya quedado: que se vea que un mensaje se reenvía, que **no se duplica**, y que **muere cuando se le acaban los saltos**. Aunque sea con dos teléfonos y un salto forzado a mano, o con el harness de simulación del spec de Sprint 3.

**La meta si alcanza:** tres teléfonos Android, A y C fuera de rango entre sí, B en medio, y el mensaje de A **llega a C**.

**Si el modo grupo pelea: no lo empujes.** Router terminado + nota de qué falló en el intento nativo. Un router probado sin modo grupo es progreso; un modo grupo a medias que rompe el chat uno-a-uno que **hoy sí funciona** es un retroceso.

### Dos arreglos chicos de seguridad en el mismo código

1. **Auto-acepta a cualquiera.** `frontend/plugins/with-nearby-connections.js:172-181` llama `connectionsClient.acceptConnection(...)` dentro de `onConnectionInitiated`, sin preguntar nada. `authenticationDigits` aparece **cero veces en el repo**, y solo `endpointId`/`endpointName` cruzan el bridge (`NearbyTransport.android.ts:47-75`) — así que la capa JS **no puede** mostrar dígitos aunque quisiera. El apodo es texto libre 2-20 chars (`NicknameModal.tsx:41-46`), así que alguien puede presentarse como "Mamá" o "Protección Civil".
2. **El bloqueo es por apodo, no por dispositivo.** `_services/storage.ts:15` → `blocked: "bt:blocked_nicknames"`. **Un rename evade un bloqueo**, y de paso bloqueas a cualquier peer honesto que se llame igual — cuando tu propio `_types.ts:40-46` ya dice que `deviceId` es la llave estable. **Bloquear por `deviceId` es barato y cierra esto.** Con mesh importa más, no menos: los mensajes pasan por teléfonos de desconocidos.

*(Relacionado: `protocol.ts:15,18,71` define un mensaje `identity` que deja a un peer **renombrarse a media sesión**, manejado en `LocalChatProvider.tsx:356`.)*

> **iOS no aplica:** `NearbyTransport.ios.ts` es un stub con `isAvailable: false`. El chat Bluetooth **no existe en iPhone**.

---

## Tests

- **Semáforo:** que las pantallas y el push usen el mismo mapa; verificado en device físico.
- **Mesh — antes del hardware:** el harness de simulación en memoria del spec de Sprint 3. Los cuatro invariantes del flooding: no duplicar, decrementar TTL, no devolver por donde llegó, morir en `ttl<=0`.

---

## Estrategia de PRs (≤ 400 líneas cada uno)

1. **Babel + borrar logs de PII** — bloque 2, primero de la semana (2 h, gran retorno)
2. **Mapa canónico de niveles (backend + lista)** — el corazón del bloque 1
3. **Consumir el canónico en mapa, detalle y AlarmScreen** + reconciliar `BRAND.md`
4. **Accesibilidad del camino crítico** — bloque 3
5. **Trayectoria del huracán**
6. **Bloqueo por `deviceId`** — chico, independiente del mesh
7. **`meshRouter.ts` + harness de simulación** — el piso del bloque 5
8. **(si alcanza)** `P2P_CLUSTER` en el nativo

---

## DoD

- [x] Existe **un** mapa canónico nivel → color/fase/etiqueta, importado por lista, mapa, detalle y AlarmScreen
- [x] Las palabras de fase de backend y frontend coinciden
- [x] Push y app usan vocabulario reconciliable
- [x] `BRAND.md` y el código ya no se contradicen (teal, morado, verde=nivel 2)
- [x] Los colores de **intensidad de tormenta** siguen separados de los de nivel SIAT
- [x] Decisión escrita sobre `_smn_headline_to_level()`
- [x] `transform-remove-console` activo en producción; logs de teléfono/GPS/token eliminados
- [x] El botón de SOS tiene label, role y estado; tab bar con `role="tab"` y `selected`
- [x] Bloqueo de peers por `deviceId`, no por apodo — ahora enforced de verdad: `onConnectionInitiated` en el nativo rechaza (`rejectConnection`) antes de aceptar si el `deviceId` está en la lista sincronizada desde JS (`setBlockedDeviceIds`), y hay UI (long-press en `PeerList` + `BlockedList` para desbloquear). **Sin verificar en dispositivo.**
- [x] **Router de mesh funcionando y demostrable**, con los cuatro invariantes probados — `meshRouter.ts` + `meshRouter.harness.ts`, los 4 corriendo en verde con `npx tsx` (hop, dedup, TTL, split horizon). Esto es "demostrable sin hardware", que el propio spec de Sprint 3 acepta como entregable válido si el nativo no llega a tiempo.
- [ ] El chat uno-a-uno **sigue funcionando igual que antes** — el código 1-a-1 (`sendMessage`/`transmit`) no se tocó; solo pasa por el router en recepción (`onPayload`), donde un envelope directo (`ttl:1`, `to:peerId`) se comporta igual que antes por diseño del router. Razonado, no verificado — falta probarlo en dispositivo.
- [ ] Verificado en device físico; PRs ≤ 400 líneas — **no lo pude hacer, no tengo dispositivo.** El nativo (Kotlin vía `with-nearby-connections.js`) es la pieza que el propio spec de Sprint 3 marca como mayor riesgo y pide que Diego revise/paree — no se probó ni compiló. `LocalChatProvider.tsx` quedó en +352 líneas en un solo diff; para PRs reales, separar como en la "Estrategia de PRs" del spec de Sprint 3 (router+harness / nativo / integración / UI son 4 PRs distintos, no uno).

---

## Out of Scope (este sprint)

- **`P2P_CLUSTER` en el nativo** si el router se lleva el tiempo — se difiere **con nota escrita de qué falló**
- **Mostrar dígitos de confirmación antes de aceptar** — toca Kotlin, es lo caro
- **Mesh en iOS** — el transporte iOS es un stub; es terreno greenfield
- **Cifrado / autenticación de mensajes mesh** — sigue fuera desde Sprint 3
- **Accesibilidad completa de la app** — solo el camino crítico este sprint
- **Índices y N+1 de `map_events`** — ver bloque 4, es del próximo sprint
- **Compartir en WhatsApp** — pasó a "si alcanza", ver `sprint.md`

---

## Capacidad — mira la math antes de empezar

5 días hábiles. Tu semana es la más balanceada del equipo, pero el mesh es un pozo sin fondo si lo dejas entrar temprano.

| Bloque | Costo | Cuándo |
|---|---|---|
| 2 · Sentry + logs | ~2 h | **Lunes, primero** — es lo más barato por lo que evita |
| 1 · Semáforo SIAT | ~2-3 días | El grueso |
| 3 · Accesibilidad | ~1 día | |
| 4 · Trayectoria | ~0.5 día | |
| 5 · Bluetooth mesh | lo que quede | **Solo cuando lo de alertas esté cerrado** |

**Ojo con la colisión:** `backend/app/features/siat/service.py` es tuyo para el semáforo **y** de Diego para el chunking de 500. Él tiene gate del miércoles 12 y son ~30 líneas — **deja que mergee primero** y luego trabajas encima.

Si algo te pelea más de un día, **dilo en el grupo el mismo día**.
