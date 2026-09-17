# Documentacion completa de cambios de membresia

Fecha del documento: 14 de agosto de 2026
Ultima actualizacion: 15 de agosto de 2026

## 1. Objetivo del cambio

Esta documentacion describe los cambios realizados en el modulo de membresia de BluEye para convertirlo en un flujo funcional y conectado a backend, dejando atras una implementacion que antes estaba mucho mas enfocada en mostrar planes de manera visual.

El objetivo del cambio fue habilitar que la aplicacion:

- consulte la suscripcion real del usuario;
- muestre el plan activo y su estado;
- permita elegir modalidad mensual o anual;
- abra un checkout para contratar planes de pago;
- aplique reglas de acceso segun el plan contratado;
- permita administrar miembros familiares si el plan lo soporta.

## 2. Alcance funcional

El cambio impacta dos bloques principales:

- frontend de suscripcion y administracion familiar;
- backend de pagos, suscripciones y miembros familiares.

Esto quiere decir que no se modifico solo la interfaz, sino tambien:

- integracion con endpoints reales;
- validaciones de negocio;
- control de acceso por plan;
- flujo de compra;
- flujo de alta y baja de miembros familiares.

## 3. Estado anterior

Antes de esta actualizacion, la seccion de membresia se acercaba mas a una presentacion visual de planes que a un modulo transaccional y operativo.

Faltaba resolver correctamente:

- la lectura de la suscripcion activa;
- el estado real de acceso a funciones premium;
- el inicio del checkout conectado a backend;
- la administracion real del plan familiar;
- el control de limites por plan.

## 4. Estado actual despues del cambio

Despues de este cambio, la membresia queda mucho mas cerca de un flujo operativo real dentro de la aplicacion.

Ahora el usuario puede:

- entrar a la pantalla de suscripcion;
- ver el plan que realmente tiene activo;
- ver su periodo de facturacion y fecha de vencimiento cuando existe;
- identificar funciones desbloqueadas y bloqueadas;
- iniciar una compra para planes premium;
- administrar miembros familiares si el plan es compatible.

## 5. Resumen ejecutivo del cambio

En terminos practicos, la membresia ya no depende solamente de texto o diseño. El frontend ahora consulta informacion real del backend y toma decisiones a partir del plan del usuario.

Esto se refleja en tres capacidades nuevas:

- estado real de la suscripcion;
- inicio de compra para planes de pago;
- administracion real de plan familiar.

## 6. Cambios realizados en frontend

### 6.1 Pantalla principal de suscripcion

Archivo principal:

- `frontend/app/subscription/index.tsx`

Cambios implementados:

- Se rediseño la pantalla principal de suscripcion.
- Se agrego carga real de planes desde backend.
- Se agrego carga real de la suscripcion del usuario.
- Se agregaron estados de carga y refresco.
- Se muestra plan activo, periodo y vencimiento.
- Se agrego acceso directo a administracion familiar.
- Se agrego una seccion visual para mostrar funciones activas y bloqueadas.

### 6.2 Selector de facturacion

Archivo principal:

- `frontend/app/subscription/_components/BillingToggle.tsx`

Cambios implementados:

- El usuario puede elegir entre cobro mensual y anual.
- La opcion seleccionada se refleja visualmente.
- Se muestra el ahorro anual cuando existe descuento.
- La seleccion se usa al momento de abrir el checkout.

### 6.3 Tarjetas de planes

Archivo principal:

- `frontend/app/subscription/_components/PlanCard.tsx`

Cambios implementados:

- Se mejoro la presentacion de cada plan.
- Se distinguen planes base y premium.
- Se muestran nombre, descripcion, precio y beneficios.
- Se identifica si el plan ya es el plan actual del usuario.
- Se habilita llamada a accion para contratar cuando corresponde.

### 6.4 Hoja o modal de pago

Archivos relacionados:

- `frontend/app/subscription/_components/StripePaymentSheet.tsx`
- `frontend/app/subscription/_components/PaymentMethodSheet.tsx`

Cambios implementados:

- Se agrego un modal previo al checkout.
- El usuario visualiza el metodo de pago disponible.
- El flujo actual mostrado en app esta orientado a Stripe.
- Se informa que la renovacion y el cobro se resuelven en el proveedor de pago.

### 6.5 Gating de funciones por plan

Archivo principal:

- `frontend/app/subscription/_utils/planAccess.ts`

Cambios implementados:

- Se definieron funciones sujetas a membresia.
- Se agrego logica para evaluar acceso segun plan.
- Se agrego un ranking de planes para resolver permisos.
- Se agrego calculo del maximo de miembros por plan.

Funciones controladas por gating:

- bluetooth offline;
- administracion de membresias;
- ubicacion familiar;
- boton de panico familiar;
- gestion de personal critico;
- dashboard centralizado;
- comunicacion critica;
- modulos educativos.

Reglas principales:

- `free` no desbloquea funciones premium.
- `safe` habilita funciones familiares.
- `guard` habilita funciones familiares y operativas avanzadas.
- `edu` usa reglas especiales para modulos educativos.

Limites familiares:

- `safe`: 3 miembros.
- `guard`: 4 miembros.

### 6.6 Pantalla de administracion familiar

Archivo principal:

- `frontend/app/subscription/manage.tsx`

Cambios implementados:

- La pantalla consulta la suscripcion real.
- Se valida si el plan permite administrar miembros.
- Se obtiene la lista real de miembros desde backend.
- Se permite agregar miembros por correo.
- Se permite eliminar miembros del plan.
- Se muestran errores de sincronizacion y refresco.

### 6.7 Lista de miembros

Archivo principal:

- `frontend/app/subscription/_components/MemberListItem.tsx`

Cambios implementados:

- Se muestra cada miembro con iniciales y color identificador.
- Se muestra distancia aproximada respecto al titular.
- Se agrega accion de eliminar miembro.

### 6.8 Servicio de suscripcion

Archivo principal:

- `frontend/app/subscription/_services/subscriptionService.ts`

Cambios implementados:

- Se agregaron llamadas reales al backend.
- Se agrego mapeo entre respuestas de API y tipos del frontend.
- Se agrego apertura del checkout con `Linking.openURL`.
- Se agrego manejo de errores de respuesta.

Endpoints consumidos por frontend:

- `GET /api/v1/payments/plans`
- `GET /api/v1/payments/subscription`
- `GET /api/v1/payments/family-members`
- `POST /api/v1/payments/family-members`
- `DELETE /api/v1/payments/family-members/{member_user_id}`
- `POST /api/v1/payments/checkout`

### 6.9 Tipos del modulo

Archivo principal:

- `frontend/app/subscription/_types.ts`

Cambios implementados:

- Se tiparon planes.
- Se tiparon suscripciones.
- Se tiparon miembros familiares.
- Se tiparon periodos de cobro y proveedor de pago.

## 7. Cambios realizados en backend

### 7.1 Router de pagos

Archivo principal:

- `backend/app/features/payments/router.py`

Cambios implementados:

- Endpoint para listar planes.
- Endpoint para consultar suscripcion activa.
- Endpoint para consultar miembros familiares.
- Endpoint para agregar miembros familiares.
- Endpoint para eliminar miembros familiares.
- Endpoint para crear checkout.
- Endpoint de simulacion para desarrollo.
- Webhooks para Stripe y Mercado Pago.

### 7.2 Servicio de pagos y membresia

Archivo principal:

- `backend/app/features/payments/service.py`

Cambios implementados:

- Definicion del catalogo de planes.
- Lectura y actualizacion de suscripcion.
- Creacion de sesiones de checkout.
- Listado de miembros familiares.
- Alta de miembro familiar.
- Baja de miembro familiar.
- Calculo de distancia aproximada entre titular y miembros.
- Generacion de color e iniciales para miembros.

### 7.3 Esquemas

Archivo principal:

- `backend/app/features/payments/schemas.py`

Cambios implementados:

- Se tiparon respuestas de planes.
- Se tiparon respuestas de suscripcion.
- Se tiparon peticiones de checkout.
- Se tiparon respuestas de miembros familiares.

## 8. Reglas de negocio incorporadas

Esta actualizacion agrega reglas reales de operacion, no solo cambios visuales.

Reglas de administracion familiar:

- el correo del miembro es obligatorio;
- el titular no puede agregarse a si mismo;
- el miembro debe existir como usuario;
- no se permiten duplicados;
- solo un plan activo compatible puede administrar familia;
- se respeta el limite maximo por plan.

Reglas de checkout:

- `free` y `edu` no requieren checkout;
- `safe` y `guard` si pueden abrir checkout;
- el periodo de cobro valido es `monthly` o `annual`.

## 9. Flujo funcional actualizado

### 9.1 Flujo de consulta de suscripcion

1. El usuario abre la pantalla de suscripcion.
2. La app consulta el catalogo de planes.
3. La app consulta la suscripcion activa del usuario.
4. La UI muestra plan actual, vigencia y funciones disponibles.

### 9.2 Flujo de compra

1. El usuario selecciona un plan premium.
2. Elige modalidad mensual o anual.
3. Se abre la hoja de pago.
4. La app solicita una URL de checkout al backend.
5. La app abre la URL en el dispositivo.
6. El pago se completa en Stripe.

### 9.3 Flujo de administracion familiar

1. El usuario entra a administrar membresias.
2. La app valida si su plan lo permite.
3. Se cargan los miembros actuales del plan.
4. El usuario agrega o elimina miembros.
5. El backend valida y responde con el estado actualizado.

### 9.4 Diagramas funcionales

#### Diagrama 1. Flujo general de suscripcion

```text
Usuario
  |
  v
Pantalla de suscripcion
  |
  +--> GET /payments/plans
  |
  +--> GET /payments/subscription
  |
  v
Plan activo + funciones desbloqueadas
  |
  +--> free / edu -> sin checkout
  |
  +--> safe / guard
          |
          v
      Seleccion mensual o anual
          |
          v
      Hoja de pago
          |
          v
      POST /payments/checkout
          |
          v
      Stripe Checkout
```

#### Diagrama 2. Flujo de membresia familiar

```text
Usuario con plan compatible
  |
  v
Pantalla Administrar membresias
  |
  +--> GET /payments/subscription
  |
  +--> Validacion de plan
  |
  +--> GET /payments/family-members
  |
  +--> POST /payments/family-members
  |
  +--> DELETE /payments/family-members/{member_user_id}
```

## 10. Apartados cambiados dentro del modulo

Los apartados concretos del modulo de membresia que cambiaron fueron:

- encabezado principal y resumen del plan actual;
- selector de modalidad mensual o anual;
- tarjetas visuales de planes;
- modal de pago;
- control de funciones desbloqueadas por plan;
- entrada a la pantalla de administracion familiar;
- lista real de miembros;
- alta y baja de miembros familiares;
- servicio de integracion con backend;
- reglas de negocio de plan familiar;
- reglas de negocio de checkout.

## 11. Archivos impactados

### Frontend

- `frontend/app/subscription/index.tsx`
- `frontend/app/subscription/manage.tsx`
- `frontend/app/subscription/_services/subscriptionService.ts`
- `frontend/app/subscription/_types.ts`
- `frontend/app/subscription/_utils/planAccess.ts`
- `frontend/app/subscription/_components/PlanCard.tsx`
- `frontend/app/subscription/_components/BillingToggle.tsx`
- `frontend/app/subscription/_components/StripePaymentSheet.tsx`
- `frontend/app/subscription/_components/PaymentMethodSheet.tsx`
- `frontend/app/subscription/_components/FeatureAccessCard.tsx`
- `frontend/app/subscription/_components/MemberListItem.tsx`

### Backend

- `backend/app/features/payments/router.py`
- `backend/app/features/payments/service.py`
- `backend/app/features/payments/schemas.py`

## 12. Aclaraciones operativas importantes

### 12.1 Proveedor de pago visible en app

Actualmente el proveedor de pago visible en la app es Stripe.

Esto implica que:

- el usuario ve Stripe como opcion principal de pago;
- la hoja de pago actual conduce al flujo de Stripe Checkout;
- la mensajeria de compra, continuidad y renovacion esta escrita alrededor de Stripe;
- aunque backend puede contemplar otros escenarios tecnicos, la experiencia mostrada al usuario esta enfocada hoy en Stripe.

### 12.2 Cancelacion desde la app

La cancelacion de suscripcion desde la app todavia no esta terminada de forma funcional.

Esto implica que:

- la app ya puede iniciar el flujo de compra;
- la app ya puede mostrar el plan activo;
- pero la app no cuenta aun con un endpoint backend operativo para cancelar directamente desde la interfaz;
- por eso el flujo de cancelacion debe considerarse pendiente.

### 12.3 Dependencia de credenciales y despliegue

El funcionamiento final del modulo depende del entorno de despliegue.

Para operar en ambiente real se necesita:

- credenciales validas del proveedor de pago;
- tablas de suscripcion y membresia familiar correctamente desplegadas;
- rutas y webhooks correctamente conectados;
- consistencia entre configuracion del frontend, backend y proveedor de pago.

Esto significa que la logica ya existe, pero el comportamiento final en produccion depende de una configuracion de infraestructura correcta.

## 13. Impacto funcional del cambio

El impacto principal de esta actualizacion es que la membresia deja de ser una promesa visual y pasa a ser un modulo con comportamiento operativo real.

Beneficios principales:

- el usuario conoce su plan real;
- el sistema puede bloquear y habilitar funciones segun plan;
- la compra ya tiene conexion con backend;
- la gestion familiar ya tiene soporte real;
- la arquitectura queda lista para seguir creciendo en monetizacion.

## 14. Conclusion

La actualizacion de membresia representa un cambio estructural importante dentro de BluEye. El modulo ahora consulta la suscripcion real del usuario, permite iniciar checkout, controla funciones segun plan y administra miembros familiares bajo reglas definidas.

En terminos funcionales, la membresia queda mucho mas cerca de una implementacion operativa y utilizable.
