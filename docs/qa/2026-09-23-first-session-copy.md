# First-session copy pass — 2026-09-23

Scope: splash through first saved win, ship name, free recruit, optional Jest sign-in, and the next-job cue. Task 8A changes the first-session lines below; normal contract/away/store prose outside this slice remains for later review. Mandatory cues use job, crew, station, reward, reputation, and Away team where those nouns are needed. “Contract” remains a navigation label in the existing broader game.

| Screen and file/selector | Before | After | Reason |
| --- | --- | --- | --- |
| `bridge.js` `.splash-backdrop` | Small card with cropped 280px image | Full viewport scene, separate Warp Crew mark, dark loading/Board plate | Show a ship immediately; one action |
| `bridge.js` `.splash-progress` | No displayed loading status; Board enabled immediately | `Loading ship 0–100%`, then `Ship ready`, Board enabled after essential images settle | Progress reports real image load settlements |
| `bridge.js` `[data-act="splash-dismiss"]` | `Board ship` | `Board ship` | Already clear; stays the sole action |
| `bridge.js` `.first-session-cue` station | `Distress call. Send Bolt to Shields.` | `Distress call: send Bolt to Shields.` | One direct sentence |
| `bridge.js` `.first-session-cue` distress | `Distress call from Dust Lane.` / `Answer call` | Unchanged | One short cue and action |
| `contractView.js` `.encounter-threat` | `Incoming fire at shields · 1 beat` | Unchanged | Threat names its target and timing |
| `contractView.js` guided `[data-act="encounter-order"]` | `Brace · 2 shield` / `Block hit · Once` | `Brace` / `Spend 2 shield to block the hit.` | Make the sole guided order readable at a glance |
| `contractView.js` win / `[data-act="contract-claim"]` | `The pirate breaks off. Bring the cargo aboard.` / `Bring cargo aboard` | Unchanged | A clear win and reward action |
| `bridge.js` `.first-session-modal` name | `Cargo aboard. Third berth open.` / `Name your ship.` | `Cargo aboard; third berth open.` / `Name your ship.` | One sentence before the name action; input now matches 24-character rule |
| `bridge.js` `.first-session-modal` pull | `Guaranteed Uncommon. They join your open berth.` | `Guaranteed Uncommon crew for your open berth.` | One plain reward sentence |
| `bridge.js` `.first-session-modal` new crew | `Uncommon [role] · [station suggestion] You can change their job later.` | `Uncommon [role] · [station suggestion]` | Drop the extra tutorial sentence |
| `bridge.js` `.first-session-modal` registration | `Progress is saved on this device. Jest sign-in is optional.` | `Progress is saved in this browser; Jest sign-in is optional.` | State the actual local save boundary accurately |
| `bridge.js` local preview registration | `Jest sign-in is unavailable in this preview.` / `Continue to ship` | Unchanged | Does not pretend mock sign-in is registration |
| `bridge.js` next job | `Next job is ready.` / `See contracts` / `Away teams are on Missions when you're ready.` | Unchanged | One immediate job and one later Away-team hint |
| `main.js` first-session blocked action toast/log | Raw reason codes such as `tutorial_station_required`, `brace_required`; save failure duplicated in long prose | `Send Bolt to Shields first.` / `Brace before the pirate fires.` / `Could not save. Try again.` | Tell the player what to do next; preserve no raw code on screen |

The optional Jest button signs into Jest; it does not claim cloud backup or cross-device recovery. The progress bar is for seven essential images (six manifest images plus the Sparrow hull), and completes after fallbacks settle. A missing primary and fallback leaves the CSS scene/ship fallback and still finishes loading.

Phone-size visual measurements and the full in-context copy check are pending Task 8B/9. This document does not certify a finished splash or owner-device QA.
