import type { TourStep } from "react-native-spotlight-tour";

import { TourBox } from "./TourBox";
import { LOCAL_CHAT_ENABLED } from "../../utils/platformFeatures";

/**
 * Tutorial 2 — MoreScreen. Fires on first visit, gated on Tutorial 1 being
 * finished or dismissed so a fast explorer never gets both stacked.
 *
 * "Feedback" and "Ajustes" say what they are from their label and icon;
 * spending a step on either would sit a housekeeping item next to a
 * life-safety message and teach users the bubbles aren't worth reading.
 *
 * The offline-chat step only exists where its card does. On iOS the local-chat
 * entry isn't rendered (see `utils/platformFeatures`), so this array is one
 * step and SOS contacts becomes index 0 — which is why `MORE_TOUR` in
 * `constants.ts` reads the same flag. Change one without the other and the tour
 * renders an INVISIBLE tooltip over a dimmed screen. `MoreScreen` asserts the
 * pairing, but only under `__DEV__` — a release build will not warn you.
 */

const TOTAL = LOCAL_CHAT_ENABLED ? 2 : 1;

const offlineChatStep: TourStep = {
  shape: { type: "rectangle", padding: 6 },
  render: (props) => (
    <TourBox
      {...props}
      total={TOTAL}
      title="Chat sin internet"
      body="Se conecta directo con teléfonos cercanos que tengan Bluai, sin red ni datos. Úsalo cuando se caiga la señal y necesites coordinarte con quien esté alrededor."
    />
  ),
};

const sosContactsStep: TourStep = {
  shape: { type: "rectangle", padding: 6 },
  render: (props) => (
    <TourBox
      {...props}
      total={TOTAL}
      title="Contactos SOS"
      body="Son quienes reciben tu ubicación cuando usas el botón de emergencia. Configúralos ahora: en plena tormenta no vas a tener tiempo."
    />
  ),
};

export const moreTourSteps: TourStep[] = LOCAL_CHAT_ENABLED
  ? [offlineChatStep, sosContactsStep]
  : [sosContactsStep];
