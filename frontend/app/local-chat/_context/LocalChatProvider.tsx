// Single source of truth for the offline chat feature.
//
// Why a provider and not a per-screen hook: the lobby and the per-person chat
// screen must share ONE live transport connection and ONE conversation store.
// Two screens each calling a hook would each spin up their own state. So the
// transport, identity, and persisted conversations live here, mounted once in
// `_layout.tsx`, and screens read from context.
//
// Identity model: `deviceId` is the stable, persisted key (survives nickname
// changes and reconnects); the ephemeral transport `endpointId` is only used
// to route a message right now. Conversations are keyed by `deviceId`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PermissionsAndroid, Platform } from "react-native";
import type { Permission } from "react-native";

import type { Conversation, DiscoveredPeer, LocalMessage } from "../_types";
import { BROADCAST, decode, encode, makeEnvelope, newId } from "../_services/protocol";
import { createMeshRouter, type MeshRouter } from "../_services/meshRouter";
import { getTransport } from "../_services/transport";
import {
  decodeIdentity,
  encodeIdentity,
  newDeviceId,
} from "../_services/identity";
import {
  loadBlockedDeviceIds,
  loadConversations,
  loadNickname,
  loadOrCreateDeviceId,
  saveBlockedDeviceIds,
  saveConversations,
  saveNickname,
} from "../_services/storage";

/** A mesh-room participant, for the roster UI (direct link vs. reachable by hop). */
export interface MeshRosterEntry {
  deviceId: string;
  nickname: string;
  viaHop: boolean;
}

/** BLE/emergency constraint: short messages only (MTU + readability). */
export const MAX_MESSAGE_LENGTH = 200;

async function requestNearbyPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return false;

  const perms: Permission[] = [];
  if (Number(Platform.Version) >= 33) {
    perms.push(PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES);
  }
  if (Number(Platform.Version) >= 31) {
    perms.push(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
  } else {
    perms.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  }

  const result = await PermissionsAndroid.requestMultiple(perms);
  return perms.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

interface LocalChatValue {
  supported: boolean;
  available: boolean;
  hydrated: boolean;

  // identity
  deviceId: string;
  nickname: string;
  needsNickname: boolean;
  setNickname: (nickname: string) => Promise<void>;

  // transport status — independent radios + connection phase (never conflated)
  advertising: boolean;
  discovering: boolean;
  connecting: boolean;
  error: string | null;
  logs: string[];

  // lobby
  peers: DiscoveredPeer[];
  /** Every peer with a live connection right now (P2P_CLUSTER: can be more than one). */
  connectedPeers: DiscoveredPeer[];
  /** @deprecated kept for simple "am I connected to anyone" call sites — prefer isPeerConnected. */
  connectedPeerId: string | null;
  isPeerInRange: (peerId: string) => boolean;
  isPeerConnected: (peerId: string) => boolean;
  conversations: Conversation[];
  getConversation: (peerId: string) => Conversation | undefined;
  clearConversation: (peerId: string) => void;

  // mesh broadcast room
  meshMessages: LocalMessage[];
  meshRoster: MeshRosterEntry[];
  sendMeshMessage: (body: string) => void;

  // blocking — by deviceId, not nickname (see storage.ts)
  blockedDeviceIds: string[];
  blockPeer: (deviceId: string) => Promise<void>;
  unblockPeer: (deviceId: string) => Promise<void>;

  // actions
  toggleAdvertise: () => Promise<void>;
  toggleDiscover: () => Promise<void>;
  resetSession: () => Promise<void>;
  connectToPeer: (endpointId: string) => Promise<void>;
  disconnect: (peerId?: string) => Promise<void>;
  sendMessage: (peerId: string, body: string) => Promise<void>;
}

const LocalChatContext = createContext<LocalChatValue | null>(null);

export function LocalChatProvider({ children }: { children: React.ReactNode }) {
  const transport = useMemo(() => getTransport(), []);
  const supported = Platform.OS === "android";
  const available = transport.isAvailable;

  const [hydrated, setHydrated] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [nickname, setNicknameState] = useState("");
  const [conversations, setConversations] = useState<
    Record<string, Conversation>
  >({});

  // Honest state: two independent radios + a connection phase. Each toggle
  // binds to its own boolean, so the UI can never claim a radio is off while
  // it's actually on. These are driven by what the native calls actually did.
  const [advertising, setAdvertising] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [peers, setPeers] = useState<DiscoveredPeer[]>([]);
  // P2P_CLUSTER holds several simultaneous connections — this replaced a
  // single `connected: DiscoveredPeer | null` slot, which under cluster
  // mode would just silently drop everyone but the most recent peer.
  const [connectedPeers, setConnectedPeers] = useState<DiscoveredPeer[]>([]);
  const [meshMessages, setMeshMessages] = useState<LocalMessage[]>([]);
  const [blockedDeviceIds, setBlockedDeviceIds] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([
    supported ? "Listo para Android." : "No disponible en esta plataforma.",
  ]);
  const [error, setError] = useState<string | null>(
    !supported
      ? "El chat local solo está disponible en Android por ahora."
      : !available
        ? "El módulo nativo no está cargado. Reconstruye con expo run:android."
        : null,
  );

  // Refs mirror state so the transport event handlers (bound once) can resolve
  // a live endpointId → stable deviceId without capturing stale closures.
  const peersRef = useRef<DiscoveredPeer[]>([]);
  const connectedPeersRef = useRef<DiscoveredPeer[]>([]);
  const conversationsRef = useRef<Record<string, Conversation>>({});
  const meshRouterRef = useRef<MeshRouter | null>(null);
  peersRef.current = peers;
  connectedPeersRef.current = connectedPeers;
  conversationsRef.current = conversations;

  const addLog = useCallback(
    (m: string) => setLogs((c) => [m, ...c].slice(0, 12)),
    [],
  );
  const reportError = useCallback(
    (message: string) => {
      setError(message);
      addLog(`⚠️ ${message}`);
    },
    [addLog],
  );

  // --- persistence: hydrate once on mount ------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [id, nick, convos, blocked] = await Promise.all([
          loadOrCreateDeviceId(newDeviceId),
          loadNickname(),
          loadConversations(),
          loadBlockedDeviceIds(),
        ]);
        if (cancelled) return;
        setDeviceId(id);
        setNicknameState(nick ?? "");
        setConversations(convos);
        setBlockedDeviceIds(blocked);
      } catch (e: any) {
        if (!cancelled)
          reportError(`No se pudo cargar el historial: ${e?.message ?? e}`);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reportError]);

  // Persist conversations whenever they change (after hydration).
  useEffect(() => {
    if (!hydrated) return;
    saveConversations(conversations).catch((e) =>
      console.warn("[local-chat] saveConversations falló:", e),
    );
  }, [conversations, hydrated]);

  // --- conversation mutation helper ------------------------------------------
  const upsertMessage = useCallback(
    (peerId: string, peerNickname: string, message: LocalMessage) => {
      setConversations((prev) => {
        const existing = prev[peerId];
        const messages = existing ? [message, ...existing.messages] : [message];
        return {
          ...prev,
          [peerId]: {
            peerId,
            peerNickname: peerNickname || existing?.peerNickname || peerId,
            lastSeen: Date.now(),
            messages,
          },
        };
      });
    },
    [],
  );

  const patchMessageStatus = useCallback(
    (peerId: string, messageId: string, status: LocalMessage["status"]) => {
      setConversations((prev) => {
        const convo = prev[peerId];
        if (!convo) return prev;
        return {
          ...prev,
          [peerId]: {
            ...convo,
            messages: convo.messages.map((m) =>
              m.id === messageId ? { ...m, status } : m,
            ),
          },
        };
      });
    },
    [],
  );

  /** Empty a conversation's messages locally (keeps the peer entry). */
  const clearConversation = useCallback((peerId: string) => {
    setConversations((prev) => {
      const convo = prev[peerId];
      if (!convo) return prev;
      return { ...prev, [peerId]: { ...convo, messages: [] } };
    });
  }, []);

  /** Apply a peer's new nickname everywhere it's shown (live rename). */
  const updatePeerNickname = useCallback(
    (peerDeviceId: string, nickname: string) => {
      setPeers((c) =>
        c.map((p) => (p.deviceId === peerDeviceId ? { ...p, nickname } : p)),
      );
      setConnectedPeers((c) =>
        c.map((p) => (p.deviceId === peerDeviceId ? { ...p, nickname } : p)),
      );
      setConversations((prev) => {
        const convo = prev[peerDeviceId];
        if (!convo) return prev;
        return {
          ...prev,
          [peerDeviceId]: {
            ...convo,
            peerNickname: nickname,
            lastSeen: Date.now(),
          },
        };
      });
    },
    [],
  );

  const upsertMeshMessage = useCallback((message: LocalMessage) => {
    // Bounded like `logs` — a broadcast room in a long emergency session
    // shouldn't grow without limit.
    setMeshMessages((prev) => [message, ...prev].slice(0, 200));
  }, []);

  // --- transport subscription ------------------------------------------------
  // Gated on `deviceId` too: the mesh router needs a stable identity to
  // decide "is this envelope for me" — and in practice nothing can connect
  // before hydration finishes anyway (advertising/discovering require a
  // saved nickname, which only exists post-hydration), so this doesn't
  // change real behavior, just makes the dependency explicit.
  useEffect(() => {
    if (!available || !deviceId) return;

    const router = createMeshRouter(deviceId, {
      sendToAllExcept: (raw, exceptEndpointId) => {
        // A defined exceptEndpointId means this is a relay (see meshRouter's
        // onPayload); undefined means it's our own fresh outgoing message.
        if (exceptEndpointId) {
          const env = decode(raw);
          if (env) addLog(`↻ Reenviado id=${env.id.slice(0, 8)} ttl→${env.ttl}`);
        }
        for (const peer of connectedPeersRef.current) {
          if (peer.endpointId === exceptEndpointId) continue;
          transport
            .send(peer.endpointId, raw)
            .catch((e: any) =>
              addLog(`⚠️ Reenvío a ${peer.nickname} falló: ${e?.message ?? e}`),
            );
        }
      },
      onDeliver: (env, fromEndpointId) => {
        const link =
          connectedPeersRef.current.find((p) => p.endpointId === fromEndpointId) ??
          peersRef.current.find((p) => p.endpointId === fromEndpointId);
        const peerId = link?.deviceId ?? env.from;

        // Control message: a live rename — apply it, don't show a bubble.
        if (env.kind === "identity") {
          updatePeerNickname(peerId, env.body);
          addLog(`Nombre actualizado: ${env.body}`);
          return;
        }

        if (env.to === BROADCAST) {
          const isDirect = connectedPeersRef.current.some(
            (p) => p.deviceId === env.from,
          );
          upsertMeshMessage({
            id: `remote-${env.id}`,
            author: "remote",
            body: env.body,
            sentAt: new Date().toISOString(),
            peerId: env.from,
          });
          addLog(`Mesh: mensaje de ${env.from}${isDirect ? "" : " (por salto)"}`);
          return;
        }

        const peerNickname = link?.nickname ?? env.from;
        upsertMessage(peerId, peerNickname, {
          id: `remote-${env.id}`,
          author: "remote",
          body: env.body,
          sentAt: new Date().toISOString(),
          peerId,
        });
      },
    });
    meshRouterRef.current = router;

    const unsubscribe = transport.subscribe({
      onStateChange: (s) => {
        // The two radios are tracked as booleans (driven by our own calls).
        // From the native state stream we only take the connection phase.
        if (s === "connecting") setConnecting(true);
        if (s === "idle" || s === "error" || s === "connected") {
          setConnecting(false);
        }
        addLog(`Estado: ${s}`);
      },
      onPeerFound: (peer) => {
        const id = decodeIdentity(peer.name);
        const discovered: DiscoveredPeer = {
          endpointId: peer.endpointId,
          deviceId: id.deviceId,
          nickname: id.nickname,
        };
        setPeers((c) =>
          c.some((p) => p.deviceId === discovered.deviceId)
            ? c.map((p) =>
                p.deviceId === discovered.deviceId ? discovered : p,
              )
            : [...c, discovered],
        );
        addLog(`Encontrado: ${id.nickname}`);
      },
      onPeerLost: (endpointId) => {
        setPeers((c) => c.filter((p) => p.endpointId !== endpointId));
        addLog(`Fuera de rango: ${endpointId}`);
      },
      onConnectionInitiated: (peer) =>
        addLog(`Solicitud: ${decodeIdentity(peer.name).nickname}`),
      onConnectionRejected: (peer) =>
        addLog(`Bloqueado: ${decodeIdentity(peer.name).nickname} (deviceId bloqueado)`),
      onConnected: (peer) => {
        const id = decodeIdentity(peer.name);
        const link: DiscoveredPeer = {
          endpointId: peer.endpointId,
          deviceId: id.deviceId,
          nickname: id.nickname,
        };
        setConnectedPeers((c) =>
          c.some((p) => p.deviceId === link.deviceId)
            ? c.map((p) => (p.deviceId === link.deviceId ? link : p))
            : [...c, link],
        );
        setConnecting(false);
        // P2P_CLUSTER keeps both radios running after connecting — mesh needs
        // to keep gathering peers, not stop at one. Toggles stay whatever the
        // user last set them to; we don't flip them here anymore.
        setError(null);
        // Touch the conversation so it appears in "previas" even before any
        // message, and its nickname stays current.
        setConversations((prev) => {
          const existing = prev[id.deviceId];
          return {
            ...prev,
            [id.deviceId]: {
              peerId: id.deviceId,
              peerNickname: id.nickname,
              lastSeen: Date.now(),
              messages: existing?.messages ?? [],
            },
          };
        });
        addLog(`Conectado con ${id.nickname}`);
      },
      onConnectionFailed: () => {
        setConnecting(false);
        reportError("No se pudo completar la conexión.");
      },
      onDisconnected: (endpointId) => {
        setConnectedPeers((c) => c.filter((p) => p.endpointId !== endpointId));
        setConnecting(false);
        addLog("Una conexión se cerró.");
      },
      onPayload: (endpointId, raw) => {
        if (!decode(raw)) {
          addLog(
            `⚠️ Payload descartado: vacío o no decodificable (${raw.length} bytes)`,
          );
          return;
        }
        router.onPayload(endpointId, raw);
      },
    });

    return () => {
      unsubscribe();
      meshRouterRef.current = null;
      transport
        .stopAll()
        .catch((e) =>
          console.warn("[local-chat] stopAll en cleanup falló:", e),
        );
    };
  }, [
    available,
    deviceId,
    transport,
    addLog,
    reportError,
    upsertMessage,
    updatePeerNickname,
    upsertMeshMessage,
  ]);

  // --- identity --------------------------------------------------------------
  const needsNickname = hydrated && nickname.trim().length === 0;

  const setNickname = useCallback(
    async (next: string) => {
      const trimmed = next.trim();
      if (trimmed.length < 2 || trimmed.length > 20) {
        reportError("El nombre debe tener entre 2 y 20 caracteres.");
        return;
      }
      setNicknameState(trimmed);
      try {
        await saveNickname(trimmed);
      } catch (e: any) {
        reportError(`No se pudo guardar el nombre: ${e?.message ?? e}`);
      }
      // Live-push the rename to every currently-connected peer so their view
      // updates without waiting for a fresh discovery. New discoverers still
      // get the latest name via the broadcast on the next advertise.
      for (const link of connectedPeersRef.current) {
        const env = makeEnvelope({
          from: deviceId,
          to: link.deviceId,
          body: trimmed,
          kind: "identity",
        });
        transport
          .send(link.endpointId, encode(env))
          .catch((e) =>
            addLog(
              `No se pudo actualizar el nombre en vivo con ${link.nickname}: ${e?.message ?? e}`,
            ),
          );
      }
    },
    [reportError, deviceId, transport, addLog],
  );

  // --- gating ----------------------------------------------------------------
  const ensureReady = useCallback(async () => {
    if (!supported) {
      setError("El chat local solo está disponible en Android por ahora.");
      return false;
    }
    if (!available) {
      setError("Falta el módulo nativo. Reconstruye con expo run:android.");
      return false;
    }
    if (nickname.trim().length === 0) {
      setError("Primero define tu nombre.");
      return false;
    }
    const granted = await requestNearbyPermissions();
    if (!granted) {
      setError("Faltan permisos de Bluetooth / ubicación.");
      return false;
    }
    setError(null);
    return true;
  }, [supported, available, nickname]);

  // --- actions ---------------------------------------------------------------
  // Each toggle owns one radio. We set the boolean only AFTER the native call
  // resolves, so the UI reflects what actually happened — never an optimistic
  // guess. (8001/8002 "already on" resolve as success, keeping us truthful.)
  const toggleAdvertise = useCallback(async () => {
    if (advertising) {
      try {
        await transport.stopAdvertising();
        setAdvertising(false);
      } catch (e: any) {
        reportError(`No se pudo dejar de anunciar: ${e?.message ?? e}`);
      }
      return;
    }
    if (!(await ensureReady())) return;
    try {
      await transport.startAdvertising(encodeIdentity({ deviceId, nickname }));
      setAdvertising(true);
    } catch (e: any) {
      reportError(`No se pudo anunciar: ${e?.message ?? e}`);
    }
  }, [advertising, ensureReady, transport, deviceId, nickname, reportError]);

  const toggleDiscover = useCallback(async () => {
    if (discovering) {
      try {
        await transport.stopDiscovery();
        setDiscovering(false);
      } catch (e: any) {
        reportError(`No se pudo dejar de buscar: ${e?.message ?? e}`);
      }
      return;
    }
    if (!(await ensureReady())) return;
    setPeers([]);
    try {
      await transport.startDiscovery();
      setDiscovering(true);
    } catch (e: any) {
      reportError(`No se pudo buscar: ${e?.message ?? e}`);
    }
  }, [discovering, ensureReady, transport, reportError]);

  const connectToPeer = useCallback(
    async (endpointId: string) => {
      setError(null);
      try {
        await transport.requestConnection(endpointId);
      } catch (e: any) {
        reportError(`No se pudo conectar: ${e?.message ?? e}`);
      }
    },
    [transport, reportError],
  );

  /** Omit peerId to disconnect everyone; pass one to drop just that peer. */
  const disconnect = useCallback(
    async (peerId?: string) => {
      const endpointId = peerId
        ? connectedPeersRef.current.find((p) => p.deviceId === peerId)?.endpointId
        : undefined;
      try {
        await transport.disconnect(endpointId);
      } catch (e: any) {
        reportError(`No se pudo desconectar: ${e?.message ?? e}`);
      }
      setConnectedPeers((c) =>
        peerId ? c.filter((p) => p.deviceId !== peerId) : [],
      );
    },
    [transport, reportError],
  );

  const resetSession = useCallback(async () => {
    setPeers([]);
    setConnectedPeers([]);
    setAdvertising(false);
    setDiscovering(false);
    setConnecting(false);
    setError(null);
    try {
      await transport.stopAll();
    } catch (e: any) {
      reportError(`No se pudo detener todo: ${e?.message ?? e}`);
    }
  }, [transport, reportError]);

  /**
   * Transmit one already-stored self-message over the live connection.
   * Returns whether it left the device. Used by both a fresh send and the
   * reconnect flush, so the wire path has a single implementation.
   */
  const transmit = useCallback(
    async (peerId: string, localId: string, body: string): Promise<boolean> => {
      const link = connectedPeersRef.current.find((p) => p.deviceId === peerId);
      if (!link) return false; // not a live peer right now
      const envelope = makeEnvelope({ from: deviceId, to: peerId, body });
      patchMessageStatus(peerId, localId, "sending");
      try {
        await transport.send(link.endpointId, encode(envelope));
        patchMessageStatus(peerId, localId, "sent");
        return true;
      } catch (e: any) {
        addLog(`⚠️ Mensaje no enviado: ${e?.message ?? e}`);
        patchMessageStatus(peerId, localId, "failed");
        return false;
      }
    },
    [deviceId, transport, patchMessageStatus, addLog],
  );

  const sendMessage = useCallback(
    async (peerId: string, body: string) => {
      const text = body.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!text) return;

      const link = connectedPeersRef.current.find((p) => p.deviceId === peerId);
      const live = link !== undefined;
      const localId = `self-${newId()}`;

      // Optimistic insert. If the peer isn't the live connection, it queues
      // and the flush-on-reconnect effect will pick it up.
      upsertMessage(peerId, link?.nickname ?? peerId, {
        id: localId,
        author: "self",
        body: text,
        sentAt: new Date().toISOString(),
        status: live ? "sending" : "queued",
        peerId,
      });

      if (live) {
        await transmit(peerId, localId, text);
      } else {
        addLog(`Mensaje en cola (sin conexión): ${peerId}`);
      }
    },
    [upsertMessage, transmit, addLog],
  );

  // Drain the queue when peers (re)connect: replay every still-queued
  // self-message for each connected peer, oldest first. Without this, queued
  // messages would sit forever — the "se enviará al reconectar" promise
  // would be empty. Safe to re-run often: it only ever picks up messages
  // still in "queued" status, so an already-flushed message is a no-op.
  useEffect(() => {
    if (connectedPeers.length === 0) return;
    (async () => {
      for (const peer of connectedPeers) {
        const convo = conversationsRef.current[peer.deviceId];
        if (!convo) continue;
        const queued = convo.messages
          .filter((m) => m.author === "self" && m.status === "queued")
          .reverse(); // store is newest-first → send oldest first
        if (queued.length === 0) continue;
        addLog(`Reenviando ${queued.length} en cola a ${peer.nickname}`);
        for (const m of queued) {
          await transmit(peer.deviceId, m.id, m.body);
        }
      }
    })();
  }, [connectedPeers, transmit, addLog]);

  // --- mesh broadcast room -----------------------------------------------------
  const sendMeshMessage = useCallback(
    (body: string) => {
      const text = body.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (!text) return;
      const router = meshRouterRef.current;
      if (!router) {
        addLog("⚠️ Mesh no disponible todavía (identidad sin cargar).");
        return;
      }
      const env = router.send(text);
      upsertMeshMessage({
        id: `self-${env.id}`,
        author: "self",
        body: text,
        sentAt: new Date().toISOString(),
        status: "sent", // flooding is fire-and-forget — no per-recipient ack
        peerId: deviceId,
      });
    },
    [addLog, deviceId, upsertMeshMessage],
  );

  // --- blocking (by deviceId — see storage.ts) --------------------------------
  // Synced down to native on every change: onConnectionInitiated rejects a
  // blocked deviceId there, before ever accepting — no JS round trip needed.
  useEffect(() => {
    if (!available) return;
    transport
      .setBlockedDeviceIds(blockedDeviceIds)
      .catch((e: any) =>
        console.warn("[local-chat] setBlockedDeviceIds falló:", e),
      );
  }, [available, blockedDeviceIds, transport]);

  const blockPeer = useCallback(
    async (peerDeviceId: string) => {
      setBlockedDeviceIds((prev) =>
        prev.includes(peerDeviceId) ? prev : [...prev, peerDeviceId],
      );
      try {
        await saveBlockedDeviceIds(
          Array.from(new Set([...blockedDeviceIds, peerDeviceId])),
        );
      } catch (e: any) {
        addLog(`⚠️ No se pudo guardar el bloqueo: ${e?.message ?? e}`);
      }
      // Blocking someone already connected ends that connection immediately.
      const live = connectedPeersRef.current.find(
        (p) => p.deviceId === peerDeviceId,
      );
      if (live) await disconnect(peerDeviceId);
    },
    [blockedDeviceIds, addLog, disconnect],
  );

  const unblockPeer = useCallback(
    async (peerDeviceId: string) => {
      const next = blockedDeviceIds.filter((id) => id !== peerDeviceId);
      setBlockedDeviceIds(next);
      try {
        await saveBlockedDeviceIds(next);
      } catch (e: any) {
        addLog(`⚠️ No se pudo guardar el desbloqueo: ${e?.message ?? e}`);
      }
    },
    [blockedDeviceIds, addLog],
  );

  // --- selectors -------------------------------------------------------------
  const conversationList = useMemo(
    () => Object.values(conversations).sort((a, b) => b.lastSeen - a.lastSeen),
    [conversations],
  );
  const getConversation = useCallback(
    (peerId: string) => conversations[peerId],
    [conversations],
  );
  const isPeerInRange = useCallback(
    (peerId: string) => peers.some((p) => p.deviceId === peerId),
    [peers],
  );
  const isPeerConnected = useCallback(
    (peerId: string) => connectedPeers.some((p) => p.deviceId === peerId),
    [connectedPeers],
  );
  // Direct link (live Nearby connection) vs. reachable only by hop (we've
  // seen a mesh-room message whose original sender isn't a direct peer).
  const meshRoster = useMemo<MeshRosterEntry[]>(() => {
    const direct = connectedPeers.map((p) => ({
      deviceId: p.deviceId,
      nickname: p.nickname,
      viaHop: false,
    }));
    const directIds = new Set(direct.map((p) => p.deviceId));
    const hopOnly = new Map<string, string>();
    for (const m of meshMessages) {
      if (m.author === "remote" && m.peerId && !directIds.has(m.peerId)) {
        hopOnly.set(m.peerId, m.peerId); // no nickname carried over hops — id is the best we have
      }
    }
    return [
      ...direct,
      ...Array.from(hopOnly.entries()).map(([deviceIdKey, nickname]) => ({
        deviceId: deviceIdKey,
        nickname,
        viaHop: true,
      })),
    ];
  }, [connectedPeers, meshMessages]);

  const value: LocalChatValue = {
    supported,
    available,
    hydrated,
    deviceId,
    nickname,
    needsNickname,
    setNickname,
    advertising,
    discovering,
    connecting,
    error,
    logs,
    peers,
    connectedPeers,
    connectedPeerId: connectedPeers[0]?.deviceId ?? null,
    isPeerInRange,
    isPeerConnected,
    conversations: conversationList,
    getConversation,
    clearConversation,
    meshMessages,
    meshRoster,
    sendMeshMessage,
    blockedDeviceIds,
    blockPeer,
    unblockPeer,
    toggleAdvertise,
    toggleDiscover,
    resetSession,
    connectToPeer,
    disconnect,
    sendMessage,
  };

  return (
    <LocalChatContext.Provider value={value}>
      {children}
    </LocalChatContext.Provider>
  );
}

export function useLocalChatContext(): LocalChatValue {
  const ctx = useContext(LocalChatContext);
  if (!ctx) {
    throw new Error(
      "useLocalChatContext must be used within LocalChatProvider",
    );
  }
  return ctx;
}
