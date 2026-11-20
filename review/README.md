# Expert review page

A Danish questionnaire for the seaweed expert: general questions, the weight of
each risk factor from their brief, and per-species depth / harvest method /
season / warnings, with GBIF evidence shown next to each species. Built by
`scripts/build_expert_review.py` into `review/public/index.html` (git-ignored),
served by Cloudflare Pages, answers saved live to Workers KV through
`functions/api/review-state.js`. Same design as Svampekortet's review tool.

## One-time setup

1. Cloudflare dashboard → Storage & Databases → KV → create a namespace named
   `tangkortet-review-state`. Copy its id.
2. GitHub → jmj00/Tangkortet → Settings → Secrets and variables → Actions:
   - secrets `CLOUDFLARE_API_TOKEN` (Pages: Edit + Workers KV: Edit) and
     `CLOUDFLARE_ACCOUNT_ID`;
   - variable `REVIEW_KV_ID` = the namespace id.
3. Actions → deploy-review → Run workflow. The page lands at
   `https://tangkortet-review.pages.dev`.

## Reading the answers

    curl -s https://tangkortet-review.pages.dev/api/review-state

Every overwrite keeps the previous state under a `history:<minute>` KV key for
90 days (dashboard → KV → the namespace), so an accidental wipe is recoverable.

## Local preview

    py scripts/build_expert_review.py
    cd review && npx wrangler pages dev public   # simulated KV, no login needed

## Photo verdicts

The "Fotos af arterne" section asks the expert to keep or reject each species
photo (`foto.<slug>.<iNaturalist photo id>`). Apply a saved state to the image
files with

    py scripts/apply_photo_review.py <review-state.json>

"Behold" marks a photo `reviewed: true`, "Afvis" marks it `rejected: true` (left
out of the app, kept in the file). Commit the changed `data/images/*.json`.
