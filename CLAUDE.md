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

**All changes happen on development branches. Main stays clean.**

## Before Any Change

1. If on `main`, create a development branch: `dev/<short-description>` (e.g., `dev/fix-login`, `dev/add-export`)
2. If already on a dev branch, continue on it
3. If there are uncommitted changes on `main`, stash them first, then create the branch

## During Development

- All commits go to the development branch
- Commit freely — squash merge will consolidate them later
- Never push the dev branch unless the user explicitly asks

## After User Confirms Completion

1. Verify all changes are committed on the dev branch
2. Ask user: "All changes verified? Ready to squash merge into main?"
3. Once confirmed:
   - `git checkout main && git pull origin main`
   - `git merge --squash <dev-branch>`
   - Commit with a single message that **summarizes all changes** on the branch — a bullet-point summary of what was done and why
   - `git push origin main`
   - Delete the dev branch locally and remotely: `git branch -d <dev-branch> && git push origin --delete <dev-branch>`

## Squash Commit Message Format

Use Conventional Commits:

```text
<type>[optional scope]: <description>

- <change 1>
- <change 2>
- <change 3>

[optional footer(s)]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

Use `git log main..<dev-branch> --oneline` to review all commits before writing the squash message. The message must cover every meaningful change, not just the last commit.

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
wrangler.jsonc          # Cloudflare Worker config
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
