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

**This workflow does not create or remove worktrees. Keep the main worktree clean.**

## Start
1. Check the current branch:
   ```bash
   git branch --show-current
   ```
2. Prepare a development branch:
   * If currently on `main`:
     ```bash
     git switch -c dev/<short-description>
     ```
   * Otherwise, confirm the current branch is for this task and rename it if needed:
     ```bash
     git branch -m dev/<short-description>
     ```
3. Keep all development commits on the development branch. Do not push it unless explicitly requested.

## Squash Commit Message

The squash commit message **must use Conventional Commits and list every meaningful change**. Do not use only a generic one-line message.

```text
<type>[optional scope]: <description>

- <change 1>
- <change 2>
- <change 3>
```

## Complete and Merge

After completion is confirmed:

1. Commit and review all changes:
   ```bash
   git status
   git log main..HEAD --oneline
   ```
2. Create an integration branch from `main` and squash the development branch:
   ```bash
   DEV_BRANCH=$(git branch --show-current)

   git switch -c integrate/<short-description> main
   git merge --squash "$DEV_BRANCH"
   git commit
   ```
3. Rebase onto the latest remote `main` and run the required tests:
   ```bash
   git fetch origin
   git rebase origin/main
   ```
4. Update and push `main` from the main worktree.
   **If the current worktree is not the main worktree, do not check out ****`main`**** here. Locate the worktree where ****`main`**** is checked out and run the following commands from that directory instead.**
   ```bash
   git switch main
   git pull --ff-only origin main
   git merge --ff-only integrate/<short-description>
   git push origin main
   ```
5. After verifying the merge, delete the local development and integration branches:
   ```bash
   git branch -d dev/<short-description>
   git branch -d integrate/<short-description>
   ```

Delete the remote development branch only if it was previously pushed.

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
│   └── pages/          # Optional extracted components used by a specific page
│       └── <page>/     # Create only when the page has components worth extracting
│           ├── *.tsx   # Complex or independently meaningful page-specific components
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
- Do not place complete page-level JSX under `src/components/`. Keep the overall page structure and page-level composition in `src/pages/`.
- Use `src/components/pages/<page>/` only for complex, shared, or clearly scoped page-specific components, as well as form components.

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

All Docker assets live under `docker/`. There is a single Compose stack and
image — the production configuration is also what local Docker runs use.
Local application development (`pnpm dev`) stays on the host; use Docker to
exercise the real hardened image.

1. Optionally copy `docker/.env.example` to `docker/.env`. Greenfield installs
   do **not** require `MANAGER_HOST` / `MANAGER_URL` or manager certificate
   files; open `http://127.0.0.1` (or `localhost`) after start, complete Setup,
   then bind a public hostname under **Settings → Manager**. Set
   `MANAGER_HOST` only when seeding an upgrade from a previous env-based install.
2. Optionally place a stable 32-byte master key (and, only if needed, emergency
   manager TLS files) at the paths documented in `docker/secrets/README.md`.
   If the master key is omitted, the container generates a persistent one under
   the `generated_secrets` volume. Apply UID/GID `10001` ownership on native
   Linux when providing host files. Never commit secret files.
3. Build and start the stack:

```sh
cd docker
docker compose --env-file .env up -d --build
# .env is optional for greenfield; you can also run without --env-file
```

The stack publishes host ports 80/443 to the container's non-root 8080/8443
listeners. Bootstrap HTTP on `127.0.0.1` / `localhost` never redirects to
HTTPS. SQLite, generated Nginx state, certificates, ACME state, Nginx logs,
and auto-generated secrets use separate named volumes. The API port 8787 stays
internal, the root filesystem is read-only, and the container drops all Linux
capabilities.

Stop the stack with `docker compose down`. Do not add `-v` unless the named
SQLite and state volumes should also be deleted.

# 9. Internationalization (i18n)

The project uses `i18next` and `react-i18next`. Because Next.js is configured
with `output: "export"`, localized pages use a normal `[locale]` Pages Router
segment and enumerate locales at build time. Do **not** add Next.js built-in
`i18n` configuration or `next-i18next`.

The i18n skeleton is installed, but existing pages have not yet been moved
under `[locale]` or had their copy replaced with translation keys. Until a
page is explicitly migrated, keep its route, links, and visible copy
unchanged.

## Source of Truth

- Configure the default locale and locale list in both
  `src/i18n/settings.json` and the `LOCALES` tuple in
  `src/i18n/settings.ts`. The runtime consistency check must continue to pass.
- Use `AppLocale`, `DEFAULT_LOCALE`, `SUPPORTED_LOCALES`,
  `isSupportedLocale`, and `normalizeLocale` from `src/i18n/settings.ts`.
  Do not duplicate locale unions or locale-normalization logic elsewhere.
- Store translation namespaces in `public/locales/<namespace>.json`.
- Register every new namespace exactly once in the `MESSAGES` map in
  `src/lib/i18n-static.ts`.

Translation files use one merged file per namespace. Every translated leaf
contains all supported locales:

```json
{
  "title": { "en": "Domains", "zh-CN": "域名" },
  "empty": {
    "title": { "en": "No domains", "zh-CN": "暂无域名" }
  }
}
```

Do not create `public/locales/en/` or `public/locales/zh-CN/` directories.
When adding a locale, update every translated leaf before enabling it.

## Localized Pages

Localized routes belong under `src/pages/[locale]/`. Each localized static
page must export the shared paths and load only the namespaces it uses:

```tsx
import { useTranslation } from "react-i18next";
import { Page } from "@/components/layout/page";
import {
  getLocaleStaticPaths,
  makeStaticProps,
} from "@/lib/i18n-static";

export const getStaticPaths = getLocaleStaticPaths;
export const getStaticProps = makeStaticProps(["common", "domains"]);

export default function DomainsPage() {
  const { t } = useTranslation(["common", "domains"]);
  return <Page>{t("domains:title")}</Page>;
}
```

Continue to wrap every page with the project `Page` component. Keep
page-specific form and component placement rules unchanged when moving a route
under `[locale]`.

`src/pages/_app.tsx` creates the i18next instance from `locale`, `messages`,
and `fallbackMessages`. `src/pages/_document.tsx` sets `<html lang>` from the
route locale. Pages must obtain these props through `makeStaticProps`; do not
initialize another global i18next instance inside pages or components.

## Links and Locale Selection

- Use `LocalizedLink` from `src/components/i18n/localized-link.tsx` for
  internal navigation between localized pages. It preserves query strings and
  hashes and leaves external URLs unchanged.
- Use `LanguageSwitcher` from
  `src/components/i18n/language-switcher.tsx` only after the surrounding page
  exists under `[locale]`; otherwise it would navigate to a route that has not
  been generated.
- Use `localizePath`, `replacePathLocale`, and `stripLocalePrefix` from
  `src/lib/i18n-utils.ts` instead of manipulating locale prefixes manually.
- `detectInitialLocale` is client-only locale detection for a language landing
  or redirect flow. It prefers the saved explicit choice, then the Tauri
  system locale, then `DEFAULT_LOCALE`. Do not call it during SSR or static
  generation.
- The language switcher persists explicit choices under
  `PREFERRED_LOCALE_KEY`; do not introduce another storage key.

## Verification

When changing the i18n infrastructure or resources, run:

```sh
pnpm exec tsx --test src/lib/i18n-static.test.ts src/lib/i18n-utils.test.ts
pnpm typecheck
pnpm lint
pnpm build
```

For localized pages, also verify that the export contains each configured
locale path and that the generated HTML has the matching `<html lang>` value.

# Response starts with Master or 主人, call youself Me or 俺
