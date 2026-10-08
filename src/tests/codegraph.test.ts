import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { openDb } from "../db.js";
import { HebbianEngine } from "../hebbian.js";
import type { CodeEdge } from "../codegraph.js";
import { scanCodeGraph, seedCodeEdges } from "../codegraph.js";
import { describe, test, eq, ok, sandbox } from "../testkit.js";

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "brainbox-codegraph-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, close: () => rmSync(root, { recursive: true, force: true }) };
}
function edge(edges: CodeEdge[], root: string, from: string, to: string, kind: CodeEdge["kind"]): CodeEdge | undefined {
  return edges.find(item => item.from === join(root, from) && item.to === join(root, to) && item.kind === kind);
}

describe("CodeGraph", () => {
  test("TS aliases, JSONC baseUrl, directory indexes, and ESM source mapping", async () => {
    const f = fixture({
      "tsconfig.json": '{// aliases\n"compilerOptions":{"baseUrl":".","paths":{"@app/*":["src/*"],},},}',
      "src/main.ts": 'import { run } from "@app/lib";\nimport { other } from "./other.js"; run(); other();',
      "src/lib/index.ts": "export function run() {}",
      "src/other.ts": "export function other() {}",
    });
    try {
      const result = await scanCodeGraph(f.root);
      ok(!!edge(result.edges, f.root, "src/main.ts", "src/lib/index.ts", "import"));
      ok(!!edge(result.edges, f.root, "src/main.ts", "src/other.ts", "import"));
      ok(!!edge(result.edges, f.root, "src/main.ts", "src/lib/index.ts", "call"));
      eq(result.scanned, 3);
    } finally { f.close(); }
  });

  test("Python relative, parent-relative and package imports resolve __init__.py", async () => {
    const f = fixture({
      "pkg/__init__.py": "def exported(): pass\n",
      "pkg/helper.py": "def run(): pass\nclass Base: pass\n",
      "pkg/main.py": "from .helper import run as execute, Base\nexecute()\nclass Child(Base): pass\n",
      "pkg/sub/main.py": "from ..helper import run\nrun()\n",
      "entry.py": "from pkg import exported\nexported()\n",
    });
    try {
      const result = await scanCodeGraph(f.root);
      ok(!!edge(result.edges, f.root, "pkg/main.py", "pkg/helper.py", "import"));
      ok(!!edge(result.edges, f.root, "pkg/sub/main.py", "pkg/helper.py", "call"));
      ok(!!edge(result.edges, f.root, "entry.py", "pkg/__init__.py", "call"));
      ok(!!edge(result.edges, f.root, "pkg/main.py", "pkg/helper.py", "inherit"));
    } finally { f.close(); }
  });

  test("counts exported calls and inheritance but not unexported functions or comments", async () => {
    const f = fixture({
      "main.ts": 'import Default, { run as execute, hidden, Base, Shape } from "./lib.js";\nimport * as lib from "./lib.js";\nexecute(); execute(); lib.run(); hidden(); new Default(); Base.start();\nclass Child extends Base implements Shape {}\n// import { fake } from "./fake.js";\n',
      "lib.ts": "export function run() {}\nfunction hidden() {}\nexport class Base { static start(){} }\nexport interface Shape {}\nexport default class Default {}",
      "fake.ts": "export function fake() {}",
    });
    try {
      const result = await scanCodeGraph(f.root);
      eq(edge(result.edges, f.root, "main.ts", "lib.ts", "call")?.count ?? 0, 5);
      eq(edge(result.edges, f.root, "main.ts", "lib.ts", "inherit")?.count ?? 0, 2);
      ok(!result.edges.some(item => item.to === join(f.root, "fake.ts")));
    } finally { f.close(); }
  });

  test("side-effect and dynamic TSX imports are syntax-derived", async () => {
    const f = fixture({
      "main.tsx": 'import "./setup.js"; const view = <div/>; import("./lazy.js");',
      "setup.ts": "export const ready = true;",
      "lazy.ts": "export function run(){}",
    });
    try {
      const result = await scanCodeGraph(f.root);
      ok(!!edge(result.edges, f.root, "main.tsx", "setup.ts", "import"));
      ok(!!edge(result.edges, f.root, "main.tsx", "lazy.ts", "import"));
    } finally { f.close(); }
  });

  test("CommonJS destructured and namespace calls", async () => {
    const f = fixture({
      "main.cjs": 'const {run: execute} = require("./lib.cjs"); const lib = require("./lib.cjs"); execute(); lib.run();',
      "lib.cjs": "exports.run = function() {};",
    });
    try {
      const result = await scanCodeGraph(f.root);
      eq(edge(result.edges, f.root, "main.cjs", "lib.cjs", "call")?.count ?? 0, 2);
    } finally { f.close(); }
  });

  test("Rust crate mod/use and qualified calls", async () => {
    const f = fixture({
      "src/main.rs": "mod helper; use crate::helper::{run, Thing}; fn main(){run(); helper::run();}",
      "src/helper.rs": "pub fn run() {} pub struct Thing {}",
    });
    try {
      const result = await scanCodeGraph(f.root);
      ok(!!edge(result.edges, f.root, "src/main.rs", "src/helper.rs", "import"));
      eq(edge(result.edges, f.root, "src/main.rs", "src/helper.rs", "call")?.count ?? 0, 2);
    } finally { f.close(); }
  });

  test("Swift best-effort modules and Go local module packages", async () => {
    const f = fixture({
      "Sources/App/main.swift": "import Helpers\nfunc main(){run()}\nclass Child: Base {}",
      "Sources/Helpers/helper.swift": "func run() {}\nclass Base {}",
      "go.mod": "module example.com/app\n\ngo 1.22\n",
      "main.go": 'package main\nimport h "example.com/app/helper"\nfunc main(){h.Run()}\n',
      "helper/helper.go": "package helper\nfunc Run(){}\n",
    });
    try {
      const result = await scanCodeGraph(f.root);
      ok(!!edge(result.edges, f.root, "Sources/App/main.swift", "Sources/Helpers/helper.swift", "call"));
      ok(!!edge(result.edges, f.root, "Sources/App/main.swift", "Sources/Helpers/helper.swift", "inherit"));
      ok(!!edge(result.edges, f.root, "main.go", "helper/helper.go", "call"));
      eq(result.unavailable.length, 0);
    } finally { f.close(); }
  });

  test("unchanged hashes skip parsing and avoid reinforcing synapses", async () => {
    const f = fixture({ "main.ts": 'import {run} from "./lib.js";run();', "lib.ts": "export function run(){}" });
    const s = sandbox();
    try {
      const initial = await scanCodeGraph(f.root, { db: s.db });
      seedCodeEdges(s.engine, initial.edges, s.db);
      const before = s.engine.allSynapses();
      const repeated = await scanCodeGraph(f.root, { db: s.db });
      seedCodeEdges(s.engine, repeated.edges, s.db);
      eq(repeated.scanned, 0);
      eq(repeated.skipped, 2);
      eq(repeated.edges.length, 0);
      eq(s.engine.allSynapses()[0].co_access_count, before[0].co_access_count);
      const cachedCount = s.db.prepare("SELECT COUNT(*) AS n FROM code_edges").get();
      ok(typeof cachedCount === "object" && cachedCount !== null && "n" in cachedCount && cachedCount.n === 2);
      const forward = before.find(item => item.source_id === `file:${join(f.root, "main.ts")}`);
      const reverse = before.find(item => item.source_id === `file:${join(f.root, "lib.ts")}`);
      ok(!!forward && !!reverse && forward.weight > reverse.weight);
      writeFileSync(join(f.root, "main.ts"), "// import removed\n");
      const changed = await scanCodeGraph(f.root, { db: s.db });
      eq(changed.scanned, 1);
      const remainingCount = s.db.prepare("SELECT COUNT(*) AS n FROM code_edges").get();
      ok(typeof remainingCount === "object" && remainingCount !== null && "n" in remainingCount && remainingCount.n === 0);
      eq(s.engine.allSynapses().length, 0);
    } finally { s.close(); f.close(); }
  });

  test("--since parses only changed sources while using cached target exports", async () => {
    const f = fixture({ "main.ts": 'import {run} from "./lib.js";run();', "lib.ts": "export function run(){}" });
    const s = sandbox();
    try {
      execFileSync("git", ["-C", f.root, "init", "-q"]);
      execFileSync("git", ["-C", f.root, "add", "."]);
      execFileSync("git", ["-C", f.root, "-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-qm", "fixture"]);
      await scanCodeGraph(f.root, { db: s.db });
      writeFileSync(join(f.root, "main.ts"), 'import {run} from "./lib.js";run();run();');
      const changed = await scanCodeGraph(f.root, { db: s.db, since: "HEAD" });
      eq(changed.scanned, 1);
      eq(edge(changed.edges, f.root, "main.ts", "lib.ts", "call")?.count ?? 0, 2);
      const repeated = await scanCodeGraph(f.root, { db: s.db, since: "HEAD" });
      eq(repeated.scanned, 0);
      eq(repeated.skipped, 1);
    } finally { s.close(); f.close(); }
  });

  test("JS inheritance, Python submodules and Rust module aliases", async () => {
    const f = fixture({
      "main.js": 'import {Base} from "./lib.js"; class Child extends Base {}',
      "lib.js": "export class Base {}",
      "pkg/__init__.py": "",
      "pkg/main.py": "from . import helper\nhelper.run()\n",
      "pkg/helper.py": "def run(): pass\n",
      "src/main.rs": "mod helper; use crate::helper as h; fn main(){h::run();}",
      "src/helper.rs": "pub fn run(){}",
    });
    try {
      const result = await scanCodeGraph(f.root);
      ok(!!edge(result.edges, f.root, "main.js", "lib.js", "inherit"));
      ok(!!edge(result.edges, f.root, "pkg/main.py", "pkg/helper.py", "call"));
      ok(!!edge(result.edges, f.root, "src/main.rs", "src/helper.rs", "call"));
    } finally { f.close(); }
  });

  test("nested tsconfig resolution changes invalidate source hashes", async () => {
    const f = fixture({
      "src/tsconfig.json": '{"compilerOptions":{"baseUrl":".","paths":{"@lib":["one"]}}}',
      "src/main.ts": 'import {run} from "@lib";run();',
      "src/one.ts": "export function run(){}",
      "src/two.ts": "export function run(){}",
    });
    const s = sandbox();
    try {
      await scanCodeGraph(f.root, { db: s.db });
      writeFileSync(join(f.root, "src/tsconfig.json"), '{"compilerOptions":{"baseUrl":".","paths":{"@lib":["two"]}}}');
      const changed = await scanCodeGraph(f.root, { db: s.db });
      ok(!!edge(changed.edges, f.root, "src/main.ts", "src/two.ts", "call"));
    } finally { s.close(); f.close(); }
  });
  test("structural priors are capped below reinforced co-access", async () => {
    const f = fixture({
      "main.ts": 'import {run,Base} from "./lib.js";' + "run();".repeat(100) + "class Child extends Base {}",
      "lib.ts": "export function run(){} export class Base{}",
      "once.ts": 'import {run} from "./lib.js";run();',
    });
    const s = sandbox();
    try {
      const result = await scanCodeGraph(f.root, { db: s.db });
      seedCodeEdges(s.engine, result.edges, s.db);
      const synapses = s.engine.allSynapses();
      ok(synapses.every(item => item.weight <= 0.35));
      eq(synapses.find(item => item.source_id === `file:${join(f.root, "main.ts")}`)?.weight ?? 0, 0.35);
      eq(synapses.find(item => item.source_id === `file:${join(f.root, "once.ts")}`)?.weight ?? 0, 0.2);
      const learning = sandbox("learned-prior-comparison");
      try {
        for (let i = 0; i < 30; i++) {
          learning.engine.record(join(f.root, "learned-a.ts"), "file", undefined, 1_000_000 + i * 10);
          learning.engine.record(join(f.root, "learned-b.ts"), "file", undefined, 1_000_005 + i * 10);
        }
        ok(learning.engine.allSynapses().some(item => item.weight > Math.max(...synapses.map(seed => seed.weight))));
      } finally { learning.close(); }
    } finally { s.close(); f.close(); }
  });

  test("legacy high seeds lower on rescan while reinforced seeds survive", async () => {
    const f = fixture({
      "main.ts": 'import {run} from "./lib.js";run();',
      "learned.ts": 'import {run} from "./lib.js";run();',
      "lib.ts": "export function run(){}",
    });
    const path = join(f.root, "legacy.db");
    let db = openDb(path);
    try {
      const engine = new HebbianEngine(db);
      const initial = await scanCodeGraph(f.root, { db });
      seedCodeEdges(engine, initial.edges, db);
      // Emulate the pre-provenance database, including the old MAX-seeded weights.
      db.exec("DROP TABLE codegraph_seeds; ALTER TABLE code_edges DROP COLUMN seeded_weight;");
      db.prepare("UPDATE synapses SET weight = CASE WHEN target_id = ? THEN 0.65 ELSE 0.39 END").run(`file:${join(f.root, "lib.ts")}`);
      db.prepare("UPDATE synapses SET co_access_count = co_access_count + 1 WHERE source_id = ? OR target_id = ?").run(`file:${join(f.root, "learned.ts")}`, `file:${join(f.root, "learned.ts")}`);
      db.close();
      db = openDb(path);
      await scanCodeGraph(f.root, { db });
      const seeds = db.prepare("SELECT weight,co_access_count FROM synapses WHERE source_id = ? AND target_id = ?");
      const plain = seeds.get(`file:${join(f.root, "main.ts")}`, `file:${join(f.root, "lib.ts")}`) as { weight: number; co_access_count: number };
      const learned = seeds.get(`file:${join(f.root, "learned.ts")}`, `file:${join(f.root, "lib.ts")}`) as { weight: number; co_access_count: number };
      eq(plain.weight, 0.2);
      eq(plain.co_access_count, 2);
      eq(learned.weight, 0.65);
      eq(learned.co_access_count, 3);
      const reverse = seeds.get(`file:${join(f.root, "lib.ts")}`, `file:${join(f.root, "main.ts")}`) as { weight: number };
      eq(reverse.weight, 0.12);
    } finally { db.close(); f.close(); }
  });

  test("removal retracts only pristine directional seeds and retains other structure", async () => {
    const f = fixture({
      "main.ts": 'import {run,Base} from "./lib.js";run();class Child extends Base {}',
      "learned.ts": 'import {run} from "./lib.js";run();',
      "lib.ts": "export function run(){} export class Base{}",
    });
    const s = sandbox();
    try {
      seedCodeEdges(s.engine, (await scanCodeGraph(f.root, { db: s.db })).edges, s.db);
      // Reinforcement without changing weight still protects the learned direction.
      s.db.prepare("UPDATE synapses SET co_access_count = co_access_count + 1 WHERE source_id = ?").run(`file:${join(f.root, "learned.ts")}`);
      writeFileSync(join(f.root, "main.ts"), 'import {run} from "./lib.js";run();');
      seedCodeEdges(s.engine, (await scanCodeGraph(f.root, { db: s.db })).edges, s.db);
      const pure = s.engine.allSynapses().find(item => item.source_id === `file:${join(f.root, "main.ts")}`);
      eq(pure?.weight ?? 0, 0.2);
      eq(pure?.co_access_count ?? 0, 2);
      writeFileSync(join(f.root, "learned.ts"), "// imports removed");
      await scanCodeGraph(f.root, { db: s.db });
      const learned = s.engine.allSynapses().filter(item => item.source_id === `file:${join(f.root, "learned.ts")}`);
      eq(learned.length, 1);
      eq(learned[0].co_access_count, 3);
      ok(!s.engine.allSynapses().some(item => item.target_id === `file:${join(f.root, "learned.ts")}`));
      rmSync(join(f.root, "lib.ts"));
      await scanCodeGraph(f.root, { db: s.db });
      eq(s.engine.allSynapses().length, 1);
      ok(s.engine.allSynapses()[0].source_id === `file:${join(f.root, "learned.ts")}`);
    } finally { s.close(); f.close(); }
  });

  test("--since export renames refresh inbound call and inheritance edges atomically", async () => {
    const f = fixture({
      "main.ts": 'import {run,Base} from "./lib.js";run();class Child extends Base {}',
      "lib.ts": "export function run(){} export class Base{}",
    });
    const s = sandbox();
    try {
      execFileSync("git", ["-C", f.root, "init", "-q"]);
      execFileSync("git", ["-C", f.root, "add", "."]);
      execFileSync("git", ["-C", f.root, "-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-qm", "fixture"]);
      seedCodeEdges(s.engine, (await scanCodeGraph(f.root, { db: s.db })).edges, s.db);
      writeFileSync(join(f.root, "lib.ts"), "export function renamed(){} export class Renamed{}");
      const changed = await scanCodeGraph(f.root, { db: s.db, since: "HEAD" });
      eq(changed.scanned, 2);
      ok(!!edge(changed.edges, f.root, "main.ts", "lib.ts", "import"));
      ok(!changed.edges.some(item => item.kind === "call" || item.kind === "inherit"));
      const cached = s.db.prepare("SELECT kind FROM code_edges").all() as { kind: string }[];
      eq(cached.length, 1);
      ok(cached[0].kind === "import");
      ok(s.engine.allSynapses().every(item => item.weight <= 0.2));
      writeFileSync(join(f.root, "lib.ts"), "export function run(){} export class Base{} export const restored = true;");
      const restored = await scanCodeGraph(f.root, { db: s.db, since: "HEAD" });
      ok(!!edge(restored.edges, f.root, "main.ts", "lib.ts", "call"));
      ok(!!edge(restored.edges, f.root, "main.ts", "lib.ts", "inherit"));
      eq(s.engine.allSynapses().find(item => item.source_id === `file:${join(f.root, "main.ts")}`)?.weight ?? 0, 0.3);
    } finally { s.close(); f.close(); }
  });

  test("package and relative tsconfig presets preserve paths without baseUrl", async () => {
    const f = fixture({
      "node_modules/@preset/shared/package.json": '{"tsconfig":"configs/base"}',
      "node_modules/@preset/shared/configs/base.json": '{"compilerOptions":{"paths":{"@preset":["../../../../preset/lib"]}}}',
      "node_modules/@preset/named/tsconfig.custom.json": '{"compilerOptions":{"paths":{"@named":["../../../named/lib"]}}}',
      "src/config/base.json": '{"extends":"@preset/shared","compilerOptions":{"paths":{"@lib":["../lib"]}}}',
      "src/tsconfig.json": '{"extends":"./config/base"}',
      "src/main.ts": 'import {run} from "@lib";run();',
      "src/lib.ts": "export function run(){}",
      "nested/tsconfig.json": '{"extends":"@preset/named/tsconfig.custom","compilerOptions":{"paths":{"@local":["lib"]}}}',
      "nested/main.ts": 'import {run} from "@local";run();',
      "nested/lib.ts": "export function run(){}",
      "explicit/tsconfig.json": '{"extends":"../src/config/base.json","compilerOptions":{"paths":{"@own":["lib"]}}}',
      "explicit/main.ts": 'import {run} from "@own";run();',
      "explicit/lib.ts": "export function run(){}",
      "preset/tsconfig.json": '{"extends":"@preset/shared"}',
      "preset/main.ts": 'import {run} from "@preset";run();',
      "preset/lib.ts": "export function run(){}",
      "named/tsconfig.json": '{"extends":"@preset/named/tsconfig.custom"}',
      "named/main.ts": 'import {run} from "@named";run();',
      "named/lib.ts": "export function run(){}",
    });
    try {
      const result = await scanCodeGraph(f.root);
      for (const dir of ["src", "nested", "explicit", "preset", "named"]) ok(!!edge(result.edges, f.root, `${dir}/main.ts`, `${dir}/lib.ts`, "call"), dir);
    } finally { f.close(); }
  });

  test("Go exact module imports and nearest nested module boundaries", async () => {
    const f = fixture({
      "go.mod": "module example.com/root\n",
      "root.go": "package root\nfunc Run(){}\n",
      "consumer/main.go": 'package consumer\nimport r "example.com/root"\nfunc Use(){r.Run()}\n',
      "consumer/main_test.go": 'package consumer\nimport r "example.com/root"\nfunc Test(){r.Run()}\n',
      "nested/go.mod": "module example.com/nested\n",
      "nested/root.go": "package nested\nfunc Run(){}\n",
      "nested/consumer/main.go": 'package consumer\nimport n "example.com/nested"\nimport r "example.com/root"\nfunc Use(){n.Run();r.Run()}\n',
      "outer.go": 'package root\nimport n "example.com/root/nested"\nfunc Use(){n.Run()}\n',
    });
    try {
      const result = await scanCodeGraph(f.root);
      ok(!!edge(result.edges, f.root, "consumer/main.go", "root.go", "call"));
      ok(!!edge(result.edges, f.root, "consumer/main_test.go", "root.go", "call"));
      ok(!!edge(result.edges, f.root, "nested/consumer/main.go", "nested/root.go", "call"));
      ok(!edge(result.edges, f.root, "nested/consumer/main.go", "root.go", "import"));
      ok(!edge(result.edges, f.root, "outer.go", "nested/root.go", "import"));
    } finally { f.close(); }
  });
});
