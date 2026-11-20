# Website, CI and releases

## The website

`site/` is the project website, published to GitHub Pages at <https://email-platform.adrianeyre.co.uk/>. `.github/workflows/pages.yml` builds and publishes it when it, the screenshots or the icons change on `main`. Set the repository variable `SITE_DOMAIN` to publish it at a custom domain; the build writes it to `CNAME`.

| Command             | Does                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm site:dev`     | Serves the page at <http://127.0.0.1:4330> as you edit it                                |
| `pnpm site:build`   | Builds it into `site/dist/`, with the files for search engines (`site/seo.ts`)           |
| `pnpm site:preview` | Serves the built `site/dist/`                                                            |
| `pnpm site:film`    | Films a still of every illustration into `docs/images/illustrations/`, in light and dark |

### The illustrations

The page's pictures are [Stageshow](https://github.com/benjitaylor/skills/tree/main/stageshow) scenes: faux product UI drawn in React in Email Platform's own look (`site/illustrations/look.css`), not screenshots. The kit and its filming tools are vendored, as published, in `site/stageshow/` (MIT; see its `README.md`).

| Scene        | File                               | What it shows                                                                                    |
| ------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `hero`       | `site/illustrations/hero.tsx`      | Socials added to an email in the designer and saved, then sent by `templateSlug` from a terminal |
| `features-*` | `site/illustrations/features.tsx`  | The bento grid's pictures: the log, the Light/Dark preview, the social icons and the slug        |
| `built-ins`  | `site/illustrations/built-ins.tsx` | The 15 built-in emails as a grid, one in focus                                                   |

Each scene is mounted by `site/illustrations/main.tsx` into an element marked `data-illustration="<scene>"`. That element holds the scene's filmed still (a `<picture>` with its dark version), so the page reads without JavaScript and search engines see the pictures. Scenes follow the reader's light or dark preference, and show their still frame when they prefer reduced motion. The social icons in them are the app's own, from `src/templates/design/social-icons.ts`.

After changing a scene, run `pnpm site:dev` and then `pnpm site:film`. It uses Stageshow's `film.mjs` with its rehearsal gate, which fails on framing and craft faults (a cut label, a cramped inset, a window floating with no crop), and needs Google Chrome or `CHROME_PATH`. `SITE_FILM_URL` points it elsewhere. To check the motion too:

```sh
node site/stageshow/scripts/film.mjs "http://127.0.0.1:4330/" --select '[data-illustration="hero"]' --gate
node site/stageshow/scripts/film.mjs "http://127.0.0.1:4330/" --select '[data-illustration="hero"]' --width 390 --gate
```

## Releases

`.github/workflows/release.yml` runs [semantic-release](https://semantic-release.gitbook.io) on every merge to `main`. It reads the [Conventional Commits](https://www.conventionalcommits.org) since the last `v*` tag and chooses the next version. It then updates `CHANGELOG.md` and `package.json`, which supplies the version shown in the app's footer, tags the commit and creates the GitHub release. Planning runs with no write token; only the dependency-free `release/publish.ts` can push.

## The email client

`.github/workflows/publish-email-client.yml` publishes [`@adrianeyre/email-client`](../../packages/email-client/README.md) to GitHub Packages when `packages/email-client` changes on `main` with a version that isn't published yet, or when run by hand. To release the client, bump `version` in its `package.json`. One job builds, tests and packs the client with a read-only token; the publish job installs nothing and publishes the packed tarball with `packages: write`.
