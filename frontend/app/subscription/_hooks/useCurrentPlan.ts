import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getSubscription } from '../_services/subscriptionService';
import { peekCachedPlan, readCachedPlan, writeCachedPlan } from '../_services/planCache';
import { getCurrentPlanSlug, type PlanSlug } from '../_utils/planAccess';
import { PAYMENTS_ENABLED } from '../../../utils/platformFeatures';

/**
 * Revalidate on navigation and on returning from a browser payment.
 *
 * Offline-safe: shows the last server-confirmed plan immediately and keeps it
 * when the request fails, instead of dropping to 'free' — the Bluetooth chat
 * this gates is meant for when there's no internet. See planCache.ts.
 */
export function useCurrentPlan(): PlanSlug {
  const [plan, setPlan] = useState<PlanSlug>(() => peekCachedPlan() ?? 'free');
  useFocusEffect(useCallback(() => {
    if (!PAYMENTS_ENABLED) return;
    let active = true;
    let sequence = 0;
    async function refresh() {
      const request = ++sequence;
      const isCurrent = () => active && request === sequence;
      const cached = await readCachedPlan();
      if (cached && isCurrent()) setPlan(cached);
      try {
        const next = getCurrentPlanSlug(await getSubscription());
        void writeCachedPlan(next);
        if (isCurrent()) setPlan(next);
      } catch {
        // Network down or server error: keep the last confirmed plan.
        if (isCurrent()) setPlan(cached ?? 'free');
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
