const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Loads useAdsEligibility with its dependencies mocked, the same way
// membership-refresh.test.cjs loads useCurrentPlan.
function loadHook({ adsEnabled = true, sdkReady = true, plan = 'free', fetchFails = false } = {}) {
  const state = { plan, fetchFails, fetches: 0, listener: null, cleanup: undefined, removed: false, updates: [] };
  const mocks = {
    react: { useCallback: callback => callback, useState: initial => [initial, value => state.updates.push(value)] },
    'react-native': { AppState: { addEventListener: (_, callback) => {
      state.listener = callback;
      return { remove: () => { state.removed = true; } };
    } } },
    'expo-router': { useFocusEffect: callback => { state.cleanup = callback(); } },
    '../../app/subscription/_services/subscriptionService': { getSubscription: async () => {
      state.fetches += 1;
      if (state.fetchFails) throw new Error('network');
      return { planSlug: state.plan };
    } },
    '../../app/subscription/_utils/planAccess': { getCurrentPlanSlug: subscription => subscription.planSlug },
    '../../utils/platformFeatures': { ADS_ENABLED: adsEnabled },
    './adsService': { initAds: async () => sdkReady },
  };
  const source = fs.readFileSync(path.join(__dirname, '../features/ads/useAdsEligibility.ts'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {}, require: name => mocks[name] };
  vm.runInNewContext(output, context);
  return { useAdsEligibility: context.exports.useAdsEligibility, state };
}

const settle = () => new Promise(setImmediate);

test('free plan shows ads, but only after the plan has loaded', async () => {
  const { useAdsEligibility, state } = loadHook({ plan: 'free' });
  assert.equal(useAdsEligibility(), 'unknown');
  await settle();
  assert.deepEqual(state.updates, ['show']);
});

test('paid plans never show ads', async () => {
  for (const plan of ['safe', 'guard', 'edu']) {
    const { useAdsEligibility, state } = loadHook({ plan });
    assert.equal(useAdsEligibility(), 'unknown');
    await settle();
    assert.deepEqual(state.updates, ['hide'], plan);
  }
});

test('fails closed when the plan cannot be fetched or the SDK did not start', async () => {
  const offline = loadHook({ fetchFails: true });
  offline.useAdsEligibility();
  await settle();
  assert.deepEqual(offline.state.updates, ['hide']);

  const noSdk = loadHook({ sdkReady: false });
  noSdk.useAdsEligibility();
  await settle();
  assert.deepEqual(noSdk.state.updates, ['hide']);
});

test('buying on the website removes the banner on the next app resume', async () => {
  const { useAdsEligibility, state } = loadHook({ plan: 'free' });
  useAdsEligibility();
  await settle();
  state.plan = 'safe';
  state.listener('active');
  await settle();
  assert.deepEqual(state.updates, ['show', 'hide']);
  state.cleanup();
  assert.equal(state.removed, true);
});

test('iOS hides ads without ever fetching the plan', async () => {
  const { useAdsEligibility, state } = loadHook({ adsEnabled: false });
  assert.equal(useAdsEligibility(), 'hide');
  await settle();
  assert.equal(state.fetches, 0);
  assert.equal(state.listener, null);
  assert.deepEqual(state.updates, []);
});
