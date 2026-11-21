# Website, CI and releases

## The website

`site/` is the project website, published to GitHub Pages at <https://adrianeyre.github.io/email-template/>. `.github/workflows/pages.yml` builds and publishes it when it, the screenshots or the icons change on `main`. Set the repository variable `SITE_DOMAIN` to publish it at a custom domain; the build writes it to `CNAME`.

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

## Checks every pull request

`.github/workflows/checks.yml` runs on every pull request, in separate jobs:

| Job               | Runs                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint              | `pnpm lint`                                                                                                                                 |
| Typecheck         | `pnpm typecheck`, then the email client's own typecheck                                                                                     |
| Prettier          | `pnpm prettier`                                                                                                                             |
| Test              | `pnpm test`, Testcontainers included, with the coverage thresholds `CI` turns on; then the email client's                                   |
| Audit             | `pnpm audit --audit-level high`                                                                                                             |
| Dependency review | GitHub's `actions/dependency-review-action`, failing on `high` in runtime and development dependencies; only while the repository is public |

The coverage thresholds in `vitest.config.ts` apply only when `CI` is set, so they were first enforced by this workflow. They had been 88% statements and lines and 80% functions; nothing had checked them, and the suite does not meet them (81.9% statements on 21 November 2026, the pen-test harness in `src/pen-test/deployment/` being the least covered); they are now the floor measured when the workflow was added (81% statements and lines, 76% branches and functions). Raise them as coverage rises.

The audit fails on a `high` or `critical` advisory. It reads `pnpm-lock.yaml`, so it sees the whole dependency tree, not only the manifests GitHub's dependency graph reads; it installs nothing, so no dependency code runs in that job. `moderate` and `low` advisories are listed in the job's output but do not fail it. On 21 November 2026 there are three, all `moderate` and all in development tooling: `esbuild` [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99), `glob` [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) (through Testcontainers) and `minimatch` [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (through typescript-eslint). No advisory is ignored.

Dependency review reads GitHub's dependency graph, so it needs the dependency graph turned on (Settings → Advanced Security), and on a private repository GitHub Code Security as well; without them the API answers 404 and the job fails with "Dependency review could not obtain dependency data for the specified owner, repository, or revision range.". The audit needs neither. So the job runs only while the repository is public (`if: ${{ !github.event.repository.private }}`): while it is private, the job is skipped, a skipped job reports success, and the ruleset's required `Dependency review` check is met by it. The audit is the gate either way. Making the repository public, or turning on Code Security, brings it back with no change to the workflow.

The workflow is `pull_request` only, never `pull_request_target`, so the code under review runs with a read-only token and no secrets. Every action is pinned by commit SHA, the token is `contents: read`, and checkout does not keep it in git's config.

## Releases

`.github/workflows/release.yml` runs [semantic-release](https://semantic-release.gitbook.io) on every merge to `main`. It reads the [Conventional Commits](https://www.conventionalcommits.org) since the last `v*` tag and chooses the next version. It then updates `CHANGELOG.md` and `package.json`, which supplies the version shown in the app's footer, tags the commit and creates the GitHub release. Planning runs with no write token; only the dependency-free `release/publish.ts` can push.

## The email client

`.github/workflows/publish-email-client.yml` publishes [`@adrianeyre/email-client`](../../packages/email-client/README.md) to GitHub Packages from an `email-client-v<version>` tag on a commit on `main`, and from nothing else: it has no `workflow_dispatch`, so no branch can be published by hand ([pen test I6](../pen-test/findings/I6.md), #175, #177). To release one, bump `version` in `packages/email-client/package.json`, merge it, then tag that commit on `main` and push the tag:

```sh
git fetch origin
git tag email-client-v0.1.0 origin/main
git push origin email-client-v0.1.0
```

| Job       | Token                               | Does                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build`   | `contents: read`                    | Installs the workspace (`--frozen-lockfile`), typechecks, tests, builds and packs the client, and uploads the tarball as an artifact                                                                                                                                                                                                                                                                                |
| `publish` | `contents: read`, `packages: write` | In the `email-client` environment. Installs nothing and runs no package script: checks the tag's commit is an ancestor of `origin/main` (`git merge-base --is-ancestor`), downloads the tarball, checks it holds only `package.json`, `README.md` and `dist`'s JavaScript and types, names this package at the tag's version and has no dependency or install script, then `npm publish <tarball> --ignore-scripts` |

As in `release.yml`, no dependency code runs beside a write token: everything the workspace installs runs in `build`, whose token can't write, and `publish` trusts nothing `build` hands it without checking it first. Neither checkout keeps its token in git's config (`persist-credentials: false`). Both checks are unconditional, so a run that isn't an `email-client-v*` tag on `main`, or a tarball whose version isn't the tag's, publishes nothing.

## Pinned actions

Every `uses:` in every workflow is pinned by a full 40-character commit SHA, with its version in a comment (`# v7.0.1`), so no one who can move a tag in an action's repository can change what runs here (#176). To update one, look up the new tag's commit and change both:

```sh
gh api repos/actions/checkout/git/ref/tags/v7.0.1 --jq '.object.type + " " + .object.sha'
# an annotated tag answers "tag <sha>": dereference it
gh api repos/actions/checkout/git/tags/<sha> --jq .object.sha
```

Dependabot proposes these updates itself (below). `src/pen-test/probes/i6.test.ts` fails on a `uses:` that isn't pinned this way.

## Dependency updates

`.github/dependabot.yml` has Dependabot propose updates every Monday as pull requests, which `checks.yml` checks like any other (#179): the npm packages of the pnpm workspace (the app and `packages/email-client`, one `pnpm-lock.yaml`), grouped into one pull request for production and one for development minor and patch updates, each major on its own; and the SHA-pinned actions, grouped into one. A new release waits seven days (`cooldown`) before it is proposed, so a hijacked release has time to be found and pulled first. Its commits are `build(deps)` and `ci`, which make no release. Security updates, proposed as soon as an advisory is published against a package already in the lockfile, are a repository setting (below).

TypeScript runs side by side, as [TypeScript 7.0's announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) describes. TypeScript 7.0 ships no compiler API, and typescript-eslint refuses to load without one, so in the root `package.json` `typescript` is an alias for `@typescript/typescript6`, which gives typescript-eslint the 6.0 API, and `@typescript/native` is an alias for `typescript@^7`, whose `tsc` is the one `pnpm typecheck` runs. Don't merge a Dependabot pull request that turns `typescript` back into TypeScript 7: lint stops working. Drop the aliases once typescript-eslint supports TypeScript 7.1's API ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)). The email client runs only `tsc`, so it takes TypeScript 7 directly.

## Owner steps after merge

These are GitHub settings, not files, so a pull request can't make them; run them once, as the owner, from a checkout of the repository (`gh` fills in `{owner}` and `{repo}`). Each is the other half of a finding fixed in the repository.

1. **The `email-client` environment, limited to `email-client-v*` tags** (#177). The publish job runs in it; until it exists GitHub makes it on the first run, with no rule.

   ```sh
   gh api -X PUT repos/{owner}/{repo}/environments/email-client \
     -F 'deployment_branch_policy[protected_branches]=false' \
     -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api -X POST repos/{owner}/{repo}/environments/email-client/deployment-branch-policies \
     -f name='email-client-v*' -f type=tag
   ```

   To have each publish wait for a person as well, add a required reviewer: `-F 'reviewers[][type]=User' -F 'reviewers[][id]=<your user id>'` on the first command (`gh api user --jq .id`).

2. **A tag ruleset on `email-client-v*`** (#177): only an admin may create one, and no one may move or delete one, so a published version's tag always names the commit it was built from.

   ```sh
   gh api -X POST repos/{owner}/{repo}/rulesets --input - <<'EOF'
   {
     "name": "email-client tags",
     "target": "tag",
     "enforcement": "active",
     "conditions": { "ref_name": { "include": ["refs/tags/email-client-v*"], "exclude": [] } },
     "rules": [{ "type": "creation" }, { "type": "update" }, { "type": "deletion" }],
     "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }]
   }
   EOF
   ```

   (`actor_id` 5 is the repository admin role, which bypasses all three rules: a token or collaborator without admin can neither create, move nor delete an `email-client-v*` tag.)

3. **Require actions pinned by full commit SHA** (#176), now that every workflow is, so a new tag-pinned `uses:` fails to run:

   ```sh
   gh api -X PUT repos/{owner}/{repo}/actions/permissions \
     -F enabled=true -f allowed_actions=all -F sha_pinning_required=true
   gh api repos/{owner}/{repo}/actions/permissions   # sha_pinning_required: true
   ```

4. **Dependabot alerts and security updates** (#179):

   ```sh
   gh api -X PUT repos/{owner}/{repo}/vulnerability-alerts
   gh api -X PUT repos/{owner}/{repo}/automated-security-fixes
   ```

5. **Require pull requests and passing checks on `main`** (#178). The server deploys whatever is at the tip of `main` and runs no check itself, so the checks must stand in front of `main`. `release.yml` pushes its release commit straight to `main` with the workflow's token, so the ruleset has to let GitHub Actions (the integration with id 15368) bypass it; check that the next release still pushes after adding it.

   ```sh
   gh api -X POST repos/{owner}/{repo}/rulesets --input - <<'EOF'
   {
     "name": "main",
     "target": "branch",
     "enforcement": "active",
     "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
     "rules": [
       { "type": "deletion" },
       { "type": "non_fast_forward" },
       { "type": "pull_request", "parameters": { "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": false, "require_code_owner_review": false, "require_last_push_approval": false, "required_review_thread_resolution": false } },
       { "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": false, "required_status_checks": [{ "context": "Lint" }, { "context": "Typecheck" }, { "context": "Prettier" }, { "context": "Test" }, { "context": "Audit" }, { "context": "Dependency review" }] } }
     ],
     "bypass_actors": [{ "actor_id": 15368, "actor_type": "Integration", "bypass_mode": "always" }]
   }
   EOF
   ```
