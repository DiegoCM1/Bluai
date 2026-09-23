import React, { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import OptionCard from "../../components/OptionCard";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { TourProvider } from "../../features/tour/TourProvider";
import { TourAnchor } from "../../features/tour/TourAnchor";
import { moreTourSteps } from "../../features/tour/moreTourSteps";
import { MORE_TOUR_ROUTES, TOUR_IDS } from "../../features/tour/constants";
import { useTourGate } from "../../features/tour/useTourGate";
import { tourWarn } from "../../features/tour/tourLog";
import { getSubscription } from "../subscription/_services/subscriptionService";
import { canAccessFeature, getCurrentPlanSlug, type PlanSlug } from "../subscription/_utils/planAccess";
import { LOCAL_CHAT_ENABLED, PAYMENTS_ENABLED } from "../../utils/platformFeatures";

const IS_DEV_BUILD =
  (process.env.EXPO_PUBLIC_API_URL ?? "").includes("staging") ||
  (process.env.EXPO_PUBLIC_API_URL ?? "").includes("localhost") ||
  (process.env.EXPO_PUBLIC_API_URL ?? "").includes("192.168") ||
  __DEV__;

type MenuItem = {
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  route: string;
  subtitle?: string;
};

/**
 * `OptionCard` carries its own margins (`mt-4 mx-4`), so a bare wrapper's box is
 * taller and wider than the visible card. Trimming by the same amounts keeps the
 * spotlight hugging the card instead of the whitespace around it.
 */
const CARD_MARGIN = { top: 16, left: 16, right: 16 };

export default function MoreScreen() {
  // Nested inside the map tour's provider, which is fine: the inner context
  // wins for this subtree, both tours are gated so they never run at once, and
  // an idle overlay renders nothing. The offset calibration is inherited from
  // the ancestor rather than re-measured (see useMeasureOffset).
  return (
    <TourProvider tourId={TOUR_IDS.more} steps={moreTourSteps}>
      <MoreScreenContent />
    </TourProvider>
  );
}

function MoreScreenContent() {
  const [currentPlan, setCurrentPlan] = useState<PlanSlug>("free");

  useEffect(() => {
    // With no purchase surface the plan can't change what this menu renders,
    // so skip the round trip rather than fetching a value we'd ignore.
    if (!PAYMENTS_ENABLED) return;
    getSubscription()
      .then((subscription) => setCurrentPlan(getCurrentPlanSlug(subscription)))
      .catch(() => setCurrentPlan("free"));
  }, []);

  const hasFamilyPanic = canAccessFeature(currentPlan, "family_panic");
  const hasBluetooth = canAccessFeature(currentPlan, "bluetooth");

  const items: MenuItem[] = [
    { label: "Mi Perfil", icon: "account-circle-outline", route: "/profile" },
    ...(LOCAL_CHAT_ENABLED
      ? [
          {
            label: "Chat offline",
            icon: "access-point-network" as const,
            route: "/local-chat",
            subtitle: hasBluetooth
              ? "Bluetooth disponible con tu plan actual"
              : "Requiere Safe o Guard",
          },
        ]
      : []),
    {
      label: "Contactos SOS",
      icon: "account-heart-outline",
      route: "/SOSContactsScreen",
      // Plan wording only makes sense where a plan can be bought. With payments
      // off every feature is unlocked, so a subtitle would advertise a tier
      // this build doesn't sell.
      ...(PAYMENTS_ENABLED
        ? {
            subtitle: hasFamilyPanic
              ? "Disponible con tu plan actual"
              : "Requiere Safe o Guard",
          }
        : {}),
    },
    { label: "Feedback", icon: "message-reply-outline", route: "/FeedbackScreen" },
    { label: "Ajustes", icon: "cog-outline", route: "/SettingsScreen" },
    ...(PAYMENTS_ENABLED
      ? [
          {
            label: "Suscripcion",
            icon: "account-group-outline" as const,
            route: "/subscription",
          },
        ]
      : []),
    ...(IS_DEV_BUILD
      ? [
          {
            label: "Dev: Notificaciones",
            icon: "bell-ring-outline" as const,
            route: "/NotificationTestScreen",
          },
        ]
      : []),
  ];

  // No intro card: the user chose to open this screen, so the tour can start
  // straight away rather than asking permission twice.
  useTourGate({ tourId: TOUR_IDS.more });

  // The steps array and this screen's items are coupled only by route string.
  // That's deliberate (a renamed route should not silently re-point a bubble at
  // the wrong card) but it means the coupling can break with no runtime error:
  // a step with no anchor renders an INVISIBLE tooltip over a dimmed screen.
  // Fail loudly instead.
  useEffect(() => {
    if (!__DEV__) return;
    const routes = new Set(items.map((i) => i.route));
    for (const route of Object.keys(MORE_TOUR_ROUTES)) {
      if (!routes.has(route)) {
        tourWarn(
          `MORE_TOUR_ROUTES points at "${route}", which is not in MoreScreen's items. ` +
            `Step ${MORE_TOUR_ROUTES[route]} will have no anchor and will render an ` +
            `invisible tooltip. Update MORE_TOUR_ROUTES in features/tour/constants.ts.`,
        );
      }
    }
    const covered = new Set(Object.values(MORE_TOUR_ROUTES));
    for (let i = 0; i < moreTourSteps.length; i++) {
      if (!covered.has(i)) {
        tourWarn(
          `moreTourSteps[${i}] has no anchor in MoreScreen — it will render an ` +
            `invisible tooltip. Add its route to MORE_TOUR_ROUTES.`,
        );
      }
    }
    // items is rebuilt each render but its route set is build-time constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView
      edges={["top", "left", "right", "bottom"]}
      className="flex-1 bg-transparent"
    >
      <ScrollView className="flex-1 pt-6" showsVerticalScrollIndicator={false}>
        {items.map((item) => {
          const stepIndex = MORE_TOUR_ROUTES[item.route];
          const card = (
            <OptionCard
              title={item.label}
              subtitle={item.subtitle}
              icon={item.icon}
              route={item.route}
            />
          );

          // Untargeted cards render exactly as before — no wrapper, no cost.
          if (stepIndex === undefined) {
            return <React.Fragment key={item.route}>{card}</React.Fragment>;
          }

          // Keyed off `item.route`, never an array index: this list is built
          // conditionally (IS_DEV_BUILD, the commented-out Suscripción entry),
          // so a positional reference could silently drift.
          return (
            <View key={item.route}>
              {card}
              <TourAnchor index={stepIndex} fill inset={CARD_MARGIN} />
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
