# Tangkortet: working rules

A mobile-first map for foraging seaweed in Denmark, seeded from the sister
project Svampekortet (`jmj00/Svampekortet`, public; archive
`jmj00/Svampekortet-private`). The plan is in `docs/plan.md`.

This repo is **public**. Code licence: PolyForm Strict 1.0.0; the project's own
texts and derived data: CC BY-NC 4.0.

## The expert's words stay private

- The expert's brief, verbatim answers and raw review-state backups live in the
  private repo `jmj00/Tangkortet-expert` (local clone next to this one), never
  here. They are git-ignored here as a safety net.
- This repo may paraphrase decisions that follow from them, but never quote the
  expert verbatim or name them.
- Before every review-page redeploy, fetch
  `https://tangkortet-review.pages.dev/api/review-state` into a new dated file in
  `Tangkortet-expert/answers/` (never overwrite) and commit it there.

## Svampekortet is read-only from here

- Never edit, commit, push, branch, open PRs or run builds/deploys in
  Svampekortet's local checkouts or on its GitHub repos. Reading files and
  copying them *into this repo* is fine.
- Never reuse Svampekortet's Cloudflare Pages project, GitHub secrets/variables,
  Sentry project or API keys. Tangkortet gets its own of each.
- When copying code, note the Svampekortet commit it came from in the commit
  message.

## Nothing destructive

- No force pushes, history rewrites, `git reset --hard` on shared branches,
  repo deletion, or deleting branches other than a merged PR's own branch
  (GitHub auto-deletes those).
- No deleting cloud resources (Cloudflare projects, Sentry projects, secrets).
- Removing files within this repo as part of normal development is fine when the
  PR description says why.

## Git and PR flow

- Commits are authored with GitHub's noreply address
  (`17740969+jmj00@users.noreply.github.com`, set in this clone's local git
  config), never a personal email.
- `main` is branch-protected: a PR with green CI is required, and force pushes
  and deletion are blocked.

- `main` is always deployable. All work goes on a branch (`feat/…`, `fix/…`,
  `docs/…`, `chore/…`) and lands through a PR. No direct pushes to `main` after
  the initial commit.
- Before merging, Claude must: run the full local checks (below); see CI green;
  re-read the diff; and fill in the PR template.
- **Claude may merge its own PR without asking** when all of the above hold and
  the change is ordinary development: code, tests, docs, data pipeline, UI.
- **Ask the user first** for:
  - making the repo or the site public, or changing who has access;
  - creating or changing secrets, billing, domains, or the Cloudflare/Sentry
    projects;
  - anything touching Svampekortet (see above);
  - new user-facing claims about safety, contamination, edibility, health or
    legality: these may be merged only as drafts marked "foreløbig" in the UI and
    listed for expert review (label `needs-expert-review`);
  - MapLibre load/initialisation changes, which need a real browser test by the
    user before merge (lesson from Svampekortet);
  - adding a dependency with a non-permissive licence, or a data source whose
    licence blocks the intended use;
  - anything Claude is unsure is safe.
- Use squash merges. Keep PRs small enough to review in one sitting.

## Local checks before every push

- Python: `ruff check .`, `ruff format --check .`, `pytest`.
- Web (from `web/`): `npm run lint`, `npm run format:check` (pre-commit does
  **not** run Prettier; CI does), `npm run test`, `npm run build`.

## Content rules

- The app never says a spot or a seaweed is safe to eat. Risk views always carry
  the line that maps and warnings are no guarantee.
- Danish species names come from the arter.dk archive `vernacularName`, never
  guessed or translated.
- Depth, harvest method and season show as "foreløbig" until `expert_verified`.
- Claims from the ChatGPT-produced PDF need a primary source before they are
  shown as fact.
- Danish UI; code, comments and docs in English.
