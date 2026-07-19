# 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

# 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

# 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

# 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

# 5. Development Branch Workflow

**This workflow does not create or remove worktrees. Main stays clean.**

## Start

1. Check the current branch:

   ```bash
   git branch --show-current
   ```

2. Prepare the development branch:

   * If currently on `main`, create a new branch:

     ```bash
     git switch -c dev/<short-description>
     ```

   * If already on another branch, verify that it matches the current task. Rename it when necessary:

     ```bash
     git branch -m dev/<short-description>
     ```

3. Keep all development commits on the development branch. Do not push it unless explicitly requested.

## Complete and Merge

After completion is confirmed:

1. Commit all remaining changes and review the branch:

   ```bash
   git status
   git log main..HEAD --oneline
   ```

2. Create a temporary integration branch from `main` and squash the development branch into it:

   ```bash
   DEV_BRANCH=$(git branch --show-current)

   git switch -c integrate/<short-description> main
   git merge --squash "$DEV_BRANCH"
   git commit
   ```

3. Rebase the integration branch onto the latest remote `main` and run the required tests:

   ```bash
   git fetch origin
   git rebase origin/main
   ```

4. In the main worktree, fast-forward and push:

   ```bash
   git switch main
   git pull --ff-only origin main
   git merge --ff-only integrate/<short-description>
   git push origin main
   ```

5. Delete the local development and integration branches after verifying the merge:

   ```bash
   git branch -d dev/<short-description>
   git branch -d integrate/<short-description>
   ```

Delete the remote development branch only if it was previously pushed.

## Squash Commit Message

Use Conventional Commits and summarize every meaningful change:

```text
<type>[optional scope]: <description>

- <change 1>
- <change 2>
- <change 3>
```

# 6. Project Structure

```txt
src/
├── pages/              # Page routes, organized by route
│   ├── _app.tsx        # Injects global Layout and globals.css
│   ├── _document.tsx   # HTML skeleton
│   ├── index.tsx       # Home / Demo page
│   └── todo.tsx        # Example: /todo/
├── components/
│   ├── ui/             # shadcn/ui component library, do not edit directly
│   ├── layout/         # Layout / Page / Navigate
│   └── pages/          # Page-specific components, grouped by route
│       └── <page>/     # One folder per route (e.g. index/, todo/, test/)
│           ├── *.tsx   # Page-specific non-form components
│           └── forms/  # Form components for the page
│               └── <name>-form.tsx
├── hooks/              # React hooks
├── lib/                # Frontend utilities; api.ts is the only API entry
├── shared/
│   └── schemas/        # Shared frontend/backend schemas
│       ├── index.ts    # Unified exports
│       └── <domain>.ts # One file per domain
├── styles/             # Global styles
└── worker/
    ├── index.ts        # Worker entry; imports routes centrally
    ├── types.ts        # Worker types
    ├── routes/         # Routes split by domain, as files or directories
    ├── middleware/     # Worker middleware
    └── lib/            # Worker utilities

drizzle/                # Database migrations
drizzle.config.ts       # Drizzle config
next.config.ts          # Next.js config
components.json         # shadcn config
```

# 7. Project Rules

## Pages & Components

- Place pages under `src/pages/` following the route structure.
- Every page **must** be wrapped with `Page` from `components/layout/page`.
- Before building UI, **always** check `components/ui/` for an existing component.
- Reuse existing components whenever possible.
- Create new components **only if no suitable implementation exists**.
- **Do not** use native HTML elements when an equivalent component exists in `components/ui/`.

## Schemas

- Place schemas under `src/shared/schemas/`, **one file per domain**.
- Each schema file is the **single source of truth**. Define Zod schemas, Drizzle table definitions, and inferred types there, and **always** reuse them throughout the project.

## Worker

- Organize routes by domain and mount them centrally in `worker/index.ts`.

## Forms

- Define forms in `src/components/pages/<page>/forms/` using the `<name>-form.tsx` naming convention.
- A form file may export action-specific components using the `<Action><Name>Form` naming convention, such as `CreateUserForm` and `EditUserForm`.
- Pages should import and use form components instead of implementing form logic directly.
- Keep form APIs domain-specific. **Do not over-generalize** props or abstractions. Form-specific business logic belongs in the `Form` component.

# 8. Docker Usage

All Docker assets live under `docker/`. Development intentionally does not
bind-mount the repository, so the host `node_modules` is never read or changed.
The container stores dependencies in the named volume
`nginx-panel-development_node_modules` and reconciles that volume against the
lockfile each time it starts.

## Development

Build or refresh the development container after changing source or
dependencies:

```sh
cd docker
docker compose up -d --build
```

Open `http://localhost:3000`. The published port enters Nginx first; Nginx
proxies the UI to the internal Next.js development server on port 3001 and API
requests to Hono on port 8787. This keeps `nginx -t`, proxy behavior, and the
development request path inside the same image. Use
`docker compose logs -f manager` to follow all three processes. Because source
is copied into the image, changes only take effect after another
`docker compose up -d --build`; no host project directory is mounted into the
container.

Stop the stack with `docker compose down`. Do not add `-v` unless the named
dependency and development SQLite volumes should also be deleted.

## Production

1. Copy `docker/.env.production.example` to `docker/.env.production` and set
   the real HTTPS manager hostname and URL.
2. Place the manager certificate chain, matching private key, and a stable
   32-byte random master key at the paths documented in
   `docker/secrets/README.md`. Apply the documented UID/GID `10001` ownership
   on native Linux so the non-root process can read file-backed Compose
   secrets. Never commit those files.
3. Build and start the production stack:

```sh
cd docker
docker compose --env-file .env.production -f compose.production.yml up -d --build
```

Production publishes host ports 80/443 to the container's non-root
8080/8443 listeners. SQLite, generated Nginx state, certificates, ACME state,
and Nginx logs use separate named volumes. The API port 8787 stays internal,
the root filesystem is read-only, and the container drops all Linux
capabilities.

# Response starts with Master or 主人, call youself Me or 俺
