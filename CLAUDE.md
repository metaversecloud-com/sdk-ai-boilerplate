# Claude Development Guidelines

> This file is auto-loaded by the Claude Code CLI (and similar agentic tools) when a session opens in this directory. It exists to **point at the real rules** — not to duplicate them.
>
> **Source of truth: [`.ai/rules.md`](.ai/rules.md).** If anything in this file ever contradicts `.ai/rules.md`, `.ai/rules.md` wins.

## Stack

- React + TypeScript (client), Node + Express (server)
- SDK: [`@rtsdk/topia`](https://metaversecloud-com.github.io/mc-sdk-js/index.html)
- Baseline repository: https://github.com/metaversecloud-com/sdk-ai-boilerplate

## Read these before making any change

1. **[`.ai/rules.md`](.ai/rules.md)** — architecture, SDK usage policy, shared types, data-object pattern, `getVisitor` utility, real-time updates (SSE), response schema, testing, workflow, deliverable format, definition of done. **Read this first.**
2. **[`.ai/sdk-fundamentals.md`](.ai/sdk-fundamentals.md)** — protocol-level reference: Interactive Keys, JWT signing, iframes vs webhooks, session credentials, dropped-asset operations, backend validation. Read once early; come back when something is unclear about *why* the SDK works the way it does.
3. **[`.ai/style-guide.md`](.ai/style-guide.md)** — CSS cascade-layer setup (`index.css` / `index.html` / `tailwind.config.js`), SDK class catalog, custom CSS conventions, component structure pattern, checklists.
4. **[`.ai/accessibility.md`](.ai/accessibility.md)** — WCAG 2.1 AA patterns required for every UI change: semantic elements, icon-button labeling, form labels, modal dialog contract, focus management, contrast, motion, testing flow.
5. **[`.ai/examples/`](.ai/examples/)** — specific patterns: badges, inventory cache, dropped assets, data-object scoping, locking, leaderboards, world activity, visitor interactions, analytics tracking, etc.
6. **[`.ai/templates/plan.md`](.ai/templates/plan.md)** — finalization checklist when wrapping up an app.

## Protected files — never modify without explicit permission

These are surfaced here because they're agent-blocking; the full rationale is in `.ai/rules.md`.

- `client/App.tsx`
- `client/src/components/PageContainer.tsx`
- `client/backendAPI.ts`
- `client/setErrorMessage.ts`
- `server/getCredentials.ts`

`client/topiaInit.ts` must exist; its exports may be adjusted.

## Workflow (one-liner)

Plan → implement → test → validate styling + accessibility → finalize (cleanup, README, tests) → deliver. The full workflow with deliverable format is in `.ai/rules.md` under `WORKFLOW` and `DELIVERABLE FORMAT`.

## When blocked

Stop. Propose a minimal stub, list assumptions, ask one concise question. If no answer, proceed with the safest assumption and mark TODOs. See `.ai/rules.md` → `IF BLOCKED`.

---

## App-specific context

When forking this boilerplate into a new app, replace this section with anything specific to your app (game mechanics, required dropped-asset unique names, ecosystem badge names, etc.). Everything else stays in `.ai/`.
