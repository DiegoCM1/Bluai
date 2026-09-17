# Evaluacion de la app base: Bluetooth, GPS familiar y cobros

Fecha de revision: 6 de agosto de 2026

## Objetivo

Evaluar si la aplicacion base de BluEye ya cubre en su totalidad estos tres frentes:

- Bluetooth
- GPS familiar
- Cobros

La revision se hizo contra el codigo actual del repositorio, separando lo que ya existe de lo que sigue parcial, placeholder o pendiente.

## Resumen ejecutivo

Conclusion general: la app base si tiene avance real en las tres areas, pero no estan completas en su totalidad como paquete integral.

Semaforo recomendado:

- Bluetooth version mejorada: NARANJA
- Cobros sitio web: NARANJA
- GPS membresia familiar ya funciona: ROJO

Lectura corta:

- Bluetooth no esta en cero; ya existe una base funcional.
- Cobros individuales tienen backend y frontend reales.
- GPS familiar no esta resuelto end-to-end.
- La parte familiar dentro de cobros tampoco esta terminada.

## 1. Bluetooth

### Estado

Parcial avanzado. No esta en cero y ya tiene una base funcional real.

### Lo que si existe

- Provider central para chat local offline con manejo de identidad, peers, conversaciones y transporte.
- Solicitud de permisos Android para Bluetooth y ubicacion.
- Integracion de permisos nativos en configuracion/plugin.
- Pantallas y componentes del flujo de chat local.

### Evidencia en codigo

- `frontend/app/local-chat/_context/LocalChatProvider.tsx`
- `frontend/plugins/with-nearby-connections.js`
- `frontend/app/local-chat/_components/StatusHero.tsx`

### Lectura funcional

La aplicacion base ya soporta un flujo real de chat/local connection y por eso no deberia clasificarse como rojo o pendiente total.

### Huecos

- La documentacion del proyecto sigue marcando Bluetooth mesh como pendiente o diferido a `v1.1`.
- No hay evidencia clara de cierre total del alcance mesh multi-salto.

### Evaluacion

`NARANJA`

## 2. Cobros

### Estado

Parcial fuerte o casi completo para suscripcion individual.

### Lo que si existe

- Backend de pagos con planes.
- Endpoint para checkout.
- Endpoint para consulta de suscripcion.
- Webhook para Stripe.
- Webhook para MercadoPago.
- Persistencia de suscripciones en base de datos.
- Pantalla de suscripcion en frontend.
- Seleccion de proveedor de pago en frontend.

### Evidencia en codigo

- `backend/app/features/payments/router.py`
- `backend/app/features/payments/service.py`
- `backend/app/main.py`
- `frontend/app/subscription/index.tsx`
- `frontend/app/subscription/_services/subscriptionService.ts`

### Lectura funcional

La app base si tiene una base real de monetizacion y no solo mockups. El flujo principal para suscripcion individual esta construido.

### Huecos

- La administracion de plan familiar no esta terminada.
- La funcion `getFamilyMembers()` actualmente devuelve vacio.
- La pantalla de manejo familiar muestra texto de "Funcion en desarrollo".

### Evidencia del hueco familiar

- `frontend/app/subscription/_services/subscriptionService.ts`
- `frontend/app/subscription/manage.tsx`

### Evaluacion

`NARANJA`

## 3. GPS familiar

### Estado

Incompleto como feature de producto.

### Lo que si existe

- Captura de ubicacion del usuario.
- Sincronizacion de coordenadas al backend.
- Endpoint backend para actualizar ubicacion propia.
- Uso del GPS dentro del mapa principal.

### Evidencia en codigo

- `frontend/utils/locationSync.ts`
- `frontend/app/map/index.tsx`
- `backend/app/features/users/router.py`
- `backend/app/features/users/service.py`

### Lo que no se encontro

- Relacion real de grupo o familia funcionando end-to-end.
- Listado real de familiares con ubicacion viva.
- Backend de membresia familiar completo.
- Flujo de invitacion, alta y visualizacion familiar cerrado.

### Lectura funcional

La base tecnica de GPS si existe, pero eso no equivale a tener resuelto el feature "geolocalizacion de familiares". Hoy se ve mas como una promesa de plan que como una funcionalidad cerrada.

### Evaluacion

`ROJO`

## 4. Conclusion final

Si la pregunta es si `Bluetooth + GPS familiar + cobros` ya estan en su totalidad dentro de la aplicacion base, la respuesta es:

`No`

La forma correcta de leer el estado actual seria:

- Bluetooth: implementado de forma parcial avanzada
- Cobros: implementados de forma fuerte para single-user
- GPS familiar: incompleto
- Cobros familiares: incompletos

## 5. Texto corto para tablero

Propuesta breve para pegar en hoja o reporte:

"La aplicacion base si muestra avance real en Bluetooth y cobros, pero no estan cerrados al 100%. Bluetooth ya tiene base funcional, cobros individuales ya cuentan con frontend y backend, pero GPS familiar y la parte familiar de membresias siguen incompletos. Por eso Bluetooth y cobros se recomiendan en naranja, y GPS familiar en rojo."
