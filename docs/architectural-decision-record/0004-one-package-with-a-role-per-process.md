# One package with a role per process

Issue #20 asked for a pnpm workspace with separate packages for the API, workers, UI and shared code. We built one package instead. Its folders under `src/` hold the subsystems (`access`, `templates`, `sending`, `settings`), and the composition root `src/index.ts` starts one role per process: `api`, `worker`, `migrate` or `cli`. Docker Compose runs the same image once per role.

Every role shares the schema, the job queue and the send pipeline. The API accepts Messages and the worker sends them. With separate packages, almost all the code would have lived in "shared", and every change would have meant rebuilding and linking packages for no isolation in return. One package keeps one `tsc` build, one test run and one Dockerfile, yet each role still runs and restarts as its own container.

## Consequences

- A subsystem never imports a role. Only `src/index.ts` wires roles together.
- The UI in `src/ui` is built by Vite into `dist/ui` and served by the `api` role. It talks to the server only over HTTP, so no server code reaches the browser bundle.
