# Stageshow (vendored)

The website's illustrations are built with [Stageshow](https://github.com/benjitaylor/skills/tree/main/stageshow),
a skill and small React kit for faux product UI by Benji Taylor, MIT licensed (`LICENSE`, `NOTICE.md`).

- `kit/` is the kit, copied as published at commit `299140fafd08df55a9c234e610c3f64af3f45531`.
  The scenes in `site/illustrations/` import it through `site/illustrations/kit.ts`.
- `scripts/` holds its filming and rehearsal tools; `pnpm site:film` uses `film.mjs` to film
  the stills in `docs/images/illustrations/`.

Both are kept exactly as published, so they are left out of ESLint and Prettier, and are type-checked
with the kit's own settings (`site/illustrations/tsconfig.json`). To update them, copy `kit/` and
`scripts/` from a newer commit of the skill over these folders, note the commit here, and run
`pnpm typecheck` and `pnpm site:film`.
