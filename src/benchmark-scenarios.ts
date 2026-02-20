/**
 * BrainBox Benchmark Scenarios
 *
 * Defines reproducible workloads for generating paper-ready evaluation numbers.
 * Each scenario models a distinct developer behavior pattern.
 */

// --- Types ---

export interface FileAccess {
  path: string;
  type?: "file" | "tool" | "error";
  query?: string;
}

export interface SessionPlan {
  name: string;
  files: FileAccess[];
  /** Ground truth: which files should recall find for which queries? */
  groundTruth?: Record<string, string[]>;
}

export interface DecayConfig {
  enabled: boolean;
  /** Simulated time gap between sessions in ms (default: 1 day = 86400000) */
  interSessionGapMs: number;
}

export interface BenchmarkScenario {
  id: string;
  name: string;
  description: string;
  sessions: SessionPlan[];
  decay?: DecayConfig;
  /** Session numbers (1-indexed) at which to run consolidate() */
  consolidationAt?: number[];
  /** Session numbers at which to collect metrics */
  checkpoints: number[];
  /** Recall queries to test after all sessions */
  recallQueries: Array<{
    query: string;
    expectedFiles: string[];  // ground truth for precision/recall
    shouldFail?: boolean;     // expect no results (unknown query)
  }>;
}

// --- File Sets ---

const wsFiles: FileAccess[] = [
  { path: "src/api/apiSession.ts", query: "websocket session" },
  { path: "src/api/auth.ts", query: "authentication" },
  { path: "src/api/encryption.ts", query: "encrypt session" },
];

const configFiles: FileAccess[] = [
  { path: "src/config.ts", query: "configuration" },
  { path: "src/env.ts", query: "environment variables" },
];

const testFiles: FileAccess[] = [
  { path: "src/tests/session.test.ts", query: "test session" },
  { path: "src/tests/auth.test.ts", query: "test auth" },
];

const toolChain: FileAccess[] = [
  { path: "Grep", type: "tool", query: "searching" },
  { path: "Read", type: "tool", query: "reading file" },
];

const editChain: FileAccess[] = [
  { path: "Grep", type: "tool", query: "searching" },
  { path: "Read", type: "tool", query: "reading file" },
  { path: "Edit", type: "tool", query: "editing file" },
];

const testChain: FileAccess[] = [
  { path: "Grep", type: "tool", query: "searching" },
  { path: "Read", type: "tool", query: "reading file" },
  { path: "Edit", type: "tool", query: "editing file" },
  { path: "Bash", type: "tool", query: "running tests" },
];

// Helper: interleave tools before file accesses (realistic agent pattern)
function withTools(files: FileAccess[], tools: FileAccess[] = toolChain): FileAccess[] {
  const result: FileAccess[] = [];
  for (const f of files) {
    result.push(...tools);
    result.push(f);
  }
  return result;
}

// --- Scenario A1: Standard Developer Workflow ---

export const SCENARIO_A1: BenchmarkScenario = {
  id: "A1",
  name: "Standard Developer Workflow",
  description: "20 sessions modeling focused websocket/auth development with tool chains",
  checkpoints: [1, 5, 10, 15, 20],
  sessions: [
    { name: "Session 1: Build websocket", files: withTools([...wsFiles, ...configFiles]) },
    { name: "Session 2: Debug websocket", files: withTools(wsFiles) },
    { name: "Session 3: Refactor websocket", files: withTools([...wsFiles, ...testFiles], editChain) },
    { name: "Session 4: Quick ws fix", files: withTools(wsFiles.slice(0, 2)) },
    { name: "Session 5: Encrypt update", files: withTools([wsFiles[0], wsFiles[2]]) },
    { name: "Session 6: Auth overhaul", files: withTools([...wsFiles, ...configFiles], editChain) },
    { name: "Session 7: WS + tests", files: withTools([...wsFiles, ...testFiles], testChain) },
    { name: "Session 8: Quick fix", files: withTools(wsFiles.slice(0, 2)) },
    { name: "Session 9: Full stack", files: withTools([...wsFiles, ...configFiles, ...testFiles]) },
    { name: "Session 10: WS debug", files: withTools(wsFiles) },
    { name: "Session 11: Auth token", files: withTools(wsFiles.slice(0, 2)) },
    { name: "Session 12: Encrypt refactor", files: withTools([wsFiles[0], wsFiles[2]], editChain) },
    { name: "Session 13: Full WS", files: withTools(wsFiles) },
    { name: "Session 14: Test suite", files: withTools([...wsFiles, ...testFiles], testChain) },
    { name: "Session 15: Config update", files: withTools([...configFiles, wsFiles[0]]) },
    { name: "Session 16: WS perf", files: withTools(wsFiles) },
    { name: "Session 17: Quick auth", files: withTools(wsFiles.slice(0, 2)) },
    { name: "Session 18: Encrypt + test", files: withTools([wsFiles[2], ...testFiles]) },
    { name: "Session 19: Full WS refactor", files: withTools([...wsFiles, ...testFiles], editChain) },
    { name: "Session 20: Final WS", files: withTools(wsFiles) },
  ],
  recallQueries: [
    // Direct keyword matches
    { query: "websocket session", expectedFiles: ["src/api/apiSession.ts", "src/api/auth.ts", "src/api/encryption.ts"] },
    { query: "authentication", expectedFiles: ["src/api/auth.ts", "src/api/apiSession.ts"] },
    { query: "encrypt session", expectedFiles: ["src/api/encryption.ts", "src/api/apiSession.ts"] },
    // Indirect / spreading queries — keyword only matches ONE file, expect spread to find co-accessed files
    { query: "environment variables", expectedFiles: ["src/env.ts", "src/config.ts"] },
    { query: "configuration", expectedFiles: ["src/config.ts", "src/env.ts", "src/api/apiSession.ts"] },
    // Should-fail queries (no matching keywords)
    { query: "database connection", expectedFiles: [], shouldFail: true },
    { query: "payment processing", expectedFiles: [], shouldFail: true },
  ],
};

// --- Scenario A2: Standard Workflow with Decay ---

export const SCENARIO_A2: BenchmarkScenario = {
  ...SCENARIO_A1,
  id: "A2",
  name: "Standard Workflow with Decay",
  description: "Same as A1 but with daily decay between sessions",
  decay: { enabled: true, interSessionGapMs: 86_400_000 },
};

// --- Scenario B1: Large Codebase (100+ files) ---

function generateLargeCodebase(): { files: Record<string, FileAccess[]>; sessions: SessionPlan[] } {
  const dirs: Record<string, string[]> = {
    "src/api": ["routes.ts", "middleware.ts", "controllers.ts", "validators.ts", "types.ts",
                "auth-middleware.ts", "rate-limiter.ts", "cors.ts", "error-handler.ts", "logger.ts",
                "user-controller.ts", "product-controller.ts", "order-controller.ts", "payment-controller.ts", "webhook-handler.ts"],
    "src/ui": ["App.tsx", "Layout.tsx", "Header.tsx", "Footer.tsx", "Sidebar.tsx",
               "Dashboard.tsx", "UserProfile.tsx", "ProductList.tsx", "Cart.tsx", "Checkout.tsx",
               "LoginForm.tsx", "SignupForm.tsx", "SearchBar.tsx", "Pagination.tsx", "Modal.tsx",
               "useAuth.ts", "useCart.ts", "useProducts.ts", "useOrders.ts", "useNotifications.ts",
               "theme.ts", "styles.ts", "animations.ts", "icons.tsx", "utils.tsx"],
    "src/db": ["schema.ts", "migrations.ts", "queries.ts", "connection.ts", "seeds.ts",
               "user-model.ts", "product-model.ts", "order-model.ts", "payment-model.ts",
               "analytics-model.ts", "session-model.ts", "audit-model.ts"],
    "src/auth": ["session.ts", "encryption.ts", "tokens.ts", "oauth.ts", "permissions.ts",
                 "roles.ts", "two-factor.ts", "password-hash.ts", "jwt.ts", "cookie.ts"],
    "src/utils": ["helpers.ts", "validators.ts", "formatters.ts", "constants.ts", "errors.ts",
                  "logger.ts", "cache.ts", "queue.ts", "retry.ts", "debounce.ts",
                  "date-utils.ts", "string-utils.ts", "file-utils.ts", "math-utils.ts",
                  "crypto-utils.ts", "url-utils.ts", "env-utils.ts", "type-guards.ts", "testing-utils.ts", "mock-utils.ts"],
    "tests": ["api.test.ts", "auth.test.ts", "db.test.ts", "ui.test.ts", "utils.test.ts",
              "integration.test.ts", "e2e.test.ts", "performance.test.ts", "user.test.ts", "product.test.ts",
              "order.test.ts", "payment.test.ts", "middleware.test.ts", "validators.test.ts",
              "helpers.test.ts", "cache.test.ts", "queue.test.ts", "session.test.ts", "encryption.test.ts", "oauth.test.ts"],
  };

  const files: Record<string, FileAccess[]> = {};
  for (const [dir, names] of Object.entries(dirs)) {
    files[dir] = names.map(n => ({ path: `${dir}/${n}`, query: n.replace(/\.\w+$/, "").replace(/[-_]/g, " ") }));
  }

  // Realistic developer workflow: feature development touches ~10 files across dirs
  const sessions: SessionPlan[] = [
    // Feature: user authentication flow
    ...Array.from({ length: 5 }, (_, i) => ({
      name: `B1-${i + 1}: Auth feature`,
      files: withTools([
        files["src/auth"][0], files["src/auth"][1], files["src/auth"][2],
        files["src/api"][5], files["src/db"][5],
        files["src/ui"][10], files["src/ui"][15],
        files["tests"][1], files["tests"][17],
      ].slice(0, 5 + (i % 4))), // vary file count
    })),
    // Feature: product catalog
    ...Array.from({ length: 5 }, (_, i) => ({
      name: `B1-${i + 6}: Product catalog`,
      files: withTools([
        files["src/api"][11], files["src/db"][6],
        files["src/ui"][7], files["src/ui"][17],
        files["tests"][9], files["src/utils"][1],
      ].slice(0, 4 + (i % 3))),
    })),
    // Feature: order & payment
    ...Array.from({ length: 5 }, (_, i) => ({
      name: `B1-${i + 11}: Order system`,
      files: withTools([
        files["src/api"][12], files["src/api"][13],
        files["src/db"][7], files["src/db"][8],
        files["src/ui"][8], files["src/ui"][9],
        files["tests"][10], files["tests"][11],
      ].slice(0, 5 + (i % 4))),
    })),
    // Bug fixes: quick cross-cutting touches
    ...Array.from({ length: 5 }, (_, i) => ({
      name: `B1-${i + 16}: Bug fix`,
      files: withTools([
        files["src/utils"][4], files["src/api"][8],
        files["src/auth"][i % 5],
        files["tests"][i % 10],
      ].slice(0, 3 + (i % 2))),
    })),
    // Refactoring: broad cross-cutting
    ...Array.from({ length: 5 }, (_, i) => ({
      name: `B1-${i + 21}: Refactor`,
      files: withTools([
        files["src/utils"][0], files["src/utils"][1],
        files["src/api"][0], files["src/api"][1],
        files["src/db"][0], files["src/db"][1],
        files["src/auth"][0],
        files["tests"][0], files["tests"][5],
      ].slice(0, 6 + (i % 4)), editChain),
    })),
    // Return to auth (tests warm-up after context switch)
    ...Array.from({ length: 5 }, (_, i) => ({
      name: `B1-${i + 26}: Auth revisit`,
      files: withTools([
        files["src/auth"][0], files["src/auth"][1],
        files["src/api"][5], files["src/db"][5],
        files["tests"][1],
      ].slice(0, 3 + (i % 3))),
    })),
  ];

  return { files, sessions };
}

const largeCodebase = generateLargeCodebase();

export const SCENARIO_B1: BenchmarkScenario = {
  id: "B1",
  name: "Large Codebase (100+ files)",
  description: "30 sessions across 110 files, testing scalability and hub explosion prevention",
  checkpoints: [1, 5, 10, 15, 20, 25, 30],
  sessions: largeCodebase.sessions,
  recallQueries: [
    { query: "user authentication", expectedFiles: ["src/auth/session.ts", "src/auth/encryption.ts", "src/auth/tokens.ts"] },
    { query: "product catalog", expectedFiles: ["src/api/product-controller.ts", "src/db/product-model.ts", "src/ui/ProductList.tsx"] },
    { query: "order payment", expectedFiles: ["src/api/order-controller.ts", "src/api/payment-controller.ts", "src/db/order-model.ts"] },
    { query: "database schema", expectedFiles: ["src/db/schema.ts", "src/db/migrations.ts"] },
    { query: "machine learning model", expectedFiles: [], shouldFail: true },
  ],
};

// --- Scenario C1: Error Debugging ---

export const SCENARIO_C1: BenchmarkScenario = {
  id: "C1",
  name: "Error Debugging",
  description: "20 sessions of recurring error patterns with fix file associations",
  checkpoints: [1, 2, 5, 10, 15, 20],
  sessions: [
    // Error 1 first occurrence: TypeError
    { name: "C1-1: First TypeError", files: [
      { path: "TypeError: cannot read property 'token' of undefined", type: "error", query: "token error" },
      ...withTools([
        { path: "src/api/auth.ts", query: "fix token error" },
        { path: "src/api/session.ts", query: "fix session" },
      ]),
    ]},
    // Error 2 first occurrence: Connection refused
    { name: "C1-2: Connection refused", files: [
      { path: "Connection refused: localhost:3000", type: "error", query: "connection error" },
      ...withTools([
        { path: "src/config.ts", query: "fix port config" },
        { path: "src/api/apiSession.ts", query: "fix api connection" },
      ]),
    ]},
    // Error 1 recurs
    { name: "C1-3: TypeError again", files: [
      { path: "TypeError: cannot read property 'token' of undefined", type: "error", query: "token error again" },
      ...withTools([{ path: "src/api/auth.ts", query: "fix auth token" }]),
    ]},
    // Error 3: Module not found
    { name: "C1-4: Module not found", files: [
      { path: "Module not found: lodash", type: "error", query: "missing module" },
      ...withTools([
        { path: "package.json", query: "add dependency" },
        { path: "src/config.ts", query: "check imports" },
      ]),
    ]},
    // Error 1 recurs (3rd time — should be learning)
    { name: "C1-5: TypeError third time", files: [
      { path: "TypeError: cannot read property 'token' of undefined", type: "error", query: "token error" },
      ...withTools([{ path: "src/api/auth.ts", query: "auth fix" }]),
    ]},
    // Error 4: Unauthorized
    { name: "C1-6: Unauthorized", files: [
      { path: "Unauthorized: invalid session cookie", type: "error", query: "auth cookie error" },
      ...withTools([
        { path: "src/api/auth.ts", query: "fix cookie" },
        { path: "src/api/encryption.ts", query: "fix session encryption" },
      ]),
    ]},
    // Mix: Errors 1 + 2
    { name: "C1-7: Mixed errors", files: [
      { path: "TypeError: cannot read property 'token' of undefined", type: "error", query: "token" },
      ...withTools([{ path: "src/api/auth.ts", query: "auth" }]),
      { path: "Connection refused: localhost:3000", type: "error", query: "connection" },
      ...withTools([{ path: "src/config.ts", query: "config" }]),
    ]},
    // Repeat pattern: each error 2-3 more times
    ...Array.from({ length: 13 }, (_, i) => {
      const errors = [
        { error: "TypeError: cannot read property 'token' of undefined", fixes: ["src/api/auth.ts", "src/api/session.ts"] },
        { error: "Connection refused: localhost:3000", fixes: ["src/config.ts", "src/api/apiSession.ts"] },
        { error: "Module not found: lodash", fixes: ["package.json", "src/config.ts"] },
        { error: "Unauthorized: invalid session cookie", fixes: ["src/api/auth.ts", "src/api/encryption.ts"] },
      ];
      const err = errors[i % 4];
      return {
        name: `C1-${i + 8}: Error pattern ${(i % 4) + 1}`,
        files: [
          { path: err.error, type: "error" as const, query: "error fix" },
          ...withTools(err.fixes.map(f => ({ path: f, query: "fixing error" }))),
        ],
      };
    }),
  ],
  recallQueries: [
    { query: "TypeError: cannot read property 'token' of undefined", expectedFiles: ["src/api/auth.ts", "src/api/session.ts"] },
    { query: "Connection refused: localhost:3000", expectedFiles: ["src/config.ts", "src/api/apiSession.ts"] },
    { query: "Module not found: lodash", expectedFiles: ["package.json", "src/config.ts"] },
    { query: "Unauthorized: invalid session cookie", expectedFiles: ["src/api/auth.ts", "src/api/encryption.ts"] },
    { query: "SegmentationFault: core dumped", expectedFiles: [], shouldFail: true },
  ],
};

// --- Scenario D1: Cross-Project Switching ---

const projectA: FileAccess[] = [
  { path: "happy-cli/src/auth.ts", query: "auth module" },
  { path: "happy-cli/src/api.ts", query: "api router" },
  { path: "happy-cli/src/encryption.ts", query: "encrypt" },
];
const projectB: FileAccess[] = [
  { path: "shop/src/cart.ts", query: "shopping cart" },
  { path: "shop/src/checkout.ts", query: "checkout flow" },
  { path: "shop/src/payment.ts", query: "payment processing" },
];
const projectC: FileAccess[] = [
  { path: "engine/src/physics.ts", query: "physics engine" },
  { path: "engine/src/rendering.ts", query: "render pipeline" },
  { path: "engine/src/audio.ts", query: "audio system" },
];

export const SCENARIO_D1: BenchmarkScenario = {
  id: "D1",
  name: "Cross-Project Switching",
  description: "Sequential project switching: A(10) → B(10) → C(10) → A(5)",
  checkpoints: [1, 5, 10, 15, 20, 25, 30, 35],
  decay: { enabled: true, interSessionGapMs: 86_400_000 },
  sessions: [
    // Project A: 10 sessions
    ...Array.from({ length: 10 }, (_, i) => ({
      name: `D1-${i + 1}: Project A`,
      files: withTools(projectA.slice(0, 2 + (i % 2))),
    })),
    // Project B: 10 sessions
    ...Array.from({ length: 10 }, (_, i) => ({
      name: `D1-${i + 11}: Project B`,
      files: withTools(projectB.slice(0, 2 + (i % 2))),
    })),
    // Project C: 10 sessions
    ...Array.from({ length: 10 }, (_, i) => ({
      name: `D1-${i + 21}: Project C`,
      files: withTools(projectC.slice(0, 2 + (i % 2))),
    })),
    // Return to Project A: 5 sessions
    ...Array.from({ length: 5 }, (_, i) => ({
      name: `D1-${i + 31}: Project A return`,
      files: withTools(projectA.slice(0, 2 + (i % 2))),
    })),
  ],
  recallQueries: [
    { query: "auth module encryption", expectedFiles: ["happy-cli/src/auth.ts", "happy-cli/src/encryption.ts"] },
    { query: "shopping cart checkout", expectedFiles: ["shop/src/cart.ts", "shop/src/checkout.ts"] },
    { query: "physics engine rendering", expectedFiles: ["engine/src/physics.ts", "engine/src/rendering.ts"] },
    // Test context bleed: shop query shouldn't return engine files
    { query: "payment processing", expectedFiles: ["shop/src/payment.ts"] },
  ],
};

// --- Scenario E1: Long-Running Agent (50 sessions + decay + consolidation) ---

export const SCENARIO_E1: BenchmarkScenario = {
  id: "E1",
  name: "Long-Running Agent (100 sessions)",
  description: "100 sessions with daily decay and consolidation every 10 sessions, testing long-horizon learning",
  checkpoints: [1, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  decay: { enabled: true, interSessionGapMs: 86_400_000 },
  consolidationAt: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  sessions: [
    // 100 sessions: core ws files accessed heavily, config/tests occasionally
    ...Array.from({ length: 100 }, (_, i) => {
      const sessionNum = i + 1;
      let files: FileAccess[];
      if (sessionNum % 5 === 0) {
        // Every 5th session: full ws + tests (8 files + tools)
        files = withTools([...wsFiles, ...testFiles], testChain);
      } else if (sessionNum % 4 === 0) {
        // Every 4th session: ws + config (5 files + tools)
        files = withTools([...wsFiles.slice(0, 2), ...configFiles]);
      } else if (sessionNum % 3 === 0) {
        // Every 3rd session: full ws with edits (3 files + tools)
        files = withTools(wsFiles, editChain);
      } else if (sessionNum % 7 === 0) {
        // Every 7th session: config-only (tests context separation)
        files = withTools(configFiles);
      } else {
        // Default: ws core (2-3 files + tools)
        files = withTools(wsFiles.slice(0, 2 + (sessionNum % 2)));
      }
      return { name: `E1-${sessionNum}`, files };
    }),
  ],
  recallQueries: [
    { query: "websocket session", expectedFiles: ["src/api/apiSession.ts", "src/api/auth.ts", "src/api/encryption.ts"] },
    { query: "authentication", expectedFiles: ["src/api/auth.ts", "src/api/apiSession.ts"] },
    { query: "environment variables", expectedFiles: ["src/env.ts", "src/config.ts"] },
    // After 100 sessions, spreading should find test files from ws files
    { query: "encrypt session", expectedFiles: ["src/api/encryption.ts", "src/api/apiSession.ts"] },
    { query: "database connection", expectedFiles: [], shouldFail: true },
  ],
};

// --- All Scenarios ---

export const ALL_SCENARIOS: BenchmarkScenario[] = [
  SCENARIO_A1,
  SCENARIO_A2,
  SCENARIO_B1,
  SCENARIO_C1,
  SCENARIO_D1,
  SCENARIO_E1,
];
