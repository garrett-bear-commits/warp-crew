# GitHub Pages QA site (not Jest)

Public playtest links. **No Jest upload yet** — SDK runs in local mock mode on Pages.

## One-time: enable Pages

1. Open https://github.com/garrett-bear-commits/warp-crew/settings/pages  
2. **Build and deployment → Source:** Deploy from a branch  
3. **Branch:** `gh-pages` / `/ (root)` → Save  

Wait ~1 minute, then open:

| | URL |
|--|-----|
| **QA hub** | https://garrett-bear-commits.github.io/warp-crew/qa.html |
| **Game** | https://garrett-bear-commits.github.io/warp-crew/ |

## Redeploy (after code changes)

From a machine with the repo:

```bash
# static ESM deploy (no vite required)
# or we re-run the deploy script later
```

Or ask Grok to push an updated `gh-pages` branch.

## Local QA page

```bash
npm run dev
# http://localhost:5173/qa.html
```

## Note on Actions workflow

Sample workflow lives at `docs/examples/deploy-pages.yml`.  
Your current PAT lacks the `workflow` scope, so Actions deploy isn’t active yet.  
To use it later: create a classic PAT with `workflow` + `repo`, add the file under `.github/workflows/`, set Pages source to GitHub Actions.
