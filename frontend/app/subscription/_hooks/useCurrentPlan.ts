import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getSubscription } from '../_services/subscriptionService';
import { getCurrentPlanSlug, type PlanSlug } from '../_utils/planAccess';
import { PAYMENTS_ENABLED } from '../../../utils/platformFeatures';

/** Revalidate on navigation and on returning from a browser payment. */
export function useCurrentPlan(): PlanSlug {
  const [plan, setPlan] = useState<PlanSlug>('free');
  useFocusEffect(useCallback(() => {
    if (!PAYMENTS_ENABLED) return;
    let active = true;
    let sequence = 0;
    async function refresh() {
      const request = ++sequence;
      try {
        const subscription = await getSubscription();
        if (active && request === sequence) setPlan(getCurrentPlanSlug(subscription));
      } catch {
        if (active && request === sequence) setPlan('free');
      }
    }
    void refresh();
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => { active = false; listener.remove(); };
  }, []));
  return plan;
}
