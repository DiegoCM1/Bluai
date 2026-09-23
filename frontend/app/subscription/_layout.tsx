import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';
import { track } from '../../utils/analytics';
import { PAYMENTS_ENABLED } from '../../utils/platformFeatures';

/**
 * Subscription layout with Stack navigator
 * Handles subscription flow screens
 */
export default function SubscriptionLayout() {
  useEffect(() => {
    if (!PAYMENTS_ENABLED) return;
    track('subscription_section_entered');
  }, []);

  // Guarding at the layout covers every child route AND every deep link in one
  // place: expo-router is file-based, so `/subscription` and
  // `blueye://subscription` stay live as long as the files exist. Removing the
  // menu entry alone would leave both reachable.
  //
  // The return sits BELOW the effect on purpose — an early return above a hook
  // is what broke SOSContactsScreen. PAYMENTS_ENABLED is a build-time constant
  // so the branch never flips at runtime, but the ordering is the habit worth
  // keeping.
  if (!PAYMENTS_ENABLED) {
    return <Redirect href="/(tabs)/MoreScreen" />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: 'transparent' },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="manage" />
    </Stack>
  );
}
