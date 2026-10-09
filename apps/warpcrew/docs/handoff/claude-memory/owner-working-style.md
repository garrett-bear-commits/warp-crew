---
name: owner-working-style
description: "How Garrett (Warp Crew owner) likes work done: delegation, audits, approvals, reporting"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2c2899d5-ede1-4954-b00d-f4035d9e68e1
  modified: 2026-10-09T17:30:54.271Z
---

Garrett (Boglight Games) owns Warp Crew and is its only playtester.

- Code is written by Claude Opus sessions/sub-agents; art and independent code audits go to Codex "Luna" (`codex exec -m gpt-5.6-luna -c model_reasoning_effort=medium`), and every audit finding is fixed with a regression test.
- When asked "what do you rec?", give a clear ordered recommendation, not a menu.
- Publishing the GitHub Pages QA build is pre-approved; merging, committing and pushing were approved on 2026-10-09.
- Always ask first for: Jest console products, Jest production, real-money minting, downloads, paid art generation.
- Never handle secrets: Garrett pastes `JEST_PLAYER_SECRET` into Railway personally.
- Reports: short and plain, lead with the outcome, say what needs Garrett's ears/eyes (sound, phone play) since only Garrett can judge those.

**Why:** stated or confirmed by Garrett across the FTL-lite, weapons, sound and game-core port work (Oct 2026).

**How to apply:** default to this workflow on Warp Crew; see [[game-core-port]] and [[no-existing-players]].
