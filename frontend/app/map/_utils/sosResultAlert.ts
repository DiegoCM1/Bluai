import { Alert } from "react-native";
import { router } from "expo-router";

/**
 * What the sender sees after an SOS — both platforms, sent live or from the offline
 * queue. Built from the backend's per-contact `contacts` list so it names who got the
 * alert and who didn't, and why.
 *
 * Never say "SOS enviado" when nobody received it: for an emergency feature that is
 * the worst possible message (and exactly what App Review would hit by adding a fake
 * contact and pressing SOS). A native Alert, not a toast, so it can't be missed.
 */

type ContactStatus =
  | "notified"
  | "no_device"
  | "failed"
  | "invite_pending"
  | "not_linked";

export interface SOSTriggerResult {
  notified_count?: number;
  skipped_count?: number;
  contacts?: { name: string; status: ContactStatus }[];
}

const REASON: Record<Exclude<ContactStatus, "notified">, string> = {
  invite_pending: "no ha aceptado tu invitación",
  not_linked: "no ha sido invitado a Bluai",
  no_device: "no tiene notificaciones activas",
  failed: "no se pudo entregar",
};

function goToContacts() {
  router.push("/SOSContactsScreen");
}

export function showSOSResultAlert(data: SOSTriggerResult | null) {
  const contacts = data?.contacts;

  // Backend older than per-contact results: fall back to the counts.
  if (!Array.isArray(contacts)) {
    if ((data?.notified_count ?? 0) > 0) {
      Alert.alert("SOS enviado", `${data!.notified_count} contacto(s) notificado(s).`);
    } else {
      Alert.alert(
        "SOS no entregado",
        "Nadie recibió tu alerta. Agrega contactos y pídeles que acepten tu invitación en Bluai.",
        [
          { text: "Cerrar", style: "cancel" },
          { text: "Ir a contactos", onPress: goToContacts },
        ],
      );
    }
    return;
  }

  if (contacts.length === 0) {
    Alert.alert(
      "No tienes contactos SOS",
      "Nadie recibió tu alerta. Agrega a alguien de confianza e invítalo a Bluai para que reciba tus SOS.",
      [
        { text: "Cerrar", style: "cancel" },
        { text: "Agregar contactos", onPress: goToContacts },
      ],
    );
    return;
  }

  const received = contacts.filter((c) => c.status === "notified");
  const missed = contacts.filter((c) => c.status !== "notified");

  const lines: string[] = [];
  if (received.length > 0) {
    lines.push(`Recibieron tu alerta: ${received.map((c) => c.name).join(", ")}.`);
  }
  if (missed.length > 0) {
    lines.push(
      "No la recibieron:\n" +
        missed
          .map((c) => `• ${c.name} — ${REASON[c.status as keyof typeof REASON] ?? "no se pudo entregar"}`)
          .join("\n"),
    );
    lines.push("Invítalos desde tus contactos SOS para que reciban tus próximas alertas.");
  }

  const title =
    missed.length === 0
      ? "SOS enviado"
      : received.length === 0
        ? "SOS no entregado"
        : `SOS enviado a ${received.length} de ${contacts.length}`;

  Alert.alert(
    title,
    lines.join("\n\n"),
    missed.length > 0
      ? [
          { text: "Cerrar", style: "cancel" },
          { text: "Invitar contactos", onPress: goToContacts },
        ]
      : [{ text: "OK" }],
  );
}
