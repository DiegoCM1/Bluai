const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

test('focused screens refresh access on app resume and stop after leaving', async () => {
  let plan = 'safe';
  let listener;
  let cleanup;
  let removed = false;
  const updates = [];
  const mocks = {
    react: { useCallback: callback => callback, useState: initial => [initial, value => updates.push(value)] },
    'react-native': { AppState: { addEventListener: (_, callback) => {
      listener = callback;
      return { remove: () => { removed = true; } };
    } } },
    'expo-router': { useFocusEffect: callback => { cleanup = callback(); } },
    '../_services/subscriptionService': { getSubscription: async () => ({ planSlug: plan }) },
    '../_utils/planAccess': { getCurrentPlanSlug: subscription => subscription.planSlug },
  };
  const source = fs.readFileSync(path.join(__dirname, '../app/subscription/_hooks/useCurrentPlan.ts'), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {}, require: name => mocks[name] };
  vm.runInNewContext(output, context);
  assert.equal(context.exports.useCurrentPlan(), 'free');
  await new Promise(setImmediate);
  assert.equal(updates.at(-1), 'safe');
  plan = 'guard';
  listener('active');
  await new Promise(setImmediate);
  assert.equal(updates.at(-1), 'guard');
  listener('active');
  cleanup();
  await new Promise(setImmediate);
  assert.equal(removed, true);
  assert.equal(updates.length, 2);
});
