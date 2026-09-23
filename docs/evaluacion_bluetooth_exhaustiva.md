# Evaluacion exhaustiva de Bluetooth en la app base

Fecha de revision: 6 de agosto de 2026

## Objetivo

Revisar exclusivamente el estado de Bluetooth en la aplicacion base de BluEye y responder si el feature puede considerarse completo o si sigue parcial.

Esta evaluacion se hizo contra el codigo actual del repositorio, diferenciando entre:

- lo que ya funciona hoy
- lo que esta preparado pero no terminado
- lo que el spec espera para mesh y aun no aparece implementado

## Resumen ejecutivo

Conclusion corta: Bluetooth no esta en cero y tampoco es solo mockup. La app base ya tiene una implementacion real de chat offline local entre dispositivos Android. Sin embargo, esa implementacion corresponde principalmente a un flujo 1 a 1, no a un Bluetooth mesh completo multi-salto.

Semaforo recomendado:

- Bluetooth actual en app base: NARANJA

Lectura corta:

- Si la pregunta es "hay Bluetooth real funcionando", la respuesta es si.
- Si la pregunta es "ya esta completo el alcance mesh mejorado", la respuesta es no.

## 1. Que existe hoy en codigo

### 1.1 Flujo visible en la aplicacion

La app ya tiene una seccion de `Chat offline` accesible desde la interfaz.

Evidencia:

- `frontend/app/(tabs)/MoreScreen.tsx`
- `frontend/app/local-chat/index.tsx`
- `frontend/app/local-chat/chat.tsx`

Esto significa que Bluetooth no es una idea futura solamente; existe una entrada real de producto.

### 1.2 Provider central del feature

El centro del flujo esta en:

- `frontend/app/local-chat/_context/LocalChatProvider.tsx`

Este archivo ya resuelve piezas importantes:

- identidad local persistida por dispositivo
- nickname editable
- peers detectados
- estado de advertising, discovery y connecting
- conexion activa
- conversaciones persistidas localmente
- envio y recepcion de mensajes
- limpieza de conversacion
- logs tecnicos para diagnostico

Esto es una señal fuerte de que la base funcional no esta improvisada.

### 1.3 Transporte abstracto y preparado para crecer

La interfaz de transporte esta en:

- `frontend/app/local-chat/_services/transport.ts`

La definicion ya esta pensada para:

- `startAdvertising`
- `startDiscovery`
- `requestConnection`
- `send(endpointId, raw)`
- `disconnect`
- `subscribe(...)`

Arquitectonicamente esto esta bien planteado, porque separa UI, provider y capa nativa.

### 1.4 Implementacion Android real

La implementacion Android vive en:

- `frontend/app/local-chat/_services/NearbyTransport.android.ts`
- `frontend/plugins/with-nearby-connections.js`

El plugin genera un modulo nativo Kotlin que usa Google Nearby Connections. No es simulacion.

Capacidades reales detectadas:

- iniciar advertising
- iniciar discovery
- solicitar conexion
- aceptar conexion
- recibir eventos de peers
- recibir mensajes
- desconectar

### 1.5 Permisos y configuracion nativa

La app ya declara permisos y plugin para Nearby:

- `frontend/app.json`
- `frontend/plugins/with-nearby-connections.js`

Permisos observados:

- `BLUETOOTH_ADVERTISE`
- `BLUETOOTH_CONNECT`
- `BLUETOOTH_SCAN`
- `NEARBY_WIFI_DEVICES`
- `ACCESS_FINE_LOCATION`
- permisos legacy de Bluetooth para Android viejos

Esto refuerza que la base ya fue llevada a nivel dispositivo real.

### 1.6 Persistencia local

La persistencia esta en:

- `frontend/app/local-chat/_services/storage.ts`

Persistencias encontradas:

- `deviceId`
- `nickname`
- conversaciones

Eso permite continuidad entre sesiones, que es un rasgo de feature real y no solo demo.

### 1.7 Protocolo de mensajes

El protocolo esta en:

- `frontend/app/local-chat/_services/protocol.ts`

Ya incluye:

- `id`
- `from`
- `to`
- `ttl`
- `kind`
- `body`

Esto es importante porque muestra que el diseño ya contempla mesh a futuro, aunque eso no significa que mesh ya este cerrado.

## 2. Lo que si puede afirmarse como funcional hoy

Con bastante confianza, de la revision de codigo se puede afirmar que hoy la app base si soporta:

- chat offline local en Android
- deteccion de peers cercanos
- intento de conexion entre dispositivos
- intercambio de mensajes de texto
- almacenamiento local de conversaciones
- actualizacion de nickname
- degradacion limpia en iOS y plataformas no soportadas

En otras palabras:

Bluetooth actual no es rojo.

## 3. Hallazgo central: el feature actual es principalmente 1 a 1

Este es el punto mas importante de la revision.

Aunque varias capas estan "mesh-ready", el comportamiento real actual sigue siendo mayormente de una sola conexion activa o flujo 1 a 1.

### Evidencia tecnica

#### 3.1 El modulo nativo mantiene un solo peer conectado

En el plugin que genera el modulo Kotlin aparece:

- `connectedEndpointId: String? = null`

y el envio actual hace:

- `sendPayload(endpointId, ...)` usando ese unico `connectedEndpointId`

Esto significa que el nativo actual esta construido alrededor de una conexion activa unica.

Archivo:

- `frontend/plugins/with-nearby-connections.js`

#### 3.2 El transport Android ignora el endpoint destino al enviar

En:

- `frontend/app/local-chat/_services/NearbyTransport.android.ts`

la funcion actual es:

- `send(_endpointId, raw)`

y el comentario deja claro que hoy el `endpointId` es implicito porque el modulo nativo solo maneja una conexion.

Eso confirma que el contrato superior esta preparado para multipar, pero la implementacion real aun no llega ahi.

#### 3.3 El propio spec reconoce que falta mesh

El documento:

- `docs/specs_july05/val_sprint_3.md`

describe como trabajo pendiente:

- cambiar de `P2P_POINT_TO_POINT` a `P2P_CLUSTER`
- reemplazar un solo endpoint por un peer map
- soportar varias conexiones simultaneas
- exponer envio dirigido real por endpoint
- crear `meshRouter.ts`
- agregar flooding con TTL, dedup y split horizon
- crear UI de sala mesh
- hacer pruebas con 3 o mas telefonos

Si el spec todavia marca eso como pendiente, no es correcto vender Bluetooth como "totalmente terminado" en su version mesh mejorada.

## 4. Componentes mesh que no encontre implementados

No encontre evidencia de estas piezas terminadas en la app actual:

- `meshRouter.ts`
- cache de deduplicacion de mensajes vistos
- flooding controlado con TTL real entre nodos
- split horizon
- fan-out a multiples peers conectados
- topologia multi-salto A -> B -> C
- UI de sala mesh broadcast
- diferenciacion entre peers directos y peers por salto
- harness o pruebas de simulacion de mesh

Esto no significa que el equipo no lo haya pensado; significa que en el codigo actual revisado aun no se ve cerrado.

## 5. Riesgos y limites observados

### 5.1 Android only

En:

- `frontend/app/local-chat/_services/NearbyTransport.ios.ts`

iOS sigue como placeholder no disponible.

Eso esta bien si el alcance esperado es Android, pero no permitiria marcar Bluetooth como feature cross-platform completo.

### 5.2 Dependencia del modulo nativo generado

La fuente de verdad del modulo nativo no esta en `android/` trackeado sino en:

- `frontend/plugins/with-nearby-connections.js`

Esto es correcto dentro del setup Expo, pero vuelve al feature mas sensible a errores de prebuild y reconstruccion.

### 5.3 No vi evidencia de test automatizado del flujo Bluetooth

No encontre una suite visible de pruebas automatizadas para esta parte del frontend Bluetooth.

Eso no invalida el feature, pero si reduce la confianza para declararlo totalmente cerrado, especialmente en escenarios de:

- churn de peers
- reconexion
- desconexion inesperada
- varios dispositivos al mismo tiempo

### 5.4 El spec de mesh aun se lee como roadmap pendiente

Tanto el roadmap como el spec de julio siguen presentando mesh como trabajo de evolucion y no como cierre consolidado.

Archivos clave:

- `docs/RoadMap.md`
- `docs/specs_july05/sprint.md`
- `docs/specs_july05/val_sprint_3.md`

## 6. Evaluacion de completitud

### Si la pregunta es:

`Existe Bluetooth real en la app base?`

Respuesta:

`Si`

### Si la pregunta es:

`Bluetooth version mejorada ya esta en su totalidad?`

Respuesta:

`No`

### Si la pregunta es:

`Lo actual alcanza para defender que hubo avance serio?`

Respuesta:

`Si`

## 7. Veredicto final

La aplicacion base ya tiene una base funcional real de Bluetooth para chat offline local entre dispositivos Android. Hay arquitectura, UI, persistencia, permisos y modulo nativo. Eso permite afirmar que el feature existe y tiene avance serio.

Pero la misma revision muestra que el alcance mesh multi-salto todavia no aparece completo en el codigo actual. La implementacion vigente sigue centrada en un flujo 1 a 1 con una sola conexion activa, mientras que las piezas criticas de mesh siguen descritas como trabajo pendiente en el spec.

Por eso, la clasificacion mas honesta para Bluetooth en la app base es:

`NARANJA`

No esta en cero. No esta totalmente cerrado.

## 8. Texto corto para tablero

"Bluetooth en la app base si tiene implementacion real y funcional para chat offline local en Android. Ya existen UI, provider, permisos, persistencia y modulo nativo con Nearby Connections. Sin embargo, el alcance mesh multi-salto no se ve cerrado en su totalidad: la implementacion actual sigue siendo principalmente 1 a 1 y el spec aun marca pendientes como multi-peer, mesh router y pruebas de 3 dispositivos. Por eso Bluetooth se recomienda en naranja."
