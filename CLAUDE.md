# Claude Development Guidelines

This document provides Claude-specific guidelines for working with this Topia SDK React + TypeScript template repository.

## Project Context

- **Stack**: React + TypeScript (client), Node + Express (server)
- **SDK**: JavaScript RTSDK – Topia Client Library (@rtsdk/topia)
- **SDK Documentation**: https://metaversecloud-com.github.io/mc-sdk-js/index.html
- **Baseline Repository**: https://github.com/metaversecloud-com/sdk-ai-boilerplate

## Core Development Rules

### File Modification Restrictions

**DO NOT MODIFY these protected files:**

- `client/App.tsx`
- `client/src/components/PageContainer.tsx`
- `client/backendAPI.ts`
- `client/setErrorMessage.ts`
- `server/getCredentials.ts`
- `server/errorHandler.ts`

**REQUIRED FILES:**

- `client/topiaInit.ts` MUST exist (may adjust exports if needed)

### Architecture & Data Flow

1. **Server-First Architecture**: All SDK calls happen in server routes/controllers or server/utils - NEVER directly from React
2. **API Flow**: UI → `client/backendAPI.ts` (unchangeable) → server routes/controllers → Topia SDK
3. **New Client Behavior**: Expose new server routes; do NOT bypass `backendAPI.ts`
4. **Follow Existing Patterns**: Use patterns in existing client files for pages, components, and server calls

### SDK Usage Guidelines

#### Initialization

- Initialize Topia ONCE on the server with environment variables:
  - `API_KEY`, `INTERACTIVE_KEY`, `INTERACTIVE_SECRET`
  - `INSTANCE_DOMAIN=api.topia.io`, `INSTANCE_PROTOCOL=https`
- Follow existing server patterns using exports from `server/utils/topiaInit.ts`

#### Error Handling

- Wrap all SDK calls in try/catch blocks
- Either return JSON `{ success: boolean, ... }` or throw and let `server/errorHandler.ts` handle it
- Follow existing controller patterns for error handling

#### Data Objects Pattern

#### User.create and profileId

`User.create` requires `profileId` in the credentials:

- **Self** (user acting on their own behalf): `profileId` is already in credentials from `req.query` — use `User.create({ credentials })`
- **Cross-user** (acting on another user, e.g., admin awarding a badge): override `profileId` — use `User.create({ credentials: { ...credentials, profileId: recipientProfileId } })`

See `.ai/examples/awardBadge.md` for a full example.

#### Data Objects

World/Visitor/User/DroppedAsset classes provide these methods:

- `fetchDataObject` - Get current data
- `setDataObject` - Set initial/complete data
- `updateDataObject` - Update partial data
- `incrementDataObjectValue` - Increment numeric values

**CRITICAL**: Always ensure defaults before calling `updateDataObject`:

1. Check if data object exists
2. If missing properties, call `setDataObject` with default shape
3. Then safely use `updateDataObject`

Follow the pattern: `handleGetGameState.ts` → `getDroppedAsset` → `initializeDroppedAssetDataObject`

#### Analytics Integration

All data object methods accept optional `analytics` array:

```typescript
await visitor.setDataObject(
  { hello: "world" },
  { analytics: [{ analyticName: "starts" }], lock: { lockId, releaseLock: true } },
);

await visitor.updateDataObject(
  {},
  { analytics: [{ analyticName: "emotesUnlocked", profileId, uniqueKey: profileId, urlSlug }] },
);

await visitor.incrementDataObjectValue(`completions`, 1, {
  analytics: [{ analyticName: "completions", incrementBy: 2, profileId, uniqueKey: profileId, urlSlug }],
});
```

### Inventory Cache Pattern

When your app needs to access ecosystem inventory items (badges, decorations, etc.), implement the inventory cache pattern to reduce API calls:

```typescript
// server/utils/inventoryCache.ts
import { getCachedInventoryItems } from "./inventoryCache.js";

// Get all cached items (24-hour TTL)
const items = await getCachedInventoryItems({ credentials });

// Filter for badges
const badges = items.filter((item) => item.type === "BADGE" && item.status === "ACTIVE");

// Award a badge to visitor
const badge = items.find((item) => item.name === "Winner Badge");
await visitor.grantInventoryItem(badge, 1);
```

**Key Features:**

- 24-hour cache TTL reduces API calls
- Stale cache fallback on API failure
- `forceRefresh: true` option for immediate refresh
- See `.ai/examples/inventoryCache.md` for full implementation

### Response Schema (Controllers)

- **Success**: `{ success: true, data?: any }`
- **Failure**: `{ success: false, error: string }` (handled by errorHandler.ts)
- **HTTP Codes**: 200 (success), 204 (no body), 4xx (validation), 5xx (SDK/server)

## Styling Requirements

### SDK CSS Classes (REQUIRED)

**MUST use SDK CSS classes from**: https://sdk-style.s3.amazonaws.com/styles-3.0.2.css

#### Typography

```tsx
<h1 className="h1">Heading 1</h1>
<h2 className="h2">Heading 2</h2>
<p className="p1">Standard body text</p>
<p className="p2">Medium body text</p>
```

#### Buttons

```tsx
<button className="btn">Primary Action</button>
<button className="btn btn-outline">Secondary Action</button>
<button className="btn btn-text">Text Button</button>
<button className="btn btn-danger">Error Button</button>
```

#### Cards

```tsx
<div className="card">
  <div className="card-image">
    <img src="image-url.jpg" alt="Description" />
  </div>
  <div className="card-details">
    <h3 className="card-title">Title</h3>
    <p className="card-description p2">Description</p>
    <div className="card-actions">
      <button className="btn btn-icon">
        <img src="https://sdk-style.s3.amazonaws.com/icons/edit.svg" />
      </button>
    </div>
  </div>
</div>
```

#### Form Elements

```tsx
<label className="label">Text Input</label>
<input className="input" type="text" placeholder="placeholder" />

<label className="label">
  <input className="input-checkbox" type="checkbox" />
  Checkbox Label
</label>
```

### Styling Rules

- **SDK Classes First**: Always use SDK classes before considering alternatives
- **No Tailwind**: Only use Tailwind when no SDK class exists
- **No Inline Styles**: Except for dynamic positioning that cannot be handled via classes
- **Consistent Structure**: Follow component patterns in `.ai/examples/`

### Component Structure Pattern

```tsx
// Imports grouped by type
import { useContext, useState } from "react";

// components (using aliased imports)
import { PageContainer } from "@/components";

// context
import { GlobalDispatchContext, GlobalStateContext } from "@/context/GlobalContext";
import { ErrorType } from "@/context/types";

// utils
import { backendAPI, setErrorMessage } from "@/utils";

interface ComponentProps {
  // Props definition
}

export const ComponentName = ({ prop1, prop2 }: ComponentProps) => {
  // Global context access
  const dispatch = useContext(GlobalDispatchContext);

  // Local state
  const [localState, setLocalState] = useState(initialValue);

  // Event handlers with proper error handling
  const handleEvent = async () => {
    try {
      // Implementation using SDK classes
    } catch (err) {
      setErrorMessage(dispatch, err as ErrorType);
    }
  };

  return (
    <div className="container">
      <h2 className="h2">Title</h2>
      <div className="card">{/* Content using SDK classes */}</div>
    </div>
  );
};

export default ComponentName;
```

## Testing Requirements (Jest)

- Add tests under `server/__tests__/` for each new/changed route
- Map `@rtsdk/topia` to `server/mocks/@rtsdk/topia.ts`
- Assert: HTTP status, JSON schema, correct SDK method & args, credentials flow

## Environment Setup

Provide `.env.example` with:

```
API_KEY=your_api_key_here
INTERACTIVE_KEY=your_interactive_key_here
INTERACTIVE_SECRET=your_interactive_secret_here
INSTANCE_DOMAIN=api.topia.io
INSTANCE_PROTOCOL=https
```

## Implementation Workflow

1. **PLAN FIRST** - Output concise plan before coding:

   - File tree delta
   - Endpoint signatures
   - Data shapes (TS interfaces)
   - Styling requirements

2. **IMPLEMENT** - Minimal changes satisfying constraints & tests

3. **TEST** - Add/adjust Jest tests with SDK mock coverage

4. **VALIDATE STYLING** - Verify components follow style guide

5. **FINALIZE** - After implementation is complete:

   - Remove unused boilerplate code (utils, components, types) and update barrel exports
   - Rewrite `README.md` to describe the new app (not the boilerplate)
   - Rewrite `server/tests/routes.test.ts` to test the new app's routes; update SDK mock
   - See `.ai/templates/plan.md` section 9 for detailed finalization checklist

6. **EXPLAIN** - Provide deliverable format output

## Deliverable Format

When implementing changes, return:

1. **Affected Files** (paths)
2. **Diffs or Full New Files**
3. **Short Rationale**
4. **Test Updates**
5. **Styling Validation Report** (for client components)
6. **Run Steps**

## When Blocked

If SDK calls or inputs are unclear:

- STOP, propose minimal stub
- List assumptions
- Ask 1 concise question
- If no answer, proceed with safest assumption and mark TODOs

## Key References

- **SDK Documentation**: https://metaversecloud-com.github.io/mc-sdk-js/index.html
- **Style Guide**: `.ai/style-guide.md`
- **Examples**: `.ai/examples/` directory
- **Planning Template**: `.ai/templates/plan.md`
- **Base Rules**: `.ai/rules.md`

### Common Patterns

- **Inventory Cache**: See `.ai/examples/inventoryCache.md` for caching ecosystem inventory items (badges, decorations, etc.)
- **Data Objects**: See `.ai/examples/handleGetConfiguration.md` for data object initialization patterns
- **Dropped Assets**: See `.ai/examples/handleDropAssets.md`, `.ai/examples/handleUpdateDroppedAsset.md`, and `.ai/examples/handleRemoveDroppedAsset.md` for asset management

Always reference the comprehensive documentation in the `.ai/` folder for detailed examples and patterns before starting implementation.
