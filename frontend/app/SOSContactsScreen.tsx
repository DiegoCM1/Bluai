import "../global.css";
import { useState, useEffect, useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";
import {
  View, Text, FlatList, Modal, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform, Pressable, Share,
  AppState, DeviceEventEmitter, Linking,
} from "react-native";
import * as ExpoContacts from "expo-contacts";
import { toast } from "sonner-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import ScreenHeader from "../components/ScreenHeader";
import { authFetch } from "../utils/api";
import { API_BASE_URL } from "../utils/config";
import { colors, fonts } from "../utils/theme";
import { PENDING_SOS_INVITE_KEY } from "./sos-invite/[token]";
import { PENDING_SOS_CONTACT_ADDED_KEY } from "./_layout";
import { useCurrentPlan } from './subscription/_hooks/useCurrentPlan';
import { canAccessFeature } from "./subscription/_utils/planAccess";

interface SOSContact {
  id: number; user_id: number; name: string; phone: string;
  relationship: string | null;
  linked_user_id: number | null;
  link_status: string;
  created_at: string; updated_at: string;
}

interface WhoHasMeItem {
  owner_user_id: number;
  name: string;
  relationship: string | null;
  owner_display_name: string | null;
  owner_phone: string | null;
  already_my_contact: boolean;
  created_at: string;
}

export default function SOSContactsScreen() {
  const router = useRouter();
  const [contacts, setContacts]             = useState<SOSContact[]>([]);
  const [loading, setLoading]               = useState(true);
  const [fetchError, setFetchError]         = useState(false);
  const [saving, setSaving]                 = useState(false);
  const [modalVisible, setModalVisible]     = useState(false);
  const [editingContact, setEditingContact] = useState<SOSContact | null>(null);
  const [nameVal, setNameVal]               = useState("");
  const [phoneVal, setPhoneVal]             = useState("");
  const [relVal, setRelVal]                 = useState("");
  const [formError, setFormError]           = useState<string | null>(null);
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
  const [pendingContactAdded, setPendingContactAdded] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [phoneContacts, setPhoneContacts] = useState<ExpoContacts.Contact[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [whoHasMe, setWhoHasMe]             = useState<WhoHasMeItem[]>([]);
  const [addingReciprocal, setAddingReciprocal] = useState<number | null>(null);
  const currentPlan = useCurrentPlan();
  const blockedByPlan = !canAccessFeature(currentPlan, 'family_panic');

  const fetchAllRef = useRef<() => void>(() => {});



  if (blockedByPlan) {
    return (
      <SafeAreaView className="flex-1 bg-transparent" edges={["top", "left", "right", "bottom"]}>
        <ScreenHeader title="Contactos SOS" />
        <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
          <View style={{ borderRadius: 20, padding: 20, backgroundColor: 'rgba(245,158,11,0.12)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)' }}>
            <Text style={{ color: 'white', fontFamily: fonts.poppinsSemiBold, fontSize: 20, marginBottom: 10 }}>
              Funcion bloqueada
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.82)', fontFamily: fonts.poppins, fontSize: 14, lineHeight: 20, marginBottom: 16 }}>
              Los contactos SOS familiares requieren un plan Safe o Guard.
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/subscription')}
              style={{ backgroundColor: colors.brandCyan, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}
            >
              <Text style={{ color: '#062032', fontFamily: fonts.poppinsSemiBold }}>
                Ver suscripcion
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Silent push → instant refresh without waiting for 15s poll
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('contacts:refresh', () => {
      console.log('[QA_SOS] DeviceEventEmitter contacts:refresh → instant refetch');
      fetchAllRef.current();
    });
    return () => sub.remove();
  }, []);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      let isFirst = true;

      function fetchAll() {
        if (!live) return;
        console.log('[QA_SOS] poll → refetching contacts + who-has-me + pending token');

        AsyncStorage.getItem(PENDING_SOS_INVITE_KEY)
          .then(token => {
            console.log('[QA_SOS_INVITE] SOSContactsScreen check pending | token:', token ?? 'none');
            if (live) setPendingInviteToken(token);
          })
          .catch(() => {});

        AsyncStorage.getItem(PENDING_SOS_CONTACT_ADDED_KEY)
          .then(name => { if (live) setPendingContactAdded(name); })
          .catch(() => {});

        if (isFirst) { setLoading(true); setFetchError(false); }

        authFetch(`${API_BASE_URL}/api/v1/sos-contacts`)
          .then(r => {
            console.log('[QA_SOS] contacts response status:', r.status);
            return r.ok ? r.json() : Promise.reject(r.status);
          })
          .then((data: SOSContact[]) => {
            console.log('[QA_SOS] contacts loaded:', data.length, 'items'); // names deliberately not logged — PII
            if (live) setContacts(data);
          })
          .catch((err) => {
            console.log('[QA_SOS] contacts fetch error:', err);
            if (live && isFirst) setFetchError(true);
          })
          .finally(() => { if (live && isFirst) { setLoading(false); isFirst = false; } });

        authFetch(`${API_BASE_URL}/api/v1/sos-contacts/who-has-me`)
          .then(r => {
            console.log('[QA_SOS] who-has-me response status:', r.status);
            return r.ok ? r.json() : Promise.reject(r.status);
          })
          .then((data: WhoHasMeItem[]) => {
            console.log('[QA_SOS] who-has-me loaded:', data.length, 'items'); // names/phones deliberately not logged — PII
            if (live) setWhoHasMe(data);
          })
          .catch((err) => console.log('[QA_SOS] who-has-me fetch error:', err));
      }

      fetchAllRef.current = fetchAll;
      fetchAll();
      const interval = setInterval(fetchAll, 15000);
      return () => { live = false; fetchAllRef.current = () => {}; clearInterval(interval); };
    }, [])
  );

  // Re-check pending token when app returns to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        console.log('[QA_SOS_INVITE] AppState active → re-checking pending token');
        AsyncStorage.getItem(PENDING_SOS_INVITE_KEY)
          .then(token => setPendingInviteToken(token))
          .catch(() => {});
        AsyncStorage.getItem(PENDING_SOS_CONTACT_ADDED_KEY)
          .then(name => setPendingContactAdded(name))
          .catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  function openCreate() {
    console.log('[QA_SOS] modal open → CREATE');
    setEditingContact(null); setNameVal(""); setPhoneVal(""); setRelVal("");
    setFormError(null); setModalVisible(true);
  }
  function openEdit(c: SOSContact) {
    console.log('[QA_SOS] modal open → EDIT | id:', c.id, '| name:', c.name, '| rel:', c.relationship);
    setEditingContact(c); setNameVal(c.name); setPhoneVal(c.phone);
    setRelVal(c.relationship ?? ""); setFormError(null); setModalVisible(true);
  }
  function closeModal() {
    console.log('[QA_SOS] modal closed');
    setModalVisible(false); setFormError(null);
  }

  async function pickFromContacts() {
    console.log('[QA_SOS] pickFromContacts → requesting permission');
    const { status, canAskAgain } = await ExpoContacts.requestPermissionsAsync();
    console.log('[QA_SOS] contacts permission result | status:', status, '| canAskAgain:', canAskAgain);
    if (status !== "granted") {
      if (!canAskAgain) {
        console.log('[QA_SOS] permission permanently denied → showing Settings alert');
        Alert.alert(
          "Acceso a contactos",
          "Bluai necesita acceso a tus contactos para agregar contactos SOS fácilmente. Habilítalo en Configuración.",
          [
            { text: "Cancelar", style: "cancel" },
            { text: "Abrir Configuración", onPress: () => { console.log('[QA_SOS] user tapped Abrir Configuración'); Linking.openSettings(); } },
          ]
        );
      } else {
        console.log('[QA_SOS] permission denied by user (canAskAgain=true) → silent return');
      }
      return;
    }
    setLoadingContacts(true);
    try {
      const { data } = await ExpoContacts.getContactsAsync({
        fields: [ExpoContacts.Fields.PhoneNumbers, ExpoContacts.Fields.Name],
      });
      const withPhone = data.filter(c => c.phoneNumbers && c.phoneNumbers.length > 0);
      console.log('[QA_SOS] phone contacts loaded:', withPhone.length, 'with phone numbers');
      setPhoneContacts(withPhone);
      setContactSearch("");
      setPickerVisible(true);
    } catch (err) {
      console.log('[QA_SOS] getContactsAsync error:', err);
      Alert.alert("Error", "No se pudieron cargar los contactos. Intenta de nuevo.");
    } finally {
      setLoadingContacts(false);
    }
  }

  function selectPhoneContact(contact: ExpoContacts.Contact) {
    const fullName = (contact.name ?? "").trim();
    const phone = (contact.phoneNumbers?.[0]?.number ?? "").replace(/\s/g, "");
    console.log('[QA_SOS] contact selected from picker'); // name/phone deliberately not logged — PII
    setNameVal(fullName);
    setPhoneVal(phone);
    setPickerVisible(false);
    setFormError(null);
  }

  async function handleSave() {
    const n = nameVal.trim(), p = phoneVal.trim(), r = relVal.trim();
    console.log('[QA_SOS] handleSave | editing:', editingContact?.id ?? null); // name/phone/rel deliberately not logged — PII
    if (!n || !p) {
      console.log('[QA_SOS] validation failed: name or phone empty');
      return setFormError("Nombre y teléfono son obligatorios.");
    }
    if (p.length < 5) {
      console.log('[QA_SOS] validation failed: phone too short');
      return setFormError("El teléfono debe tener al menos 5 caracteres.");
    }

    setSaving(true); setFormError(null);
    const body = { name: n, phone: p, ...(r ? { relationship: r } : {}) };
    const url = editingContact
      ? `${API_BASE_URL}/api/v1/sos-contacts/${editingContact.id}`
      : `${API_BASE_URL}/api/v1/sos-contacts`;
    const method = editingContact ? "PATCH" : "POST";
    console.log('[QA_SOS] saving contact | method:', method); // body deliberately not logged — contains phone
    try {
      const res = await authFetch(url, { method, body: JSON.stringify(body) });
      console.log('[QA_SOS] save response status:', res.status);
      if (!res.ok) throw new Error(String(res.status));
      const saved: SOSContact = await res.json();
      console.log('[QA_SOS] contact saved:', JSON.stringify({ id: saved.id, link_status: saved.link_status })); // name deliberately not logged — PII
      setContacts(prev =>
        editingContact ? prev.map(c => c.id === saved.id ? saved : c) : [...prev, saved]
      );
      closeModal();
    } catch (err) {
      console.log('[QA_SOS] save error:', err, '→ refetching to check if server saved anyway');
      authFetch(`${API_BASE_URL}/api/v1/sos-contacts`)
        .then(r => r.ok ? r.json() : null)
        .then((data: SOSContact[] | null) => { if (data) { setContacts(data); closeModal(); return; } })
        .catch(() => {});
      setFormError("Error de red. Verifica tu conexión e intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(c: SOSContact) {
    Alert.alert("Eliminar contacto", `¿Eliminar a ${c.name}?`, [
      { text: "Cancelar", style: "cancel" },
      { text: "Eliminar", style: "destructive", onPress: () => handleDelete(c) },
    ]);
  }

  async function handleDelete(c: SOSContact) {
    console.log('[QA_SOS] deleting contact id:', c.id, 'name:', c.name);
    try {
      const res = await authFetch(`${API_BASE_URL}/api/v1/sos-contacts/${c.id}`, { method: "DELETE" });
      console.log('[QA_SOS] delete response status:', res.status);
      if (!res.ok) throw new Error(String(res.status));
      setContacts(prev => prev.filter(x => x.id !== c.id));
      console.log('[QA_SOS] contact deleted successfully');
    } catch (err) {
      console.log('[QA_SOS] delete error:', err);
      Alert.alert("Error", "No se pudo eliminar el contacto. Intenta de nuevo.");
    }
  }

  async function handleAddReciprocal(item: WhoHasMeItem) {
    console.log('[QA_SOS] adding reciprocal contact | owner_user_id:', item.owner_user_id); // name deliberately not logged — PII
    setAddingReciprocal(item.owner_user_id);
    try {
      const res = await authFetch(`${API_BASE_URL}/api/v1/sos-contacts/reciprocate/${item.owner_user_id}`, { method: "POST" });
      console.log('[QA_SOS] reciprocal response status:', res.status);
      if (res.status === 409) {
        toast("Ya es tu contacto SOS");
        setWhoHasMe(prev => prev.map(w => w.owner_user_id === item.owner_user_id ? { ...w, already_my_contact: true } : w));
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const saved: SOSContact = await res.json();
      console.log('[QA_SOS] reciprocal added:', JSON.stringify({ id: saved.id })); // name deliberately not logged — PII
      setContacts(prev => [...prev, saved]);
      setWhoHasMe(prev => prev.map(w => w.owner_user_id === item.owner_user_id ? { ...w, already_my_contact: true } : w));
      toast.success(`${item.owner_display_name ?? item.name} agregado a tus contactos SOS`);
    } catch (err) {
      console.log('[QA_SOS] reciprocal error:', err);
      Alert.alert("Error", "No se pudo agregar el contacto. Intenta de nuevo.");
    } finally {
      setAddingReciprocal(null);
    }
  }

  async function handleInvite(c: SOSContact) {
    console.log('[QA_SOS] sending invite for contact id:', c.id); // name deliberately not logged — PII
    try {
      const res = await authFetch(`${API_BASE_URL}/api/v1/sos-contacts/${c.id}/invite`, { method: "POST" });
      console.log('[QA_SOS] invite response status:', res.status);
      if (!res.ok) throw new Error(String(res.status));
      const { share_url, push_sent } = await res.json();
      console.log('[QA_SOS] invite result | push_sent:', push_sent); // share_url deliberately not logged — equivalent to a bearer token
      setContacts(prev => prev.map(x => x.id === c.id ? { ...x, link_status: "invite_sent" } : x));
      if (push_sent) {
        toast.success("Notificación enviada", {
          description: `${c.name} recibirá una notificación para aceptar la invitación.`,
        });
      } else {
        await Share.share({
          message: `Te invito a ser mi contacto SOS de emergencia en Bluai.\nToca aquí para aceptar: ${share_url}`,
        });
      }
    } catch {
      Alert.alert("Error", "No se pudo generar la invitación. Intenta de nuevo.");
    }
  }

  if (loading) return (
    <SafeAreaView className="flex-1 bg-transparent" edges={["top", "bottom"]}>
      <ScreenHeader title="Contactos SOS" />
      <View style={s.centered}><View style={s.card}>
        <ActivityIndicator size="large" color={colors.brandCyan} />
      </View></View>
    </SafeAreaView>
  );

  if (fetchError) return (
    <SafeAreaView className="flex-1 bg-transparent" edges={["top", "bottom"]}>
      <ScreenHeader title="Contactos SOS" />
      <View style={s.centered}><View style={s.card}>
        <Text style={s.bodyText}>Error al cargar contactos. Intenta de nuevo.</Text>
      </View></View>
    </SafeAreaView>
  );

  const whoHasMeSection = whoHasMe.length > 0 ? (
    <View style={{ paddingBottom: 24, paddingHorizontal: 16 }}>
      <Text style={s.sectionTitle}>Soy contacto SOS de</Text>
      {whoHasMe.map((item, idx) => {
        const isAdding = addingReciprocal === item.owner_user_id;
        const isAdded  = item.already_my_contact;
        return (
          <View key={idx} style={s.whoRow}>
            <MaterialCommunityIcons name="shield-account-outline" size={32} color={colors.brandCyan} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.contactName}>{item.owner_display_name ?? item.name}</Text>
              {item.relationship ? <Text style={s.contactRel}>{item.relationship}</Text> : null}
            </View>
            {isAdded ? (
              <MaterialCommunityIcons name="check-circle-outline" size={24} color={colors.brandGreen} />
            ) : (
              <Pressable
                onPress={() => handleAddReciprocal(item)}
                disabled={isAdding}
                hitSlop={8}
                accessibilityLabel="Agregar como mi contacto SOS"
              >
                {isAdding
                  ? <ActivityIndicator size="small" color={colors.brandCyan} />
                  : <MaterialCommunityIcons name="account-plus-outline" size={24} color={colors.brandCyan} />}
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  ) : null;

  return (
    <SafeAreaView className="flex-1 bg-transparent" edges={["top", "bottom"]}>
      <ScreenHeader title="Contactos SOS" />

      {pendingInviteToken && (
        <TouchableOpacity
          style={s.inviteBanner}
          onPress={() => {
            console.log('[QA_SOS_INVITE] banner tap → sos-invite | token:', pendingInviteToken);
            router.push({ pathname: "/sos-invite/[token]", params: { token: pendingInviteToken } });
          }}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="shield-account-outline" size={22} color="#030810" />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={s.inviteBannerTitle}>Tienes una invitación SOS pendiente</Text>
            <Text style={s.inviteBannerSub}>Toca para ver y aceptar</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color="#030810" />
        </TouchableOpacity>
      )}

      {pendingContactAdded && (
        <View style={s.inviteBanner}>
          <MaterialCommunityIcons name="account-check-outline" size={22} color="#030810" />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={s.inviteBannerTitle}>{pendingContactAdded} te agregó como contacto SOS</Text>
            <Text style={s.inviteBannerSub}>Ya son contactos mutuos</Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              console.log('[QA_SOS] dismiss contact_added banner');
              AsyncStorage.removeItem(PENDING_SOS_CONTACT_ADDED_KEY).catch(() => {});
              setPendingContactAdded(null);
            }}
            hitSlop={12}
          >
            <MaterialCommunityIcons name="close" size={20} color="#030810" />
          </TouchableOpacity>
        </View>
      )}

      {contacts.length === 0 ? (
        <FlatList
          data={[]}
          renderItem={null}
          ListEmptyComponent={
            <View style={[s.centered, { paddingTop: 40 }]}>
              <View style={s.card}>
                <MaterialCommunityIcons name="account-heart-outline" size={48} color={colors.brandCyan} />
                <Text style={[s.title, { marginTop: 12, marginBottom: 6 }]}>Sin contactos SOS</Text>
                <Text style={[s.bodyText, { textAlign: "center", marginBottom: 20 }]}>
                  Agrega personas de confianza que recibirán tu alerta en caso de emergencia.
                </Text>
                <TouchableOpacity style={s.cyanButton} onPress={openCreate}>
                  <Text style={s.cyanButtonText}>Agregar contacto</Text>
                </TouchableOpacity>
              </View>
            </View>
          }
          ListFooterComponent={whoHasMeSection}
          contentContainerStyle={{ flexGrow: 1 }}
        />
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            data={contacts}
            keyExtractor={item => String(item.id)}
            contentContainerStyle={{ paddingTop: 16, paddingBottom: 100 }}
            ListFooterComponent={whoHasMeSection}
            renderItem={({ item }) => (
              <View style={s.contactRow}>
                <MaterialCommunityIcons name="account-circle-outline" size={36} color={colors.brandCyan} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.contactName}>{item.name}</Text>
                  <Text style={s.contactPhone}>{item.phone}</Text>
                  {item.relationship
                    ? <Text style={s.contactRel}>{item.relationship}</Text>
                    : null}
                  {item.link_status === "linked" && (
                    <Text style={s.linkedBadge}>✓ Vinculado</Text>
                  )}
                  {item.link_status === "invite_sent" && (
                    <Text style={s.pendingBadge}>Invitación enviada</Text>
                  )}
                </View>
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  {item.link_status !== "linked" && (
                    <Pressable onPress={() => handleInvite(item)} hitSlop={8}
                      accessibilityLabel={item.link_status === "invite_sent" ? "Reenviar invitación" : "Invitar"}>
                      <MaterialCommunityIcons
                        name={item.link_status === "invite_sent" ? "email-sync-outline" : "share-outline"}
                        size={22} color={colors.brandCyan} />
                    </Pressable>
                  )}
                  <Pressable onPress={() => openEdit(item)} hitSlop={8} accessibilityLabel="Editar">
                    <MaterialCommunityIcons name="pencil-outline" size={22} color="rgba(255,255,255,0.55)" />
                  </Pressable>
                  <Pressable onPress={() => confirmDelete(item)} hitSlop={8} accessibilityLabel="Eliminar">
                    <MaterialCommunityIcons name="trash-can-outline" size={22} color={colors.brandRed} />
                  </Pressable>
                </View>
              </View>
            )}
          />
          <Pressable style={s.fab} onPress={openCreate} accessibilityLabel="Agregar contacto">
            <MaterialCommunityIcons name="plus" size={28} color="white" />
          </Pressable>
        </View>
      )}

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={closeModal}>
        <KeyboardAvoidingView
          style={s.overlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>
              {editingContact ? "Editar contacto" : "Nuevo contacto SOS"}
            </Text>

            {!editingContact && (
              <TouchableOpacity
                style={s.importButton}
                onPress={pickFromContacts}
                disabled={loadingContacts}
              >
                {loadingContacts
                  ? <ActivityIndicator size="small" color={colors.brandCyan} />
                  : <MaterialCommunityIcons name="contacts-outline" size={18} color={colors.brandCyan} />}
                <Text style={s.importButtonText}>
                  {loadingContacts ? "Cargando contactos…" : "Importar desde mis contactos"}
                </Text>
              </TouchableOpacity>
            )}

            <Text style={s.inputLabel}>Nombre *</Text>
            <TextInput style={s.input} placeholder="Ej. Mamá"
              placeholderTextColor="rgba(255,255,255,0.3)" value={nameVal} maxLength={100}
              onChangeText={v => { setNameVal(v); setFormError(null); }} autoCapitalize="words" />

            <Text style={s.inputLabel}>Teléfono *</Text>
            <TextInput style={s.input} placeholder="Ej. +52 999 123 4567"
              placeholderTextColor="rgba(255,255,255,0.3)" value={phoneVal} maxLength={30}
              onChangeText={v => { setPhoneVal(v); setFormError(null); }} keyboardType="phone-pad" />

            <Text style={s.inputLabel}>Relación (opcional)</Text>
            <View style={s.chipsRow}>
              {["Mamá", "Papá", "Hijo/a", "Hermano/a", "Pareja", "Amigo/a", "Otro"].map(chip => {
                const isOtro = chip === "Otro";
                const isSelected = isOtro
                  ? (!!relVal && !["Mamá","Papá","Hijo/a","Hermano/a","Pareja","Amigo/a"].includes(relVal))
                  : relVal === chip;
                return (
                  <TouchableOpacity
                    key={chip}
                    style={[s.chip, isSelected && s.chipSelected]}
                    onPress={() => {
                      setFormError(null);
                      if (isOtro) {
                        if (!isSelected) {
                          console.log('[QA_SOS] chip selected: Otro → showing text input');
                          setRelVal(" ");
                        } else {
                          console.log('[QA_SOS] chip deselected: Otro');
                          setRelVal("");
                        }
                      } else {
                        const next = isSelected ? "" : chip;
                        console.log('[QA_SOS] chip', isSelected ? 'deselected' : 'selected', ':', chip, '→ relVal:', next || '(empty)');
                        setRelVal(next);
                      }
                    }}
                  >
                    <Text style={[s.chipText, isSelected && s.chipTextSelected]}>{chip}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {!!relVal && !["Mamá","Papá","Hijo/a","Hermano/a","Pareja","Amigo/a"].includes(relVal) && (
              <TextInput style={[s.input, { marginTop: 8 }]} placeholder="¿Cuál relación?"
                placeholderTextColor="rgba(255,255,255,0.3)" value={relVal.trim()} maxLength={60}
                onChangeText={v => { setRelVal(v); setFormError(null); }} autoCapitalize="sentences"
                autoFocus />
            )}

            {formError ? <Text style={s.formError}>{formError}</Text> : null}

            <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
              <TouchableOpacity style={s.cancelButton} onPress={closeModal} disabled={saving}>
                <Text style={s.cancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.cyanButton, { flex: 1, opacity: saving ? 0.6 : 1 }]}
                onPress={handleSave} disabled={saving}>
                {saving
                  ? <ActivityIndicator size="small" color="#030810" />
                  : <Text style={s.cyanButtonText}>Guardar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* Contact picker modal */}
      <Modal visible={pickerVisible} animationType="slide" transparent onRequestClose={() => setPickerVisible(false)}>
        <View style={s.overlay}>
          <View style={[s.modalCard, { flex: 0, maxHeight: "80%" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
              <Text style={[s.modalTitle, { flex: 1, marginBottom: 0 }]}>Seleccionar contacto</Text>
              <TouchableOpacity onPress={() => setPickerVisible(false)} hitSlop={10}>
                <MaterialCommunityIcons name="close" size={22} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={[s.input, { marginBottom: 8 }]}
              placeholder="Buscar por nombre o teléfono…"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={contactSearch}
              onChangeText={setContactSearch}
              autoFocus
              clearButtonMode="while-editing"
            />

            <FlatList
              data={phoneContacts.filter(c => {
                const q = contactSearch.toLowerCase();
                if (!q) return true;
                return (c.name ?? "").toLowerCase().includes(q) ||
                  c.phoneNumbers?.some(p => p.number?.includes(q));
              })}
              keyExtractor={(_, i) => String(i)}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: 400 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.pickerRow}
                  onPress={() => selectPhoneContact(item)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="account-outline" size={22} color={colors.brandCyan} style={{ marginRight: 10 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.pickerName}>{item.name || "Sin nombre"}</Text>
                    {item.phoneNumbers?.slice(0, 2).map((p, i) => (
                      <Text key={i} style={s.pickerPhone}>{p.number}</Text>
                    ))}
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={[s.bodyText, { textAlign: "center", marginTop: 20 }]}>
                  {contactSearch ? "Sin resultados" : "No hay contactos con teléfono"}
                </Text>
              }
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  centered:     { justifyContent: "center", alignItems: "center", paddingHorizontal: 24 },
  card:         { backgroundColor: "rgba(10,28,50,0.6)", borderRadius: 16, borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.1)", padding: 24, width: "100%", alignItems: "center" },
  title:        { color: "white", fontFamily: fonts.poppinsSemiBold, fontSize: 17 },
  bodyText:     { color: "rgba(255,255,255,0.55)", fontFamily: fonts.poppins, fontSize: 13, lineHeight: 20 },
  cyanButton:   { backgroundColor: colors.brandCyan, borderRadius: 12,
                  paddingVertical: 13, paddingHorizontal: 24, alignItems: "center" },
  cyanButtonText: { color: "#030810", fontFamily: fonts.poppinsSemiBold, fontSize: 15 },
  sectionTitle: { color: "rgba(255,255,255,0.5)", fontFamily: fonts.poppins, fontSize: 12,
                  letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8, marginTop: 16 },
  contactRow:   { backgroundColor: "rgba(10,28,50,0.6)", borderRadius: 14, borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.08)", marginHorizontal: 16, marginBottom: 10,
                  padding: 14, flexDirection: "row", alignItems: "center" },
  whoRow:       { backgroundColor: "rgba(10,28,50,0.4)", borderRadius: 14, borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.06)", marginBottom: 10,
                  padding: 14, flexDirection: "row", alignItems: "center" },
  contactName:  { color: "white", fontFamily: fonts.poppinsSemiBold, fontSize: 15 },
  contactPhone: { color: "rgba(255,255,255,0.6)", fontFamily: fonts.poppins, fontSize: 13, marginTop: 2 },
  contactRel:   { color: colors.brandCyan, fontFamily: fonts.poppins, fontSize: 12, marginTop: 2 },
  fab:          { position: "absolute", bottom: 24, right: 24, backgroundColor: colors.brandCyan,
                  width: 56, height: 56, borderRadius: 28, justifyContent: "center", alignItems: "center",
                  elevation: 8, shadowColor: colors.brandCyan, shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.4, shadowRadius: 8 },
  overlay:      { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalCard:    { backgroundColor: "#0c2438", borderTopLeftRadius: 24, borderTopRightRadius: 24,
                  borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", padding: 24, paddingBottom: 36 },
  modalTitle:   { color: "white", fontFamily: fonts.poppinsSemiBold, fontSize: 18,
                  marginBottom: 20, textAlign: "center" },
  inputLabel:   { color: "rgba(255,255,255,0.5)", fontFamily: fonts.poppins, fontSize: 11,
                  letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 },
  input:        { backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 10, borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.12)", color: "white", fontFamily: fonts.poppins,
                  fontSize: 15, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 },
  formError:    { color: colors.brandRed, fontFamily: fonts.poppins, fontSize: 13,
                  marginBottom: 12, textAlign: "center" },
  cancelButton: { flex: 1, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
                  borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  cancelText:   { color: "rgba(255,255,255,0.7)", fontFamily: fonts.poppinsSemiBold, fontSize: 15 },
  linkedBadge:      { color: colors.brandGreen, fontFamily: fonts.poppins, fontSize: 11, marginTop: 2 },
  pendingBadge:     { color: colors.brandYellow, fontFamily: fonts.poppins, fontSize: 11, marginTop: 2 },
  inviteBanner:     { backgroundColor: colors.brandCyan, borderRadius: 14, marginHorizontal: 16,
                      marginTop: 12, marginBottom: 4, padding: 14, flexDirection: "row",
                      alignItems: "center" },
  inviteBannerTitle:{ color: "#030810", fontFamily: fonts.poppinsSemiBold, fontSize: 14 },
  inviteBannerSub:  { color: "#030810", fontFamily: fonts.poppins, fontSize: 12, opacity: 0.7, marginTop: 1 },
  importButton:     { flexDirection: "row", alignItems: "center", justifyContent: "center",
                      borderWidth: 1, borderColor: colors.brandCyan, borderRadius: 10,
                      paddingVertical: 10, paddingHorizontal: 14, marginBottom: 16, gap: 8 },
  importButtonText: { color: colors.brandCyan, fontFamily: fonts.poppinsSemiBold, fontSize: 14 },
  pickerRow:        { flexDirection: "row", alignItems: "center", paddingVertical: 12,
                      borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.07)" },
  pickerName:       { color: "white", fontFamily: fonts.poppinsSemiBold, fontSize: 14 },
  pickerPhone:      { color: "rgba(255,255,255,0.5)", fontFamily: fonts.poppins, fontSize: 13, marginTop: 1 },
  chipsRow:         { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip:             { borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", borderRadius: 20,
                      paddingVertical: 7, paddingHorizontal: 14 },
  chipSelected:     { backgroundColor: colors.brandCyan, borderColor: colors.brandCyan },
  chipText:         { color: "rgba(255,255,255,0.7)", fontFamily: fonts.poppins, fontSize: 13 },
  chipTextSelected: { color: "#030810", fontFamily: fonts.poppinsSemiBold },
});
