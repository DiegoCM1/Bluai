# iOS Release — estado y pendientes

Estado al **18 de agosto de 2026**. Este doc es la fuente de verdad de qué falta para
publicar Bluai en la App Store. Android ya está en Play Store; iOS nunca se ha publicado.

**Alcance de este release:** Bluetooth (chat local) y la IA offline **NO salen en iOS**.
Paridad iOS/Android es objetivo de un release posterior.

---

## SACRED RULE de este release

**El fix de push en iOS no está terminado hasta que un push llegue a un build de
TestFlight — no a un dev client.**

El dev client y TestFlight hablan con *gateways distintos* de Apple (sandbox vs
producción). Un push que funciona en tu iPhone conectado a Metro no prueba nada sobre
lo que verá un usuario real. Ver "Gotchas → `aps-environment`" abajo.

---

## Estado App Store Connect — 18/08

Sesión del Account Holder (Héctor Iván Resendiz — cuenta **individual**, no organización):

| Ítem | Estado |
|---|---|
| Apple Developer Program License Agreement (versión nueva) | ✅ **Aceptado.** Era el bloqueador real: el banner decía textual *"the Account Holder must review and accept the updated agreement"* para poder *submit new apps* |
| Free Apps Agreement | ✅ **Active**, 18/08/2026 – 08/05/2027, ya sin "(New Agreement Available)" |
| Paid Apps Agreement | `New`, sin firmar — **no se necesita** (no hay IAP). Firmarlo pediría legal entity |
| Declaración DSA (trader) | ⏭️ **No aplica** — se resolvió restringiendo disponibilidad, no declarando |
| Disponibilidad de la app | ✅ **Solo México** (1 país, "Available on App Release") |
| Capabilities en `com.bluai.app` | ✅ **Ya estaban** — Push Notifications y Sign in with Apple aparecieron **ya palomeadas** (18/08). *Broadcast Capability* sin marcar, que es lo correcto |
| App Store Connect API Team Key | ✅ **Ya existía** — "EAS Build Key", acceso **Admin**, Key ID `N3M5RJLBGQ`, Issuer ID `f2ad728e-2be8-4260-867f-32ca16b2b6e8`, **last used 06/06/2026** |
| Acceso a Certificates, Identifiers & Profiles para `blueyehurricanealerts@gmail.com` | ❌ **IMPOSIBLE en esta cuenta** — límite estructural de las cuentas Individual, ver abajo |

**El banner rojo de DSA se queda ahí.** Es de *cuenta*, no de app: refleja que la cuenta
nunca declaró trader status. Con la app solo en México el EU queda fuera de alcance y deja
de importar. No leerlo como "sigue bloqueado".

Ojo con las dos cosas que dicen "All Countries or Regions" y no son la misma: la del
renglón de **Agreements** es el alcance del contrato con Apple (se queda amplio, es
normal); la que decide si el DSA aplica es la **disponibilidad por app**, en *Pricing and
Availability*. La disponibilidad es metadata, no binario — se pueden agregar países después
sin build ni review nuevos.

### El bloqueador #3 no era permisos — es el tipo de cuenta (resuelto 18/08)

`blueyehurricanealerts@gmail.com` **es Admin con All Apps** y aun así
`developer.apple.com/account` le muestra "Join the Apple Developer Program → Enroll today"
(verificado 18/08 en sesión limpia, con la cuenta correcta firmada). No hay checkbox que
falte: en *Additional Resources* solo hay *Create Apps* y *Generate Individual API Keys*.

La causa es que **la cuenta es Individual, no Organization**.

**Fuente** (verificada 18/08 leyendo la página, no de memoria) — *Apple Developer Account
Help → Access → "Apple Developer Program Roles"*:
<https://developer.apple.com/help/account/access/roles/>

Tres frases de **esa misma página**, en tres lugares distintos, que juntas explican todo:

> Al pie del renglón *"Manage access to Certificates, Identifiers & Profiles"*:
> *"Certificates, Identifiers & Profiles is only available to Account Holders and members of
> an **organization's** team."*

> Nota bajo *"Permissions in App Store Connect"*, sección Users and Access:
> *"If you're enrolled as an individual and add users in App Store Connect, users receive
> access **only to your content in App Store Connect** and are **not considered part of your
> team in the Apple Developer Program**."*

> En la tabla de roles, para **Admin**:
> *"Requires access to Certificates, Identifiers & Profiles, **granted in Users and Access
> in App Store Connect**."*

La tercera es la que cierra el círculo y explica por qué *Additional Resources* se veía
vacío: el rol de Admin **sí** necesita ese permiso, y el permiso **solo existe** en cuentas
Organization. En una Individual el permiso está en el modelo pero no hay forma de
otorgarlo. No es un bug ni un paso que se nos olvidó.

**Consecuencias, y no son cosméticas:**

1. **Solo `hi.resendiz@gmail.com` (Account Holder) puede tocar el App ID `com.bluai.app`.**
   Las capabilities (Push Notifications, Sign in with Apple) salen de esa sesión, no de la
   de Admin. No es cuestión de otorgar un permiso — no existe el permiso que otorgar.
2. **EAS Build también necesita el portal**, porque ahí crea el certificado de distribución
   y el provisioning profile. O sea que EAS necesita credenciales de Account Holder, no las
   de Admin. Esto estaba invisible hasta hoy.
3. **Salida:** generar una **App Store Connect API Key** desde la sesión del Account
   Holder — *Users and Access → Integrations → App Store Connect API → **Team Keys***, con
   acceso **Admin**. Autentica a EAS contra el portal y contra ASC **sin prompt de 2FA**,
   que si no llega a los dispositivos de Ivan en cada build y cada submit.
   ⚠️ **Tiene que ser Team Key, no Individual Key.** Una *Individual API Key* lleva los
   permisos del usuario que la generó; la de `blueyehurricanealerts@gmail.com` no tendría
   portal, por lo mismo de arriba. El `.p8` **se descarga una sola vez** — igual que la key
   de APNs. Fuera del repo.
4. **Post-release:** convertir la membresía a **Organization** quita este impuesto de raíz
   (y de paso la ficha dejaría de decir "Hector Ivan Resendiz"). Pide D-U-N-S y tarda días
   — no es de hoy.

**Roles reales (18/08):** `hi.resendiz@gmail.com` = Account Holder + Admin ·
`blueyehurricanealerts@gmail.com` = **Admin** ← la cuenta del release ·
`luiscolin764@gmail.com` (Diego) = **Developer**, que **no puede** subir versiones ni
editar metadata. Todo el trabajo de release va con la cuenta de Admin.


### Lo de Apple ya estaba casi todo hecho — nadie lo había revisado

Al revisar el portal el 18/08, dos de los tres "bloqueadores de Ivan" resultaron no serlo:

| # | Decía el doc | Realidad al 18/08 |
|---|---|---|
| 1 | Agreements pendientes | ✅ **Era real y sí bloqueaba.** Resuelto hoy |
| 2 | Falta habilitar capabilities | ⚠️ **Ya estaban palomeadas.** Sin verificar desde ≥05/2026 |
| 3 | Falta el checkbox de Certificates | ❌ **Mal diagnóstico** — imposible en cuenta Individual |

→ La lección operativa: **un bloqueador anotado y no revalidado envejece hacia el falso
positivo.** Dos de tres costaron espera que no hacía falta. Antes de escalar algo a otra
persona, volver a mirarlo.

**Sobre "Configure" en Push Notifications:** ese botón crea **certificados SSL de APNs**
(el mecanismo viejo, por App ID), y `Certificates (0)` los cuenta a ellos. Bluai usa **auth
key `.p8`**, que vive a nivel *team* y por eso no aparece en esa pantalla. `(0)` es la
lectura esperada, no un hueco — configurar un certificado agregaría una segunda ruta de
credencial, redundante.

**Sobre la API Key:** el `.p8` se descarga una sola vez, pero **EAS guarda las credenciales
en su servidor**, y `last used 06/06/2026` es el registro de Apple de esa key
autenticándose. Lo más probable es que EAS ya la tenga y no haga falta el archivo. Si
`eas build` la pidiera: generar **otra** Team Key sale gratis — las ASC API keys topan en
**50 activas y no expiran**. Ese instinto **no** aplica a las auth keys de APNs, que topan
en **2** y obligan a revocar antes de rotar.

Key ID e Issuer ID son **identificadores, no secretos** (van en `eas.json` si algún día se
automatiza). El secreto es el `.p8`, y ese nunca entra al repo.

### Build + submit — cómo autentica cada uno (18/08)

**Build `d21a4437` — FINISHED.** `1.9.0 (15)`, perfil `production`, commit `a04f672`
(incluye el guard de `subscribeToTokenRefresh`). ~54 min. Subido a App Store Connect el
18/08.

La lección que costó tiempo hoy: **`eas build` y `eas submit` autentican distinto**, y por
eso uno pidió login de Apple con 2FA y el otro no pidió nada.

| Comando | Qué sistema toca | Cómo autenticó |
|---|---|---|
| `eas build` | **Developer Portal** (certificados + provisioning profiles) | Apple ID `hi.resendiz@gmail.com` + 2FA. En cuenta Individual **solo el Account Holder** puede |
| `eas submit` | **App Store Connect** (subir el binario) | **ASC API Key ya guardada en servidores de EAS** (`N3M5RJLBGQ`, `Key Source: EAS servers`). **Cero prompts, 19 segundos** |

O sea que la restricción de cuenta Individual afecta **solo** al portal. Todo lo de ASC
—subir builds, TestFlight, metadata, Submit for Review— lo puede hacer el rol **Admin**
(`blueyehurricanealerts@gmail.com`), que en su lista de permisos trae *Upload builds*,
*Manage TestFlight builds* y *Create apps and submit versions*.

**Consecuencias prácticas:**

- **Los submits siguientes no piden nada.** La API key vive en EAS, no en esta Mac.
- **No hace falta `appleId` en el bloque `submit` de `eas.json`** — ese camino nunca
  pregunta por un Apple ID. Sería config muerta.
- **Ivan solo se necesita para builds nuevos** (y para agreements). Nada más en el camino
  al App Store.
- Una app-specific password (`EXPO_APPLE_APP_SPECIFIC_PASSWORD`) sigue siendo la salida
  **para CI / `--non-interactive`**, donde no hay humano que lea un código de 6 dígitos.
  Con humano presente y teléfono en mano, el login normal es más simple.

### TestFlight — historial real de builds

Un solo build subido en la vida de la app:

| Versión | Build | Estado | Fecha |
|---|---|---|---|
| 1.8.0 | 1 | Ready to Submit (expira en ~23h) | 21/05/2026 |

**Esto cierra el paso 1 de P3.** `app.json` va en `version: "1.9.0"` + `buildNumber: "15"`,
y **1.9.0 no tiene ni un upload** → el 15 está libre y no hay que tocarlo. De los tres
builds de EAS del 21/05 solo uno llegó a Apple, y tomó el número 1.

→ TestFlight, no `eas build:list`, es la fuente autoritativa: un build solo quema un número
cuando se **sube** a Apple, no cuando EAS lo compila.

---

## Ya hecho (commiteado)

| Área | Cambio |
|---|---|
| Telemetría push | `frontend/utils/pushTelemetry.ts` — taxonomía de fallos, Sentry, dedupe, `redactToken()` |
| Push error handling | `pushNotifications.ts` — se arregló el hueco de 4xx (`lastErr` sin asignar), el `await setupNotificationChannels()` sin proteger, y se migró a `/api/v1/push-token` |
| Config iOS | `supportsTablet: false`, `UIBackgroundModes` sin duplicado, `ios.buildNumber: "15"` |
| executorch en iOS | Card de IA offline oculta en `SettingsScreen.tsx`; copy del tour y de `useChat` ya no manda a iPhone a Ajustes |
| Chat local en iOS | `local-chat/index.tsx` muestra "Próximamente en iPhone" en vez de un error rojo "Algo falló" |
| Permisos iOS | Se eliminaron `expo-camera`, `expo-image-picker`, `expo-audio` (0 imports) → se van 3 purpose strings falsos. Location con string en español |
| Marca | Todo el copy visible dice **Bluai** (ya no "BluEye") |
| APNs keys | Las dos auth keys verificadas (`Services: APNs`) y subidas a Firebase: dev `7MTNJ97RXH`, prod `2R524J3M7P`, team `M5CJDZ3897`. El `.p8` **no** vive en el repo |
| **A — token FCM en iOS** (`1e704ea`) | `messaging@24.0.0` + los tres RNFB pineados exacto; `react-native.config.js` desliga Android; `acquireFcmToken()` con poll de APNs en `pushNotifications.ts`; `RNFBMessaging` en `forceStaticLinking` |
| **D — `aps-environment`** (`32f011f`) | Una línea: `["expo-notifications", { "mode": "production" }]`. Probado en los dos caminos (ver Gotchas) |
| **C — config APNs en backend** | Helper `build_apns_config()` en `notifications/service.py`; 6 de 7 sends migrados. Sonido + `interruption-level` en las alertas de ciclón y SOS. 225 tests pasan |
| **Diagnóstico de fallos push** | `summarize_push_failures()` — se loguea el **tipo** de excepción de FCM en vez de los tokens completos, y **antes** de borrar. `ThirdPartyAuthError` = auth key de APNs inválida, el error clave del primer TestFlight |
| **Columna `platform`** | `device_tokens.platform` + backfill que se apaga solo + `Platform.OS` desde el cliente. Ver G — la ventana del backfill se cierra con el primer build de iOS |
| **F — borrado de cuenta** (`2b98048`, `aa30973`) | DB primero y Firebase después; `sos_events.sender_id` → `ON DELETE CASCADE`; limpieza de AsyncStorage al borrar; `test_delete_cascade.py` en CI. **Validado el 17/08 en el Simulator** (no en iPhone físico — ver abajo), con cuenta de Google |

Verificado en Pixel 7: el happy path de push, el path de fallo (Sentry + toast + 3
reintentos), y la carrera del 404 (no se dispara — `upsertUserProfile` gana con holgura).

---

## Falta — código, nada bloqueado

### ~~A. Fase 2 — token de push en iOS~~ ✅ **HECHO** (`1e704ea`)

**`apns-token-timeout` ya está** (15/08). No era cosmético: separa "el registro tronó"
de "el registro funcionó y Apple nunca mandó el token", y **esa segunda es la falla
esperada hoy**, porque el App ID `com.bluai.app` todavía no tiene la capability de Push
(bloqueador #2 de Ivan). Sin el tipo aparte, Sentry mezcla "mi código está mal" con
"falta que Ivan habilite Push" en un solo bucket. El mensaje ahora cita el presupuesto
real del poll (10 × 300ms).

~~Queda pendiente `onTokenRefresh` en iOS~~ ✅ **HECHO 18/08.** `subscribeToTokenRefresh()`
en `pushNotifications.ts`: iOS usa `onTokenRefresh` de RNFB (emite token de FCM), Android
se queda con `addPushTokenListener` de expo — **comportamiento idéntico en Android**. El
`getMessaging()` vive detrás del branch de `Platform.OS`, igual que en `acquireFcmToken()`.
Firma verificada contra `messaging/dist/typescript/lib/modular.d.ts:48`. tsc limpio; eslint
en el baseline exacto (350) — cero errores nuevos.

**Guard obligatorio (encontrado corriendo la app, 18/08).** La primera versión llamaba
`getMessaging()` sin proteger y **tiró la app entera** en un dev client anterior a
`1e704ea`: *"You attempted to use a Firebase module that's not installed natively"*, y
detrás el cascade *"Attempted to navigate before mounting the Root Layout"*.
`acquireFcmToken()` nunca lo pegó porque `registerForPushNotificationsAsync()` corta antes
con `if (!Device.isDevice) return null` — pero `subscribeToTokenRefresh()` se llama
**incondicionalmente** desde el `useEffect` de `AuthGate`. Ahora lleva el mismo guard de
`Device.isDevice` (breadcrumb, no error — en Simulator es lo esperado) **y** un try/catch
que reporta `token-unavailable` y devuelve un unsubscribe no-op. Un throw síncrono en esa
posición no degrada "no hay rotación de token": se lleva el render del árbol completo.

Por qué no era cosmético: `sendTokenToBackend` **pisa** el token guardado, así que en iOS
una rotación habría reemplazado el token bueno del arranque por hex crudo de APNs. Y el
backend no lo habría limpiado — ese fallo no es `UnregisteredError`, así que la lista
blanca de `_PERMANENT_FAILURE_TYPES` (correctamente) lo conserva. Cuenta muda, sin rastro.

### ~~B. Fase 3 — presentación en primer plano~~ ✅ **HECHO (15/08)**

> **Corrección:** este doc decía que "una alerta en primer plano no se ve" en iOS. **Era
> falso.** El todo-en-false era deliberado: la app dibuja su propia UI (toast de
> sonner-native, `AlarmScreen`) en vez del banner del sistema. Poner los flags en true
> habría dado banner **encima** del toast — UI duplicada, no un arreglo.

Lo que sí estaba roto era el **sonido**: en Android el canal (`IMPORTANCE_MAX`) suena
aunque el handler diga que no, así que nunca se notó; iOS obedece el handler literal y una
alerta nivel 4 llegaba muda con la app abierta. El `sound: "default"` de C no sirve de
nada si el handler se niega a reproducirlo — **son dos switches en repos distintos y los
dos tienen que estar prendidos**.

Ahora `handleNotification` recibe la notificación y devuelve `shouldPlaySound: isCritical`
(`fullScreen`, `category=sos`, o nivel ≥ 4). Lo visual sigue siendo de la app.

**Verificar en el Pixel:** que una alerta crítica no suene **dos veces** en Android (canal
+ handler). Es un fallo ruidoso, no silencioso — se nota al primer push.

**sonner-native en iOS: investigado, es sólido.** `toaster.tsx:58` mete el Toaster en un
`FullWindowOverlay` de react-native-screens (4.16.0) = un `UIWindow` aparte, por encima de
native-stack y de modales; `pointerEvents: 'box-none'` deja pasar los toques a los botones
de acción. El comentario del propio paquete dice que la plataforma frágil es **Android**
(depende de `elevation: 9999` dentro de la misma ventana). `<Toaster />` está montado como
hermano de `<Stack>`, fuera del navigator — que es lo correcto.

### ~~C. Fase 4 — config APNs en backend~~ ✅ **6 de 7 HECHO**

Helper `build_apns_config()` en `notifications/service.py`. Migrados: `siat:326`, `siat:411`,
`sos_trigger:104`, `sos_invite:138`, `notifications:122`, `notifications:186`.

**Lo importante no era el sonido, era `interruption-level`.** Los Focus modes de iOS 15+
(Sueño, No Molestar) **suprimen** notificaciones normales. Sin `time-sensitive`, la alerta
de huracán de las 3am se retiene hasta que el usuario desbloquee. Las dos alertas de ciclón
y el SOS lo llevan; la invitación SOS y la campaña **no** (Apple penaliza usar el flag para
marketing). `Aps` no tiene campo para esto — va en `custom_data`.

El séptimo (`contacts_refresh`) se difirió: ver **G**.

### ~~D. `aps-environment`~~ ✅ **HECHO** (`32f011f`)

Una línea en `app.json`: `["expo-notifications", { "mode": "production" }]`. Ver Gotchas
para por qué esto basta y por qué **no** hizo falta `app.config.js`.

---

## Falta — no es de iOS, pero iOS lo empeora

### ~~E. Corte de 500 + predicado de borrado~~ ✅ **HECHO (17/08)** — rama `fix/500-cap-firebase`

Eran dos bugs distintos en el mismo código de envío, los dos silenciosos:

**1. Sin cota de 500.** `send_each_for_multicast` lanza un `ValueError` **del lado del
cliente, antes de cualquier llamada de red** (`firebase_admin/messaging.py:435`) si le
pasan más de 500 tokens. No hay error de Firebase ni status HTTP: el push no sale y el
`except Exception` se lo traga. Sin cota estaban `send_all_notifications` (campaña: toda
la tabla) y `_push_smn_for_alert` (SIAT: todos los usuarios afectados, aplanados).

**2. Borraba tokens buenos.** El predicado era `if not r.success`: **cualquier** fallo
borraba el token, incluidos los transitorios. `ThirdPartyAuthError` significa "la auth key
de APNs es inválida" y llega **por token** — o sea que en cuanto entraran tokens de iOS
con cualquier problema de aprovisionamiento, el backend habría borrado justo los aparatos
que uno está tratando de depurar: se registran, fallan, se borran, se re-registran, en
bucle y sin dejar rastro (el borrado destruye la evidencia). Esta mitad era la urgente
para iOS; por eso se adelantó E en vez de esperar al release.

**Arreglo:**

- `_send_multicast_with_retry` parte en chunks de 500 y devuelve **una sola** respuesta
  agregada, en el mismo orden que los tokens de entrada — ningún call site cambió.
- **Los dos sends de SIAT se migraron al helper.** Llamaban al SDK directo, así que
  ponerlo solo en el helper no los habría acotado. Ahora los siete multicast pasan por ahí.
- Borrado por lista blanca: `_PERMANENT_FAILURE_TYPES = {"UnregisteredError"}`. Un tipo de
  error desconocido ya no borra nada.

9 pruebas nuevas en `notifications/tests/test_multicast.py`; 235 pasan.

### ~~G. `contacts_refresh` en iOS~~ ✅ **HECHO (17/08)** — columna `platform` (15/08) + split del send

`send_contacts_refresh_push` mandaba **un solo** mensaje con bloque `notification`. En
Android el canal `contacts_refresh_silent` lo esconde; **iOS no tiene canales**, así que
ahí un bloque `notification` *es* una alerta: el usuario habría visto un **banner en
blanco** cada vez que se refrescaban sus contactos.

No se podía arreglar en un mensaje porque los payloads correctos son incompatibles:
Android **exige** el bloque `notification` (el canal es lo que lo silencia) y iOS exige su
**ausencia**, con `content-available` y `apns-push-type: background`. Por eso el
prerrequisito era la columna `platform`, que se adelantó el 15/08 — su ventana se cerraba
con el primer build de iOS, porque un registration token de FCM es opaco e idéntico entre
plataformas y después ya no hay cómo clasificar las filas viejas.

**Arreglo:** `get_tokens_by_platform()` agrupa y se mandan dos mensajes. Verificado
serializando el payload real del SDK (`encode_message`, fuera de pytest):

- **Android queda idéntico** a como estaba — mismo bloque `notification`, mismo canal.
- **iOS** recibe `{"aps":{"content-available":1}}`, sin `alert` ni `notification`, con
  `apns-priority: 5` (Apple **rechaza** los background push con prioridad 10).
- Un fallo de un lado no cancela el otro: el refresh es comodidad, no alerta.

`platform IS NULL` cuenta como android y **eso no caduca cuando salga iOS**: un NULL solo
lo deja un build anterior a la columna, y como iOS nunca se publicó, no existen builds
viejos de iOS. Se loguean para que la suposición sea observable y no silenciosa.

9 pruebas en `notifications/tests/test_contacts_refresh.py`; 244 pasan.

### H. Unificar ambas plataformas en RNFB — **DIFERIDO (15/08)**

Decisión del 15/08: se ship a iOS con el split (`react-native.config.js`) y la migración
se hace como PR aparte. Un agente de research auditó la decisión; lo que encontró:

- **Borrar `react-native.config.js` NO es toda la migración.** Al linkear messaging en
  Android chocan `com.google.firebase.messaging.default_notification_color`, que declaran
  tanto el plugin de expo-notifications como el manifest de RNFB, sin `tools:replace`
  ([invertase/react-native-firebase#8165](https://github.com/invertase/react-native-firebase/issues/8165)).
  El fix propio de RNFB se salta porque guarda con `!hasMetaData(...)`. **El build de
  Android truena.**
- **Sospecha sin verificar: el tap en Android ya está roto hoy.** Con payload
  `notification`+`data` y la app en background, Firebase la despliega solo y su content
  intent va al launcher — el `PendingIntent` de expo nunca se adjunta, así que
  `getLastNotificationResponseAsync()` regresaría null y `_layout.tsx:360-380` sería
  código muerto en Android. `getInitialNotification()` de RNFB lo arreglaría. **Verificar
  con 5 min en el Pixel** (mandar push → background → tap → ¿navega a la pantalla correcta
  o solo abre la app?) antes de dimensionar el PR.
- **La raíz es la forma del payload.** Mandar data-only desde el backend le devolvería a
  expo-notifications el control del display y del tap en Android (~10 líneas de backend).
  Es una tercera opción que ninguna de las dos rutas consideró.

### ~~F. Borrado de cuenta (Guideline 5.1.1(v))~~ ✅ **HECHO (17/08)** — `2b98048` + `aa30973`

Backend: la fila de `users` se borra **primero** y Firebase después. El orden importa —
si Firebase falla, el usuario vuelve a entrar y se le crea perfil nuevo (recuperable, y
**ya no quedan push tokens**). Al revés, un fallo de DB deja una cuenta que no puede
entrar pero **sigue recibiendo alertas de huracán**: justo lo que prohíbe 5.1.1(v).

Cliente: los tres problemas de `AuthContext.tsx` resueltos (`authFetch`, `API_BASE_URL`,
`/api/v1/users/me`). Y `SettingsScreen.handleDeleteAccount` ahora limpia AsyncStorage
(`clearOnboardingData` + `resetAllTours`): `@blueye_onboarding` guardaba **nombre,
teléfono, dirección, CP, rango de edad y nivel de ansiedad** y sobrevivía a un borrado
que la UI anuncia como "permanente". El backend no puede tocar AsyncStorage.

**Mina encontrada de paso:** `sos_events.sender_id` estaba declarado sin regla de
borrado → el default de Postgres es `NO ACTION`, así que borrar a cualquier usuario que
alguna vez mandó un SOS fallaba con violación de FK. Pasaba la prueba manual porque una
cuenta recién creada no tiene historial. Convertido a `ON DELETE CASCADE` con un bloque
`DO $$` autodesactivable (`confdeltype <> 'c'`) en `ensure_core_tables`.

Probado de verdad, no inferido:
- `app/features/users/tests/test_delete_cascade.py` — borra un usuario **con historial en
  todas las tablas que lo referencian** y verifica además que los datos de OTRO usuario
  sobreviven intactos (un CASCADE de más es tan grave como uno de menos). Corre en CI.
- En el **Simulator** (17/08, backend local, cuenta de Google): `DELETE 200` → fila vieja
  destruida, fila nueva `id 1215` con 0 `device_tokens` / 0 `sos_contacts` / 0 `sos_events`.
  El Simulator es válido para esto: el borrado no toca APNs ni entitlements. **Falta
  repetirlo con Sign in with Apple**, que es donde aparece P2.

### G. Upload R8 file to make the app lighter for users and facilitate revision by GooglePlay — **DIFERIDO**
It refers to the alert/advice that appears whenever sending a new update to the playstore. - Optimization


---

## Post-release — encontrado durante el release, NO bloquea el envío

> Ninguno de estos impide subir a App Store. Se documentan aquí para no perderlos.

### P1. El gate de onboarding usa un proxy roto (`display_name`)

`app/_layout.tsx:178-195`: si AsyncStorage está vacío, el gate le pregunta al backend
"¿este usuario tiene `display_name`?" y si sí, marca el onboarding como completado.

Pero `users/router.py:28` llena `display_name` con el claim `name` del token de Firebase
en el **primer** `POST /api/v1/users/me` — la llamada que *crea* la cuenta. Con Google
sign-in ese claim siempre viene, así que el campo existe segundos después del registro,
antes de que el usuario vea una sola pantalla de onboarding.

**Efecto: cualquier usuario de Google se salta el onboarding en una instalación limpia.**
Medido en la DB de staging (17/08): 14 usuarios con `display_name`, solo **4 con `phone`**.

Una bandera de "completado" tiene que escribirla el paso que dice medir. Hoy nada del
lado servidor registra que el onboarding pasó: `submitOnboarding`
(`app/onboarding/_context/OnboardingContext.tsx:36`) solo escribe AsyncStorage, y el
único rastro remoto es `phone` — que es **opcional** (`phone?: string` en `_types.ts`) y
se manda fire-and-forget con `.catch(() => {})`, o sea que un fallo se traga en silencio.

Arreglo correcto: columna `onboarding_completed BOOLEAN` vía `ALTER TABLE ... ADD COLUMN
IF NOT EXISTS` en `ensure_core_tables` (no hay Alembic), escrita por `submitOnboarding`.
~30 líneas. Preexistente a esta rama.

### P2. No se revoca el token de Apple al borrar la cuenta

Desde el 30/06/2022 Apple exige que una app con Sign in with Apple **revoque el token**
del usuario al borrar la cuenta, no solo que borre la cuenta local. `auth.delete_user()`
de `firebase_admin` borra el usuario de Firebase pero **no toca el lado de Apple**: el
Apple ID sigue listando la app en "Apps que usan tu Apple ID".

No hay nada de revocación en el repo (verificado 17/08: los únicos `revoke` son de
`sos_invitations`). `app.json` tiene `usesAppleSignIn: true`, así que aplica.

Trampa: la revocación necesita el `authorizationCode` que devuelve
`AppleAuthentication.signInAsync()`, y `AuthContext.tsx` hoy lo **descarta**. Hay que
guardarlo al iniciar sesión — después no se puede recuperar.

**Falta verificar** qué ofrece Firebase hoy del lado servidor antes de implementar a mano.
Es causal de rechazo documentada bajo la misma 5.1.1(v), así que conviene cerrarlo pronto
aunque no bloquee el primer envío.

### P3. El build number se maneja a mano (`appVersionSource: "local"`)

`eas.json` declara `cli.appVersionSource: "local"` y **ningún perfil trae
`autoIncrement`**. O sea que `ios.buildNumber` (`app.json:30`, hoy `"15"`) es un número
que una persona escribe a mano antes de cada build.

Cómo falla: si ese número ya se subió a App Store Connect para la misma `version`, el
upload muere con `ITMS-4238: Redundant Binary Upload` (en Android es lo mismo con
`versionCode`). Falla en el **upload, no en el build**, y es **ruidoso** — no es rechazo
de review y no toca el expediente de la submission. Cuesta un ciclo de build (~30-45 min).

Por qué duele justo ahora: `buildNumber` **no existía en `app.json`** antes de `d2a3524`
(14/08), así que los tres builds de iOS del 21/05/2026 tomaron algún número que el repo
nunca registró. El punto de partida no se puede reconstruir desde aquí — sale de
`eas build:list --platform ios` o de ASC.

**Dos pasos, y el orden importa:**

1. ~~**Antes del primer build.**~~ ✅ **RESUELTO 18/08** por TestFlight: el único upload
   de la app es `1.8.0 (1)`. Como `1.9.0` no tiene ninguno, `buildNumber: "15"` está libre
   y **no se toca**. (`autoIncrement` no habría resuelto esto de todos modos: incrementa
   15 → 16, y si 16 también estuviera usado, vuelve a chocar.)
2. **Después del release.** Migrar a `cli.appVersionSource: "remote"` + `autoIncrement:
   true` en el perfil de producción.

**Por qué `remote` y no `local` + `autoIncrement`.** Los dos incrementan solos, pero en
`local` el CLI **reescribe `app.json` en disco** antes de cada build
(`syncProjectConfigurationAsync` → `bumpVersionAsync`), así que el número solo sobrevive
si alguien commitea ese cambio. Si no se commitea, el siguiente build relee el valor viejo
y el bug regresa — o sea que `local` cambia "acordarse del número" por "acordarse de
commitear", que falla igual. En `remote` el número vive en el servidor de EAS, `app.json`
no se toca y no hay nada que commitear.

Notas del mecanismo (verificadas contra el fuente del CLI, no de memoria):

- **Un solo flag cubre las dos plataformas** — `ios.buildNumber` y `android.versionCode`.
- **La versión de marketing nunca se auto-incrementa.** `version: "1.9.0"` se sigue
  editando a mano; el CLI siempre pasa `storeVersion` desde local.

**Por qué se difiere:** cambiar `appVersionSource` obliga a inicializar la versión remota,
y el día del release es mal día para descubrir los casos borde de esa inicialización
(`eas build:version:set` existe justo para eso). El paso 1 no depende del paso 2.

---

### P4. La tab bar se queda inerte de vez en cuando (iPhone físico) — sin repro

**19/08, dev build, iPhone SE físico.** La tab bar se dibuja normal pero no recibe
toques: **todos** los tabs, **cero** feedback de press. El resto de la pantalla (mapa,
SOS, reportar) responde bien, así que no es un freeze.

- **No es del tour.** Diego ya lo había visto antes de los cambios del tutorial, y al
  re-correr el tour después del reinicio no volvió a pasar.
- **Se limpia con force-quit + relanzar.** No se reprodujo en ~4 intentos posteriores,
  incluyendo sign out / sign in con Google.
- **Solo en dispositivo físico.** El Simulator de iOS nunca lo hace — que es justo por
  qué nadie lo había cachado (ver "El Simulator no firma nada — y por eso engaña").

Sin repro determinista no hay nada que arreglar, y no bloquea el envío. **Si vuelve:**
anotar si el tour corrió en ese arranque y si hubo un reload de Metro antes — son las
dos variables que no se pudieron descartar.

---

### ~~P5. El dedup de push token no lleva el uid~~ ✅ **HECHO (19/08)**

Cambiar de cuenta en el mismo dispositivo dejaba el push mudo. **Verificado 19/08** contra
staging con el dev build, y arreglado antes del build de producción.

**Qué pasaba.** `sendTokenToBackend` comparaba `stored === fcmToken` contra AsyncStorage
(`_LAST_TOKEN_KEY`). Un token de FCM es del **dispositivo**, no del usuario: al
cerrar sesión y entrar con otra cuenta el token es idéntico, el guard matchea y **el POST
nunca sale**. Peor: devuelve `{ ok: true }`, así que se imprime `registration finished` y
toda la telemetría reporta éxito. Falla en silencio y en positivo.

**El backend ya está bien** — `notifications/service.py:215-221` hace
`INSERT ... ON CONFLICT (token) DO UPDATE SET user_id = :user_id`. Si el POST llegara, la
fila se reasignaría sola. El bug es 100% del cliente.

Evidencia:

- Sign-in Google 19:35 local → `token registered with backend` + `POST /api/v1/push-token
  201` en los logs HTTP de Railway (staging).
- Sign-in Apple ~20:05 local → `token already registered — skipping POST`. **Cero** POSTs
  a `/api/v1/push-token` entre 20:02 y 20:13 local.
- El user de Apple (`psr0MWNFmBUUeCWYGfzG…`) quedó sin ninguna fila en `device_tokens`.

**No bloquea el envío:** el revisor instala de cero, AsyncStorage está vacío y el POST sí
sale. Solo afecta cambiar de cuenta en el mismo dispositivo — incluido borrar cuenta y
volver a entrar, que sí es un flujo real y deja al usuario sin alertas sin avisarle.

**Fix aplicado (solo cliente):** `sendTokenToBackend` arma `dedupeKey = ${uid}:${token}` y
lo usa tanto en el guard en memoria (`_registrationInFlight`) como en el de AsyncStorage
(`_LAST_TOKEN_KEY`). El uid se lee **antes del primer await** — `currentUser` puede cambiar
mientras corren los reintentos, y el dedup tiene que hablar del usuario que motivó ese
registro. Sin sesión cae a `anon`, que es un valor distinto de cualquier uid real, así que
el primer registro autenticado sí sale.

**Por qué era barato hacerlo el día del release:** si la llave nueva se equivoca, el peor
caso es un POST de más — y ese POST es idempotente en el backend (`ON CONFLICT`). El
downside de un bug aquí es ruido, no una cuenta muda.

---

## Falta en App Store Connect (Diego) — **bloquea el envío**

No es código, pero sin esto la review se rechaza:

1. ~~**Cuenta demo para App Review.**~~ ⚠️ **REPLANTEADO 19/08 — no se crea ninguna cuenta.**
   `AuthContext.tsx` solo expone `signInWithGoogle` y `signInWithApple`: **la app no tiene
   formulario de usuario/contraseña**, así que los campos de demo account de ASC no tienen
   dónde escribirse. Peor, llenarlos sería contraproducente:

   - **Apple sign-in no acepta credenciales tecleadas.** La hoja está atada al Apple ID del
     dispositivo; el revisor tendría que loguear el equipo de review con nuestra cuenta, y
     el 2FA manda el código a *nuestros* dispositivos.
   - **Google casi seguro lanzaría un challenge** ("verifica que eres tú") desde un
     dispositivo/IP/país nuevos → el revisor se atora → **rechazo por Guideline 2.1**.
   - `blueyehurricanealerts@gmail.com` es **admin de App Store Connect**. Su password no se
     comparte con nadie, y menos por un campo de texto.

   **Qué se hace en su lugar:** el revisor entra con **su propio Apple ID** vía Sign in with
   Apple — que es justo para lo que Apple obliga a implementarlo. Se marca *Sign-In
   Required* y la instrucción real va en **Notes**. Si ASC no deja los campos de
   usuario/password vacíos, poner `N/A — use Sign in with Apple` y que Notes cargue el
   significado.

   > Sign in with Apple **verificado en dispositivo el 19/08** (usuario Firebase
   > `4jhjsv78nj@privaterelay.appleid.com`, provider Apple). Como no hay fallback de
   > email/password, que funcione es **la puerta de entrada del revisor** — si se rompe, no
   > hay otra forma de entrar.

> **Agreements/Tax/Banking NO se heredan de Play Store.** Son contratos aparte con Apple;
> nada se transfiere. Como no hay librerías de IAP en `package.json`, basta con el
> *free-app agreement* aceptado por el Account Holder — sin datos bancarios.

---

## Bloqueado en Ivan (Account Holder)

> **APNs Auth Key `.p8` — resuelto 14/08.** Ver "Ya hecho". Quedan tres.

Mandar **todo junto**, no de uno en uno:

1. ~~**Estado de Agreements, Tax and Banking.**~~ ✅ **RESUELTO 18/08** — ver "Estado App
   Store Connect". El agreement pendiente sí existía y sí bloqueaba el submission.
2. ~~**Capabilities** en el App ID `com.bluai.app`~~ ✅ **YA ESTABAN (verificado 18/08).**
   Push Notifications y Sign in with Apple aparecieron palomeadas. Nunca fue un bloqueador
   real; solo nadie había vuelto a mirar.
3. **"Access to Certificates, Identifiers & Profiles"** — ❗ **Reclasificado 18/08: no se
   puede otorgar.** La cuenta es *Individual*, y ahí los usuarios de ASC no son miembros del
   Developer Program. Nunca va a haber portal para `blueyehurricanealerts@gmail.com`. Todo
   lo del App ID y las credenciales de EAS sale de la sesión del Account Holder, o de una
   App Store Connect API Key generada desde ella. Ver "Estado App Store Connect".
   https://developer.apple.com/help/account/access/roles/

  Search that page for organization's team — the footnote is on the "Manage access to Certificates, Identifiers & Profiles" row. The individual-enrollment note is further down under "Permissions in App Store Connect."

> **Sección cerrada el 18/08.** Los tres puntos resueltos: 1 era real, 2 ya estaba hecho,
> 3 era un mal diagnóstico. **Ya no queda nada bloqueado en el Account Holder.**

---

## Gotchas — las cosas que fallan en silencio

### `@react-native-firebase/messaging` va pineado exacto

`messaging@24.0.0` declara `peerDependencies: { "@react-native-firebase/app": "24.0.0" }`
— pin exacto, no rango. Pero `package.json:16-17` declara `app` y `auth` con **caret**
(`^24.0.0`). La versión resuelta hoy es `24.0.0`; el *rango* no lo garantiza mañana.

**El problema:** los tres perfiles de `eas.json` traen `NPM_CONFIG_LEGACY_PEER_DEPS: "1"`,
que le dice a npm que ignore conflictos de peers. Un par desalineado **no truena al
instalar ni al buildear** — truena en runtime, en un dispositivo, sin señal en compilación.

→ Instalar con `--save-exact` **y re-pinear los tres**. Nunca con caret.

### Un `Platform.OS` no protege el autolinking

Agregar una dependencia nativa cambia el merge del `AndroidManifest.xml` de **todas** las
plataformas que el paquete soporta — antes de que exista cualquier branch de JS.

`expo-notifications` declara su `ExpoFirebaseMessagingService` (y su receiver) con
`android:priority="-1"` **a propósito**: si hay otro servicio FCM en la app, cede. Android
resuelve un solo servicio para `com.google.firebase.MESSAGING_EVENT` (best match gana), así
que RNFB con prioridad ≥ 0 convertiría el de expo en código muerto — **en la plataforma que
hoy sí está en producción**.

Superficie real del daño: **recepción en primer plano en Android**
(`_layout.tsx:289`, `pushNotifications.ts:329`). El fondo se salva solo, porque el backend
manda payload `notification` y el SDK de FCM lo despliega sin invocar ningún servicio.

→ La pregunta "¿qué exporta este paquete?" y "¿qué declara en su manifest?" son distintas,
y solo una se ve en el editor.

### Firebase tiene **dos** slots de auth key, no uno

`Cloud Messaging → Apple app configuration` tiene fila de Development y fila de Production.
Firebase no lee el nombre que le pusiste a la key en Apple — etiqueta el **slot**, no el
archivo. Elige el key según el entorno del *device token*.

Dejar Production vacío falla **idéntico** a un `aps-environment` mal puesto: en dev client
funciona, en TestFlight Firebase no encuentra con qué firmar y devuelve un error de auth
genérico... que `notifications/service.py:92` interpreta borrando el token. La evidencia se
borra sola.

→ Son **dos switches independientes** (entitlement y slot) que default a "development" y
que solo se notan en TestFlight. Por eso la SACRED RULE.

### El nombre de la key no lo valida nadie

"Bluai Sandbox" / "Bluai production" son etiquetas que escribió una persona. Las auth keys
no tienen entorno: intercambiarlas funcionaría igual, sin error en ningún lado.

Solo importa en **una** operación: Apple topa en 2 keys activas por team, así que rotar
obliga a revocar primero. Antes de revocar, leer el Key ID del slot de Firebase — nunca
confiar en el nombre.

### `aps-environment`: push que sirve en tu escritorio y está muerto en producción

El entitlement decide con qué gateway de Apple habla la app: `development` → **sandbox**;
`production` → el gateway real. Son sistemas separados, con tokens separados. Un token
de sandbox no significa nada para producción.

**Resuelto con una línea, y por una razón que vale la pena entender** (`32f011f`):

```json
["expo-notifications", { "mode": "production" }]
```

El plugin escribe el entitlement **solo si nadie más lo puso**
(`withNotificationsIOS.ts`: `if (!config.modResults['aps-environment'])`). Y el base mod
lee el archivo de entitlements que ya exista antes de correr los plugins
(`withIosBaseMods.js:359-362`). O sea que el switch por entorno sale gratis:

| Camino | Entitlements de entrada | Resultado |
|---|---|---|
| **EAS** (`ios/` está gitignored → no llega) | template `{}` | escribe `production` ✅ |
| **Local `expo run:ios`** | lee `ios/Bluai/Bluai.entitlements` con `development` | **no lo pisa** ✅ |

Los dos caminos se probaron corriendo prebuild, no se dedujeron. **No hizo falta
`app.config.js`** — y eso importa: un `app.config.js` cambia cómo se resuelve la config de
**las dos** plataformas, así que un spread mal hecho tira `android.permissions` o las keys
de maps. La prop `mode` no aparece ni una vez en `withNotificationsAndroid.ts`.

**Footgun:** `npx expo prebuild --clean` en local borra `ios/` → regeneras con
`production` contra un perfil de desarrollo → falla el codesign. Ruidoso, no silencioso.
Si el equipo empieza a usar `--clean` de rutina, ahí sí toca `app.config.js`.

→ La prueba de entrega igual tiene que ser en **TestFlight**, no en dev client: el slot de
Firebase es un switch independiente del entitlement.

### `registerDeviceForRemoteMessages()` no garantiza que haya token de APNs

Hace corto circuito cuando `isRegisteredForRemoteNotifications` ya es `true`, y **esa
bandera persiste entre lanzamientos**. O sea: en el primer arranque el `await` sí espera;
en todos los demás resuelve de inmediato, antes de que dispare
`didRegisterForRemoteNotificationsWithDeviceToken` — que es el único lugar donde se llama
`setAPNSToken:`. `getToken()` corre entonces con token de APNs en nil.

Falla en el camino común (warm start), no en un caso raro.

→ Poll de `getAPNSToken()` hasta no-null con timeout, y el timeout reportado como
`apns-token-timeout`. Si el SDK ya esperaba solo, el poll sale en la primera iteración y
no cuesta nada.

### expo-notifications **no** encadena el delegate de iOS — se rinde

RNFB encadena (guarda `_originalDelegate`). expo-notifications **no**: si ya hay un
delegate puesto, loguea y se sale sin instalarse
(`NotificationCenterManager.swift:50-60`). O sea que el orden decide:

- expo primero → RNFB lo captura → **los dos sirven**
- RNFB primero → **toda la capa de notificaciones de expo en iOS queda muerta, en silencio**

El orden *debería* favorecer a expo, pero no está verificado en device y **aplica igual
con split o unificado**.

→ En el primer build de iOS, buscar en consola:
`[expo-notifications] NotificationCenterManager encountered already present delegate`.
Si sale, el push de iOS está roto sin importar todo lo demás.

### `ios/` se corrompe en silencio y solo te pasa a ti

`ios/Bluai/SplashScreen.storyboard` estaba en **0 bytes** (15/08). Eso tronaba
`expo prebuild` y `expo config --type introspect` con un error de splash que no dice nada
del splash. Se arregla borrando el archivo y dejando que prebuild lo regenere.

Por qué nadie más lo ve: `ios/` está gitignored, EAS lo genera desde template en cada
build. O sea que es un directorio mutable, sin versionar y sin revisar, que **solo existe
en la máquina que hace pruebas en device** — justo la que más lo necesita. Los builds en
la nube siguen pasando.

→ En directorios generados: borrar antes que debuggear. Regenerar es gratis.

### El oráculo de una línea para saber si Fase 2 funcionó

`redactToken()` imprime prefijo + longitud. En el primer log de un build de iOS, mirar la
**clase de caracteres** antes que la longitud:

- `/^[0-9a-f]+$/` y `…(64)` → sigue siendo el token crudo de APNs → **no está arreglado**
- mayúsculas/minúsculas mezcladas con `:` o `-`, `…(140+)` → registration token de FCM → **sí**

La longitud sola es una prueba negativa ("no es 64"); la clase de caracteres es positiva.
No hace falta mandar ningún push para saberlo.

### El Simulator no firma nada — y por eso engaña

`npx expo run:ios` (Simulator) **no requiere certificado**: las builds de Simulator van sin
firmar. `npx expo run:ios --device` sí, y ahí sale `CommandError: No code signing
certificates are available to use`.

O sea que se puede llevar semanas "probando en iOS" sin haber firmado nunca nada, y sin
poder probar **push, entitlements ni `aps-environment`** — que es justo lo que falta.

**Cómo saber en cuál estás corriendo, desde los logs del backend:** el Simulator comparte
la pila de red del Mac, así que sus requests salen con la IP **del Mac**. Un iPhone físico
tiene su propia IP por DHCP. Si `ipconfig getifaddr en0` es igual a la IP del cliente en
los logs de uvicorn, estás en el Simulator.

Diagnóstico rápido del keychain: `security find-identity -v -p codesigning`.
`0 valid identities found` = no hay con qué firmar (estado al 17/08).

### `frontend/ios/` es artefacto, no fuente

Está en `.gitignore` y lo genera prebuild (CNG). El `Info.plist` que ves en disco
describe la config de *cuando corrió prebuild la última vez*, no la de hoy.

- La pregunta es `app.json`; `ios/` es una respuesta cacheada.
- Para ver qué produciría la config **sin generar nada**: `npx expo config --type introspect`.

## Evidencia — lo que ya está probado (no volver a dudarlo)

**Tres builds de iOS terminaron OK el 21/05/2026** (`eas build:list --platform ios`),
un mes después de que executorch entrara al repo (04/04/2026) y de que `initExecutorch`
llegara a `_layout.tsx` (21/04/2026). El commit `2cff22a` traía el **mismo**
`expo-build-properties` que hoy: `useFrameworks: "static"` + `forceStaticLinking`.

Por lo tanto, y contra lo que dice el README de executorch (`* iOS 17.0`):

- ✅ Compila y linkea con `deploymentTarget` en 15.1 — **no hace falta subirlo a 17.0**
- ✅ `initExecutorch()` corre en iOS sin tronar
- ✅ `useLLM({ preventLoad: true })` corre en cada render sin tronar
- ✅ `useFrameworks: "static"` + el xcframework vendored de executorch conviven

**Lo que esa evidencia NO cubre:** descargar el `.pte`, cargarlo a RAM y correr
inferencia. Nadie hizo opt-in, así que `preventLoad` siempre fue `true`. Por eso ocultar
el botón en Ajustes es la solución correcta y no un parche: garantiza que ese camino
siga sin ejecutarse.

**Consecuencia útil:** hay una baseline sana del toolchain de iOS. Si el build de Fase 2
falla, es culpa de Fase 2 — no de algo preexistente.

---

## Orden sugerido

```
~~A~~ → ~~D~~ → ~~C~~ → ~~B~~ → ~~F~~ → ~~E~~ → ~~G~~ → **entrega de push en device iOS**
   |  bloqueado en Ivan: certificados (ningún build a device sin eso)
   |  después del release: P2, P1, H
```

**Toda la cadena de código de push está hecha. Nada de eso se ha corrido en un iPhone.**
F (borrado de cuenta) ya se validó en device el 17/08 y no depende del push.

**El siguiente paso no es código, es recibir un push en el iPhone.** Tres cosas se validan
de un solo build, y las tres pueden invalidar trabajo ya hecho:

1. La clase de caracteres del token (¿FCM o hex de APNs?) — ver el oráculo arriba
2. El log del delegate de expo-notifications — ver Gotchas
3. Que el poll de `getAPNSToken()` salga en la primera iteración en warm start

B ya está escrito, pero el handler de primer plano **sigue sin probarse**: no se puede
sin un push que llegue de verdad.

**Diferidos, en orden de valor:** P2 (revocar token de Apple — misma guideline que F, y
es el único que queda sin bloqueo de Ivan), P1 (gate de onboarding — afecta a todo usuario
de Google), P3 (`appVersionSource: "remote"` — quita el build number de las manos de una
persona), H (unificar en RNFB — arregla el tap en Android).

### Los tres tipos de bloqueador (no confundirlos)

| Tipo | Cuáles | Quién lo detecta |
|---|---|---|
| Bloquean una app que **sirva** | A, D, C, B | **Nadie.** El build compila, instala y corre con el push muerto |
| Bloquean la **aprobación** | F (Guideline 5.1.1(v)) | Un humano en review |
| Bloquean la **subida** | Privacy policy URL, Agreements/Tax/Banking, App Privacy, screenshots | App Store Connect |

Solo F lo obliga alguien externo. Por eso A–D necesitan la SACRED RULE: la App Store
aprueba sin problema una app cuya función principal no hace nada en silencio.


## Lista de cosas para appstore connect

Aviso de privacidad: https://www.bluai.com.mx/aviso-de-privacidad


## Suggested order for deployment

1. ~~**Apple consoles**~~ ✅ **CERRADO 18/08.** Agreements aceptados, capabilities ya
   estaban, Team Key existe, disponibilidad solo-México. Queda **una** verificación de 30s:
   que los dos slots de APNs en Firebase (dev `7MTNJ97RXH` / prod `2R524J3M7P`) sigan
   poblados — un slot de Production vacío falla **idéntico** a un `aps-environment` malo y
   solo se nota en TestFlight (ver Gotchas).
2. ~~**Build number**~~ ✅ **Verificado 18/08.** TestFlight solo tiene `1.8.0 (1)`; como
   `1.9.0` no tiene uploads, `buildNumber: "15"` está libre. Nada que cambiar.
3. ~~**`onTokenRefresh`**~~ ✅ **HECHO 18/08.** `subscribeToTokenRefresh()` en
   `pushNotifications.ts:339`, consumido en `_layout.tsx:155`. Android sin cambio de
   comportamiento. Ver **A**.
4. `eas build --platform ios --profile production`
   EAS va a ofrecer configurar un `channel` de EAS Update (hay `updates.url` en `app.json`
   y ningún perfil declara channel). **Declinar** — es un prompt, no un fallo.
5. **Mientras buildea** (lo único paralelizable): cuenta demo para App Review, screenshots,
   App Privacy, URL de privacidad, age rating, categoría, descripción, keywords, support URL.
6. **TestFlight** → mandar un push real → verificar la clase de caracteres del token según
   el oráculo de los Gotchas. **SACRED RULE**: hasta aquí no está probado nada.
7. Submit.

**Ya hecho (18/08):** `submit.production.ios.appleTeamId` (`M5CJDZ3897`) en `eas.json`;
`app.json` icon → `./assets/Icon.png` (el único archivo trackeado es con mayúscula, y
resolvía solo por el filesystem case-insensitive de macOS); `.env`, `dist`, `.expo`,
`.tamagui`, `.wrangler` agregados a `.easignore` (existiendo `.easignore`, EAS deja de
respetar `.gitignore` y subía el `.env` local al contexto de build).

**Deliberadamente NO se tocó:** `autoIncrement` y `appVersionSource` (→ **P3**) y el
`channel` de EAS Update (cambia el comportamiento de OTA el día del release).

Sobre `appleId` en el bloque de submit: **no se agrega, y ya se sabe por qué.** El submit
autentica con la ASC API Key guardada en EAS y **nunca pregunta por un Apple ID** — ver
"Build + submit — cómo autentica cada uno".