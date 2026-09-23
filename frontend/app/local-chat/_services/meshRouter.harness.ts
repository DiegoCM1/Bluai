// In-memory N-node mesh simulation — no radio, no test framework.
// Run with: npx tsx app/local-chat/_services/meshRouter.harness.ts
//
// Why this exists (see docs/specs_july05/val_sprint_3.md "Tests"): debugging
// flooding behavior on physical phones is miserable; debugging it as a graph
// simulation is trivial. These 4 invariants are the safety net to check
// *before* ever touching hardware — if they're green here, hardware bugs are
// transport (Capa 1), not routing logic (Capa 2).
//
// Topology is a plain adjacency list (who hears whom). A node's `send`
// reaches only its direct neighbors in the graph; each neighbor's router may
// relay to *its* neighbors, and so on — that's how a hop is simulated
// without a radio.

import { createMeshRouter } from "./meshRouter";
import type { Envelope } from "./protocol";

type Adjacency = Record<string, string[]>;

interface SimNode {
  id: string;
  delivered: Envelope[];
  sendCounts: Map<string, number>; // neighborId -> times we pushed a payload to it
  router: ReturnType<typeof createMeshRouter>;
}

interface QueueItem {
  to: string;
  from: string;
  raw: string;
}

function buildNetwork(adjacency: Adjacency) {
  const queue: QueueItem[] = [];
  const nodes = new Map<string, SimNode>();

  for (const id of Object.keys(adjacency)) {
    const delivered: Envelope[] = [];
    const sendCounts = new Map<string, number>();
    const router = createMeshRouter(id, {
      sendToAllExcept: (raw, exceptPeerHandle) => {
        for (const neighborId of adjacency[id] ?? []) {
          if (neighborId === exceptPeerHandle) continue;
          sendCounts.set(neighborId, (sendCounts.get(neighborId) ?? 0) + 1);
          queue.push({ to: neighborId, from: id, raw });
        }
      },
      onDeliver: (env) => {
        delivered.push(env);
      },
    });
    nodes.set(id, { id, delivered, sendCounts, router });
  }

  function pump(): void {
    let guard = 0;
    while (queue.length > 0) {
      if (++guard > 10_000) {
        throw new Error(
          "pump() exceeded 10,000 iterations — likely an infinite flood (dedup broken?)",
        );
      }
      const item = queue.shift()!;
      nodes.get(item.to)?.router.onPayload(item.from, item.raw);
    }
  }

  return { nodes, pump };
}

// --- tiny assertion helpers (no framework) ---------------------------------

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- 1. Hop routing: A—B—C, A sends → C receives it via B ------------------

function testHopRouting(): void {
  console.log("1. Hop routing (A—B—C)");
  const { nodes, pump } = buildNetwork({ A: ["B"], B: ["A", "C"], C: ["B"] });
  const sent = nodes.get("A")!.router.send("hola desde A");
  pump();
  const c = nodes.get("C")!;
  check(
    "C recibe el mensaje de A",
    c.delivered.length === 1 && c.delivered[0].id === sent.id,
    `delivered=${c.delivered.length}`,
  );
}

// --- 2. Dedup: cycle A—B—C—A → each node delivers exactly once -------------

function testDedup(): void {
  console.log("2. Dedup (ciclo A—B—C—A)");
  const { nodes, pump } = buildNetwork({
    A: ["B", "C"],
    B: ["A", "C"],
    C: ["A", "B"],
  });
  nodes.get("A")!.router.send("broadcast en ciclo");
  pump();
  check(
    "B entrega exactamente 1 vez",
    nodes.get("B")!.delivered.length === 1,
    `delivered=${nodes.get("B")!.delivered.length}`,
  );
  check(
    "C entrega exactamente 1 vez",
    nodes.get("C")!.delivered.length === 1,
    `delivered=${nodes.get("C")!.delivered.length}`,
  );
}

// --- 3. TTL: ttl:2 on A—B—C—D → reaches C, NOT D ----------------------------

function testTtlCutoff(): void {
  console.log("3. TTL cutoff (ttl:2 en A—B—C—D)");
  const { nodes, pump } = buildNetwork({
    A: ["B"],
    B: ["A", "C"],
    C: ["B", "D"],
    D: ["C"],
  });
  nodes.get("A")!.router.send("mensaje con ttl corto", { ttl: 2 });
  pump();
  check(
    "B recibe (1 salto)",
    nodes.get("B")!.delivered.length === 1,
    `delivered=${nodes.get("B")!.delivered.length}`,
  );
  check(
    "C recibe (2 saltos, justo en el límite)",
    nodes.get("C")!.delivered.length === 1,
    `delivered=${nodes.get("C")!.delivered.length}`,
  );
  check(
    "D NO recibe (ttl agotado)",
    nodes.get("D")!.delivered.length === 0,
    `delivered=${nodes.get("D")!.delivered.length}`,
  );
}

// --- 4. Split horizon: B doesn't relay back to A ----------------------------

function testSplitHorizon(): void {
  console.log("4. Split horizon (A—B—C)");
  const { nodes, pump } = buildNetwork({ A: ["B"], B: ["A", "C"], C: ["B"] });
  nodes.get("A")!.router.send("no me lo devuelvas");
  pump();
  const b = nodes.get("B")!;
  check(
    "B nunca reenvía hacia A",
    !b.sendCounts.has("A"),
    `sendCounts=${JSON.stringify(Object.fromEntries(b.sendCounts))}`,
  );
  check(
    "B sí reenvía hacia C (una vez)",
    b.sendCounts.get("C") === 1,
    `sendCounts=${JSON.stringify(Object.fromEntries(b.sendCounts))}`,
  );
}

// --- run ---------------------------------------------------------------------

testHopRouting();
testDedup();
testTtlCutoff();
testSplitHorizon();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
