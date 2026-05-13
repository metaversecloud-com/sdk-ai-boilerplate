# Data Object Scoping: User and Visitor Share the Same Record

`User` and `Visitor` (and `World`, `DroppedAsset`) all expose `fetchDataObject` / `updateDataObject` / `setDataObject` / `incrementDataObjectValue`. **`User` and `Visitor` operate on the same underlying record per profile** — they are two access paths to the same data, not two different records.

## Why this matters

A "visitor" in Topia is a session of a user inside a particular world, but the persistent data behind that session is the **user's** (per `profileId`) record scoped to your app. `Visitor.fetchDataObject()` for visitor X in world A returns the same record that `User.fetchDataObject()` returns for that visitor's profile. Writes through either path land in the same place.

```
                ┌──────────────────────────────────────────────┐
                │   profile abc123 — app dataObject            │
                │                                              │
profileId  ──▶  │  triviaSets.{id}: { ... }    (cross-world)   │  ◀──  User.fetchDataObject()
                │  totalAttempts: 4            (cross-world)   │
                │  awardHistory: { ... }       (cross-world)   │
visitorId  ──▶  │  "magicMath-drop_42": { ... }   (per-asset)  │  ◀──  Visitor.fetchDataObject()
                │  "magicMath-drop_43": { ... }   (per-asset)  │
                └──────────────────────────────────────────────┘
```

Both arrows reach the same record. The "scoping" you observe is purely a convention in **how you name keys**, not in which accessor you use.

## Key-naming convention

Because there is one record per profile per app, partition it with key names:

| Scope | Convention | Examples |
| --- | --- | --- |
| Cross-world per-profile (lifetime stats, owned items, settings) | top-level key, no world prefix | `totalAttempts`, `triviaSets.{id}`, `level`, `awardHistory` |
| Per-world per-asset session state | key is `${urlSlug}-${sceneDropId}` (or another disambiguator) | `"magicMath-drop_42": { runs: [...], lastSeen: ... }` |

The `getVisitor` utility (see `rules.md`, "VISITOR INITIALIZATION") already follows this — per-world visitor state is stored under `${urlSlug}-${sceneDropId}` so multiple worlds' sessions coexist in one record without collision.

## When to use which accessor

The accessor changes nothing about the data — only the API endpoint hit and the parameters required:

| Use `Visitor` when | Use `User` when |
| --- | --- |
| You need session-only behavior on the visitor instance: `fireToast`, `triggerParticle`, `moveVisitor`, `fetchInventoryItems`, `isAdmin` | You don't have a live visitor session (webhook, cross-user action like an admin awarding a badge to someone in another world) |
| You're inside a normal iframe request and have `visitorId` / `urlSlug` | You only have a `profileId` |

For the data alone, `Visitor` and `User` reads/writes are interchangeable. `visitor.updateDataObject({ totalAttempts: 5 })` and `user.updateDataObject({ totalAttempts: 5 })` produce identical results when both reference the same profile.

## Implications

- **Cross-world counters work via top-level keys.** Storing `totalAttempts` at the top of the record gives you a true per-profile counter regardless of which world it's incremented from. Storing it under `${urlSlug}-${sceneDropId}` would scope it per-world per-asset.
- **`User.fetchDataObject` returns visitor-namespaced keys too.** Don't be surprised when `user.fetchDataObject()` returns keys like `"slug-dropId"` alongside your top-level fields — those were written via `Visitor.updateDataObject` and live in the same record. Filter by key shape when consuming, e.g. ignore keys containing `-` or matching the world-namespace pattern.
- **`setDataObject` is destructive across the whole record.** Because there is one shared record, `setDataObject({ x: 1 })` wipes per-world visitor state, badge state, and everything else. Prefer `updateDataObject` for partial writes; only use `setDataObject` for first-time initialization (when you know the record is empty) or when you've already merged in everything you need to preserve.
- **Locks scope across both accessors.** Locks are per-record. A lock acquired by `Visitor.updateDataObject` blocks a concurrent `User.updateDataObject` on the same profile.

## Worked example: cross-world counter alongside per-world state

```ts
import { User } from "./topiaInit.js";
import { getVisitor } from "./getVisitor.js";

export const handleAttemptComplete = async (req, res) => {
  const credentials = getCredentials(req.query);
  const { profileId, urlSlug, sceneDropId } = credentials;

  // Visitor for per-asset effects (toast, particle) and per-asset session state.
  const { visitor } = await getVisitor(credentials);

  // User for the cross-world counter. Same backing record as visitor, but the
  // top-level `totalAttempts` key intentionally lives outside any
  // `${urlSlug}-${sceneDropId}` per-world bucket, so it advances regardless
  // of which world / asset the player is in.
  const user = User.create({ credentials, profileId });
  const userData = ((await user.fetchDataObject()) as { totalAttempts?: number }) || {};
  const totalAttemptsAfter = (userData.totalAttempts || 0) + 1;
  await user.updateDataObject({ totalAttempts: totalAttemptsAfter });

  // Per-world session state goes in the visitor-namespaced key.
  const visitorKey = `${urlSlug}-${sceneDropId}`;
  await visitor.updateDataObject({ [visitorKey]: { lastAttemptAt: Date.now() } });
};
```

Both writes target the same record; `totalAttempts` advances regardless of world, and `${urlSlug}-${sceneDropId}` keeps per-asset state isolated.

## Common pitfalls

- **Don't put per-world data at the top level.** Anyone else reading the record via `User` will see your raw key and may interpret it as a global field.
- **Don't `setDataObject` in places where another accessor may have written.** `setDataObject` replaces the whole record. `updateDataObject` is almost always the right call for incremental writes.
- **Don't race yourself by mixing accessors on one field.** If you increment a counter via the visitor and read via the user (or vice versa), each read can see a stale snapshot relative to the other path's pending write. Use one accessor consistently per field, and use locks (or `incrementDataObjectValue`) for high-contention counters.

## Related

- `.ai/examples/awardBadge.md` — cross-user grants via `User.create({ credentials: { ...credentials, profileId: recipientProfileId } })`
- `.ai/examples/lockingPatterns.md` — time-based locks on shared records
- `.ai/examples/dataMigration.md` — schema evolution within a shared record
- `.ai/rules.md` — "VISITOR INITIALIZATION (getVisitor utility)" for the canonical per-world key pattern
