# BrainBox Lessons

## 2026-02-15: Always isolate before/after demos
**Trigger:** Built a before/after demo for BrainBox fixes using a shared in-memory DB across phases. The "before" measurement was contaminated by prior test setup. User caught it.
**Rule:** Any before/after comparison MUST use isolated state per phase. Fresh DB, fresh engine instance, no shared mutable state. Think like a skeptic: "how could this demo be lying?"
**Pattern:** When building verification demos, design them as proper A/B tests from the start. State assumptions explicitly so they can be challenged.
