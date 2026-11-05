# Trophy Asset Pattern

A standalone **Trophy** dropped asset that opens a drawer with **Leaderboard + Badges** (and optionally other read-only tabs). First seen in sdk-monster-mash; now the default surface for apps that have both a leaderboard and a badge catalog.

> This is about the *surface* — a dedicated asset and a dedicated endpoint. For the badge UI tile itself (tooltip, grayscale lock), keep following the simple component example in [`badges.md`](./badges.md) — it covers one BadgesTab well, and this doc builds on it.

## Why a standalone Trophy asset

- **Discoverability.** The leaderboard and badge grid belong on a single, obvious asset — not buried behind a tab inside the main gameplay drawer. Every visitor opens it the same way.
- **Independence from gameplay.** The main gameplay asset(s) (quiz, builder, spot, etc.) can stay focused on their own flow. The Trophy drawer never blocks or interacts with game state — it's read-only and safe to open mid-round.
- **One request per open.** The Trophy opens with a single `GET /trophy` that returns everything both tabs need. No per-tab fetches, no loading states between tab switches.
- **Clean admin reset surface.** Admin-only "Reset Leaderboard" lives inside the Leaderboard tab — far enough away from gameplay admin settings that it can't be hit by accident.

## When to use this vs. inline tabs

| Situation | Use |
|---|---|
| App has leaderboard **and** badges, both world-wide | **Standalone Trophy asset** (this doc) |
| App has only badges, surfaced on the player's own drawer | Inline tabs on the main drawer — follow [`badges.md`](./badges.md) |
| App has only a leaderboard | Inline tab or small panel — see [`leaderboard.md`](./leaderboard.md) |

## Asset setup

Drop a dedicated Trophy asset into each scene that should expose the leaderboard/badges. Give it a unique `uniqueName` (e.g. `MyApp_trophy`) so the server can recognize it. Point its iframe URL at the app with a route param that selects the Trophy screen — the exact param is up to you, but reusing `?screen=trophy` keeps it consistent with the rest of the boilerplate:

```
https://<app-domain>/?screen=trophy
```

The platform appends the usual interactive params (`visitorId`, `profileId`, `urlSlug`, `sceneDropId`, `assetId`, etc.) automatically — nothing extra needed.

## Server: one endpoint, one payload

Create `server/controllers/handleGetTrophy.ts` returning leaderboard rows + the full badge grid in one response.

```ts
import { Request, Response } from "express";
import {
  errorHandler,
  getBadges,
  getCredentials,
  getKeyAsset,
  getVisitor,
  getVisitorBadges,
  parseLeaderboardRow,
} from "@utils/index.js";

const LEADERBOARD_CAP = 25;

export const handleGetTrophy = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const forceRefreshInventory = req.query.forceRefreshInventory === "true";

    const keyAsset = await getKeyAsset(credentials);
    const dataObject = keyAsset.dataObject as { leaderboard?: Record<string, string> };

    // Visitor + inventory in one hop. `includeInventory` populates the
    // visitor's owned badges so we can mark grid tiles as owned below.
    const { isAdmin, visitorInventory } = await getVisitor(credentials, {
      shouldGetVisitorDetails: true,
      includeInventory: true,
      forceRefreshInventory,
    });

    // Parse + sort the leaderboard. Rows are pipe-joined strings on disk
    // (see leaderboard.md) — parse once before sorting.
    const rows = Object.entries(dataObject.leaderboard ?? {})
      .map(([profileId, row]) => ({ profileId, ...parseLeaderboardRow(row) }))
      .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

    const ranked = rows.map((r, idx) => ({
      rank: idx + 1,
      profileId: r.profileId,
      displayName: r.displayName || r.profileId,
      score: r.score,
      isCaller: r.profileId === credentials.profileId,
    }));

    // Top N + caller's own row if they fell outside the top N — so every
    // visitor can see where they stand without scrolling a 500-row table.
    const top = ranked.slice(0, LEADERBOARD_CAP);
    const callerRow = ranked.find((r) => r.isCaller && r.rank > LEADERBOARD_CAP);

    // Badges: full ecosystem grid + ownership flags from visitor inventory.
    // Prefer the visitor's own copy of the art when present (same URL anyway),
    // fall back to catalog art for locked tiles.
    const badges = await getBadges(credentials, forceRefreshInventory);
    const ownedNames = new Set(Object.keys(visitorInventory?.badges ?? {}));
    const badgeRows = Object.values(badges).map((b) => ({
      name: b.name,
      description: b.description,
      group: (b as any).group, // see "Badge groups" below
      owned: ownedNames.has(b.name),
      iconUrl: visitorInventory?.badges?.[b.name]?.icon || b.icon || undefined,
    }));

    return res.json({
      success: true,
      data: {
        leaderboard: top,
        callerRow,
        cap: LEADERBOARD_CAP,
        badges: badgeRows,
        ownedBadgesCount: badgeRows.filter((b) => b.owned).length,
        totalBadges: badgeRows.length,
        isAdmin,
      },
    });
  } catch (error) {
    return errorHandler({ error, functionName: "handleGetTrophy", message: "Error getting trophy", req, res });
  }
};
```

Key points:

- **`forceRefreshInventory` from the query string** — same pattern as every other game-state endpoint, lets Topia bust the inventory cache after an inventory ZIP re-upload. See [`inventoryCache.md`](./inventoryCache.md).
- **Top N + caller row.** When the caller is outside the top N, include their row as a separate `callerRow` field so the client can render it pinned below the table.
- **One `getVisitor` call** does admin check + inventory fetch — don't double-fetch.
- **Shape the response for the client.** The controller flattens ecosystem + visitor data into render-ready `badgeRows` — the client should not need to join the two sides.

### Route it

```ts
// server/routes/index.ts (or wherever routes are wired)
router.get("/trophy", handleGetTrophy);
```

## Client: Trophy page + two tab components

### Routing

Dispatch to `<Trophy />` from the same router that picks the screen (Monster Mash reads `?screen` in `Home.tsx` — any equivalent works):

```tsx
// client/src/pages/Home.tsx
const screen = searchParams.get("screen") ?? "main";
if (screen === "trophy") return <Trophy />;
```

### Trophy page

Single fetch, tab state local to the page. The two tab components receive their slice of the payload as props — no additional context plumbing needed because the payload is read-only.

```tsx
// client/src/pages/Trophy.tsx
import { useContext, useEffect, useState } from "react";
import { BadgesTab, LeaderboardTab, PageContainer } from "@/components";
import { GlobalDispatchContext, GlobalStateContext } from "@/context/GlobalContext";
import { ErrorType } from "@/context/types";
import { backendAPI, setErrorMessage } from "@/utils";

type TabId = "leaderboard" | "badges";

export const Trophy = () => {
  const dispatch = useContext(GlobalDispatchContext);
  const { hasInteractiveParams } = useContext(GlobalStateContext);
  const [tab, setTab] = useState<TabId>("leaderboard");
  const [payload, setPayload] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTrophy = () => {
    setIsLoading(true);
    backendAPI
      .get("/trophy")
      .then((res) => res?.data?.success && setPayload(res.data.data))
      .catch((error) => setErrorMessage(dispatch, error as ErrorType))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    if (hasInteractiveParams) fetchTrophy();
  }, [hasInteractiveParams]);

  return (
    <PageContainer isLoading={isLoading}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Trophy tabs">
          {(["leaderboard", "badges"] as TabId[]).map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={`btn ${tab === id ? "" : "btn-outline"}`}
              onClick={() => setTab(id)}
            >
              {id === "leaderboard" ? "Leaderboard" : "Badges"}
            </button>
          ))}
        </div>

        {payload && tab === "leaderboard" && (
          <LeaderboardTab
            rows={payload.leaderboard}
            callerRow={payload.callerRow}
            isAdmin={payload.isAdmin}
            onAfterReset={fetchTrophy}
          />
        )}
        {payload && tab === "badges" && (
          <BadgesTab badges={payload.badges} ownedCount={payload.ownedBadgesCount} totalCount={payload.totalBadges} />
        )}
      </div>
    </PageContainer>
  );
};
```

**Accessibility:** `role="tablist"` + `role="tab"` + `aria-selected` on the buttons, `aria-label` on the list. See [`accessibility.md`](../accessibility.md) for the full dialog/focus contract.

### LeaderboardTab

Keep the top table + the caller's own row (when outside the top N) + an admin reset button. Follow the `<table className="table">` structure in [`leaderboard.md`](./leaderboard.md), and add a small "pinned caller row" below:

```tsx
// client/src/components/LeaderboardTab.tsx — excerpt
{rows.map((row) => (
  <tr key={row.profileId} className={row.isCaller ? "highlight" : ""}>
    <td className="p2">{row.rank}</td>
    <td className="p2">{row.displayName}</td>
    <td className="p2">{row.score}</td>
  </tr>
))}
{callerRow && (
  <tr className="highlight">
    <td className="p2">{callerRow.rank}</td>
    <td className="p2">{callerRow.displayName} (you)</td>
    <td className="p2">{callerRow.score}</td>
  </tr>
)}
```

Admin reset: a `btn btn-danger-outline` that opens a `ConfirmationModal`, POSTs `/leaderboard/reset`, then calls `onAfterReset` to re-fetch the Trophy payload.

### BadgesTab

For the grid itself, reuse the inline grayscale/tooltip component in [`badges.md`](./badges.md) — it's the simple pattern and still right. The only addition here is **group headers** when the catalog has groups.

> **Rendering rule (same as [`badges.md`](./badges.md)):** iterate over the **ecosystem badge catalog** returned by the server, not a hardcoded list of badge names. For every tile, use `badge.iconUrl` (or the visitor's copy of the same art when present) and apply `filter: grayscale(1)` only when the badge is not owned. Never let the icon come from `visitorInventory` alone — that record doesn't contain unowned badges, so locked tiles would silently render blank. This was Birdwatch's bug before the fix; don't re-introduce it.

## Badge groups (categories)

Apps with more than ~8 badges benefit from grouping (Monster Mash splits into `building` / `voting` / `visiting` / `winning`; Birdwatch splits by Collection). Groups live on each badge item's **ecosystem metadata**, not in app code — so adding a new group is an inventory ZIP re-import, not a deploy.

### Where groups come from

In the inventory ZIP's `items.json`, each BADGE item carries `metadata.group` and `metadata.sortOrder`:

```json
{
  "name": "Mad Scientist",
  "type": "BADGE",
  "status": "ACTIVE",
  "metadata": { "group": "building", "sortOrder": 10, "displayName": "Mad Scientist" },
  ...
}
```

See `docs/claude/inventory-zip-format.md` for the full importer contract — **re-read it every time** before producing a ZIP; the format evolves.

### Reading groups on the server

Extend `getBadges` (or a `getBadgeCatalog` variant) to carry `group` and `sortOrder` into the `BadgeRecord`:

```ts
// Inside getBadges, when building each entry:
badges[name] = {
  id,
  name,
  icon: image_path || "",
  description: description || "",
  group: (item.metadata?.group as string) || "default",
  sortOrder: typeof item.metadata?.sortOrder === "number" ? item.metadata.sortOrder : Number.MAX_SAFE_INTEGER,
};
```

Sort by `sortOrder` asc, with `name` as a stable tiebreak. The controller then returns `badges` flat; the tab bucketizes by group for display.

### Rendering groups

```tsx
// client/src/components/BadgesTab.tsx — excerpt
const GROUP_ORDER = ["building", "voting", "visiting", "winning"] as const;
const GROUP_LABELS: Record<string, string> = {
  building: "For building",
  voting: "For voting",
  visiting: "For visiting",
  winning: "For winning",
};

const byGroup = GROUP_ORDER.map((group) => ({
  group,
  label: GROUP_LABELS[group] ?? group,
  items: badges.filter((b) => b.group === group),
}));

return (
  <div className="flex flex-col gap-4">
    <div className="flex items-baseline justify-between">
      <p className="text-xs uppercase tracking-wider">Your Badges</p>
      <p className="text-xs">{ownedCount} of {totalCount}</p>
    </div>
    {byGroup.map(({ group, label, items }) => (
      <section key={group}>
        <h5 className="mb-1 capitalize">{label}</h5>
        <div className="grid grid-cols-3 gap-2">
          {items.map((badge) => {
            // Use the same grayscale-on-locked rule from badges.md
            const style: React.CSSProperties = badge.owned
              ? { filter: "none", opacity: 1 }
              : { filter: "grayscale(1)", opacity: 0.7 };
            return (
              <div className="tooltip" key={badge.name}>
                <span className="p3 tooltip-content" style={{ width: "115px" }}>
                  {badge.description || badge.name}
                </span>
                {badge.iconUrl ? (
                  <img src={badge.iconUrl} alt={badge.name} style={style} />
                ) : (
                  <span className="flex items-center justify-center w-24 h-24" aria-hidden>?</span>
                )}
                <p className="text-xs">{badge.name}</p>
              </div>
            );
          })}
        </div>
      </section>
    ))}
  </div>
);
```

- **Group order is app code, not metadata.** Hard-code the order you want sections to appear — the ecosystem only tells you *which* group a badge belongs to.
- **Unknown groups degrade safely.** A badge whose `metadata.group` doesn't match any known key should either show under a "default" catch-all or be dropped — never crash the grid.
- **Prefer the visitor's copy of the art when owned** (same URL anyway, but the SDK path is stable); fall back to the catalog art for locked tiles so the grayscaled image still reads as that badge.

## Admin-only Leaderboard reset (optional)

The Trophy drawer is the natural home for an admin-only "Reset Leaderboard" button:

```ts
// server/controllers/handleResetLeaderboard.ts — admin gate + wipe
const { visitor } = await getVisitor(credentials);
if (!visitor.isAdmin) return res.status(403).json({ success: false, error: "Admin only" });

const keyAsset = await getKeyAsset(credentials);
await keyAsset.updateDataObject({ leaderboard: {} });
return res.json({ success: true });
```

Client-side: a `ConfirmationModal` that calls `backendAPI.post("/leaderboard/reset")` then re-fetches `/trophy`. The confirmation copy should explicitly say "Badges are not affected" — resetting the leaderboard **must not** revoke granted badges.

## File Summary

| File | Purpose |
|---|---|
| `server/controllers/handleGetTrophy.ts` | Returns leaderboard + badges grid in one request |
| `server/controllers/handleResetLeaderboard.ts` | Admin-only leaderboard wipe |
| `server/utils/getBadges.ts` | Reads badge catalog + `group`/`sortOrder` from ecosystem (see `badges.md`) |
| `client/src/pages/Trophy.tsx` | Trophy page: single fetch + tab switcher |
| `client/src/components/LeaderboardTab.tsx` | Leaderboard table + caller row + admin reset |
| `client/src/components/BadgesTab.tsx` | Grouped badge grid (reuses grayscale pattern from `badges.md`) |

## Related Examples

- [`badges.md`](./badges.md) — `getBadges` / `getVisitorBadges` utilities and the base BadgesTab component (locked-tile grayscale, tooltip). Still the right pattern for the grid itself.
- [`leaderboard.md`](./leaderboard.md) — pipe-delimited row format, parsing, sort strategies, `<table className="table">` structure.
- [`inventoryCache.md`](./inventoryCache.md) — 6-hour ecosystem inventory cache + `forceRefresh` contract.
- [`awardBadge.md`](./awardBadge.md) — granting a badge in response to gameplay (what fills the Trophy grid).
