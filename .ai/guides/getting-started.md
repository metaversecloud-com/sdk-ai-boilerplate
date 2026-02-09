# Getting Started with Topia SDK Apps

This guide walks you through setting up, developing, and deploying a Topia SDK application using the sdk-ai-boilerplate.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Environment Setup](#environment-setup)
- [Local Development](#local-development)
- [Understanding the Architecture](#understanding-the-architecture)
- [Making Your First Change](#making-your-first-change)
- [Testing](#testing)
- [Deployment](#deployment)

---

## Prerequisites

Before starting, ensure you have:

- **Node.js** (v18 or higher recommended)
- **npm** (v9 or higher)
- **A Topia account** with access to create Interactive Apps
- **Interactive credentials** from the Topia Gateway (INTERACTIVE_KEY and INTERACTIVE_SECRET)

---

## Project Structure

The sdk-ai-boilerplate uses a **monorepo structure** with separate client and server workspaces:

```
sdk-ai-boilerplate/
├── .ai/                    # AI assistant documentation (you are here)
│   ├── examples/           # SDK code examples
│   ├── templates/          # Reusable templates
│   ├── guides/             # Step-by-step guides
│   ├── rules.md            # Development rules
│   └── style-guide.md      # CSS/styling patterns
├── client/                 # React frontend (Vite)
│   ├── src/
│   │   ├── App.tsx         # Main app component (PROTECTED)
│   │   ├── components/     # Reusable components
│   │   ├── pages/          # Route pages
│   │   ├── context/        # Global state management
│   │   └── utils/
│   │       ├── backendAPI.ts   # API client (PROTECTED)
│   │       └── topiaInit.ts    # Client-side SDK init
│   └── package.json
├── server/                 # Express backend
│   ├── controllers/        # Route handlers
│   ├── utils/
│   │   ├── topiaInit.ts    # SDK initialization (CRITICAL)
│   │   ├── getCredentials.ts   # Credential extraction (PROTECTED)
│   │   └── errorHandler.ts     # Error handling (PROTECTED)
│   ├── routes.ts           # API route definitions
│   ├── index.ts            # Express server entry
│   └── package.json
├── package.json            # Root package with workspace config
└── .env.example            # Environment variable template
```

### Protected Files

These files should **not be modified** as they contain critical framework code:

| File | Purpose |
|------|---------|
| `client/src/App.tsx` | Main routing and layout |
| `client/src/components/PageContainer.tsx` | Page wrapper component |
| `client/src/utils/backendAPI.ts` | Axios client with credential injection |
| `client/src/utils/setErrorMessage.ts` | Error state management |
| `server/utils/getCredentials.ts` | Credential extraction from requests |
| `server/utils/errorHandler.ts` | Standardized error responses |

---

## Environment Setup

### 1. Copy the Environment Template

```bash
cp .env.example .env
```

### 2. Configure Required Variables

Edit `.env` with your credentials:

```bash
# Required - Get these from Topia Gateway
INTERACTIVE_KEY=your_interactive_public_key
INTERACTIVE_SECRET=your_interactive_secret_key

# Required - Topia API configuration
INSTANCE_DOMAIN=api.topia.io
INSTANCE_PROTOCOL=https

# Optional - For admin operations
API_KEY=your_api_key

# Optional - For analytics logging to Google Sheets
GOOGLESHEETS_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLESHEETS_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
GOOGLESHEETS_SHEET_ID=your_sheet_id
```

### Environment Variables Explained

| Variable | Required | Description |
|----------|----------|-------------|
| `INTERACTIVE_KEY` | Yes | Public key from Topia Gateway |
| `INTERACTIVE_SECRET` | Yes | Secret key for JWT signing |
| `INSTANCE_DOMAIN` | Yes | Topia API domain (usually `api.topia.io`) |
| `INSTANCE_PROTOCOL` | Yes | Protocol (`https`) |
| `API_KEY` | No | Admin API key for elevated permissions |
| `GOOGLESHEETS_*` | No | Google Sheets integration for analytics |

### Getting Your Interactive Credentials

1. Log in to Topia and go to the Gateway
2. Create a new Interactive App or select an existing one
3. Copy the **Interactive Key** (public) and **Interactive Secret** (private)
4. Add these to your `.env` file

---

## Local Development

### 1. Install Dependencies

```bash
npm install
```

This installs dependencies for both client and server workspaces.

### 2. Start Development Servers

```bash
npm run dev
```

This runs both:
- **Server**: `http://localhost:3000` (Express API)
- **Client**: `http://localhost:5173` (Vite dev server)

### Individual Commands

```bash
npm run dev-server    # Server only
npm run dev-client    # Client only
npm run build         # Production build
npm run start         # Start production server
```

### Testing in Topia

1. In your Topia world, add an Interactive Asset
2. Configure it to point to your local dev URL (use ngrok or similar for remote testing)
3. Click the asset to open your app in an iframe

---

## Understanding the Architecture

### Server-First SDK Pattern

**Critical Rule**: All SDK calls happen on the server, never from React.

```
┌─────────────────────────────────────────────────────────────┐
│                        Topia World                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Interactive Asset (iframe)              │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │           React Client (Vite)               │    │   │
│  │  │                                             │    │   │
│  │  │  1. User clicks button                      │    │   │
│  │  │  2. backendAPI.post('/action', data)        │    │   │
│  │  │          │                                  │    │   │
│  │  └──────────┼──────────────────────────────────┘    │   │
│  └─────────────┼────────────────────────────────────────┘   │
└────────────────┼────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                    Express Server                           │
│                                                             │
│  3. Route handler receives request                          │
│  4. getCredentials(req.query) extracts session info         │
│  5. SDK call: DroppedAsset.get(assetId, urlSlug, {creds})  │
│  6. Return JSON response                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                      Topia API                              │
│                                                             │
│  7. SDK signs request with JWT (using INTERACTIVE_SECRET)   │
│  8. Topia API validates and executes                        │
│  9. Returns result to server                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Credential Flow

When a user opens your app in Topia, credentials are passed via URL query parameters:

```
?visitorId=123&urlSlug=my-world&assetId=abc&interactiveNonce=xyz&profileId=456
```

The client's `backendAPI.ts` automatically includes these in every request. The server's `getCredentials()` extracts them and passes them to SDK methods.

### Data Persistence

Use **Data Objects** on SDK entities for persistence:

```ts
// Dropped Asset - shared state (game board, leaderboard)
await droppedAsset.setDataObject({ score: 0 });
await droppedAsset.updateDataObject({ score: 100 });

// Visitor - per-user state (progress, inventory)
await visitor.setDataObject({ level: 1 });
await visitor.updateDataObject({ level: 2 });

// World - world-wide state (configuration)
await world.setDataObject({ theme: "dark" });
```

---

## Making Your First Change

Let's add a simple feature: a button that displays a toast notification.

### 1. Create the Server Controller

Create `server/controllers/handleShowToast.ts`:

```ts
import { Request, Response } from "express";
import { Visitor } from "../utils/topiaInit.js";
import { getCredentials, errorHandler } from "../utils/index.js";

export const handleShowToast = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { urlSlug, visitorId } = credentials;
    const { message } = req.body;

    // Get the visitor using the SDK
    const visitor = await Visitor.get(visitorId, urlSlug, { credentials });

    // Display a toast notification
    await visitor.fireToast({
      groupId: "myApp",
      title: "Hello!",
      text: message || "This is a toast notification",
    });

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({
      error,
      functionName: "handleShowToast",
      message: "Error showing toast",
      req,
      res,
    });
  }
};
```

### 2. Add the Route

In `server/routes.ts`, add:

```ts
import { handleShowToast } from "./controllers/handleShowToast.js";

// Add to your routes
router.post("/show-toast", handleShowToast);
```

### 3. Create the Client Component

In `client/src/components/ToastButton.tsx`:

```tsx
import { useState } from "react";
import { backendAPI } from "../utils/backendAPI";
import { setErrorMessage } from "../utils/setErrorMessage";

export const ToastButton = () => {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      await backendAPI.post("/show-toast", {
        message: "Button clicked!",
      });
    } catch (error) {
      setErrorMessage(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button className="btn" onClick={handleClick} disabled={loading}>
      {loading ? "Sending..." : "Show Toast"}
    </button>
  );
};
```

### 4. Use the Component

Add `<ToastButton />` to one of your pages.

---

## Testing

### Running Tests

```bash
cd server
npm test
```

### Writing Tests

Create tests in `server/__tests__/`:

```ts
import { handleShowToast } from "../controllers/handleShowToast";

// Mock the SDK
jest.mock("../utils/topiaInit", () => ({
  Visitor: {
    get: jest.fn().mockResolvedValue({
      fireToast: jest.fn().mockResolvedValue({}),
    }),
  },
}));

describe("handleShowToast", () => {
  it("should call fireToast with correct parameters", async () => {
    // Test implementation
  });
});
```

---

## Deployment

### Building for Production

```bash
npm run build
```

This creates production builds in both `client/dist` and `server/build`.

### Deploying to Topia Gateway

1. **Build your app** with `npm run build`
2. **Deploy your server** to a hosting provider (Vercel, Railway, AWS, etc.)
3. **Configure your Interactive App** in Topia Gateway with your deployed URL
4. **Set environment variables** on your hosting provider

### Hosting Recommendations

| Provider | Best For |
|----------|----------|
| Vercel | Simple deployments, automatic HTTPS |
| Railway | Full-stack apps with databases |
| AWS/GCP | Production scale, custom infrastructure |
| Heroku | Quick prototypes |

---

## Next Steps

1. **Read the rules**: Review `.ai/rules.md` for development guidelines
2. **Check the style guide**: Follow `.ai/style-guide.md` for UI components
3. **Browse examples**: See `.ai/examples/` for common SDK patterns
4. **Use prompts**: Copy prompts from `.ai/templates/prompts.md` for AI assistance

### Common Features to Add

- **Badges/Rewards**: See `examples/badges.md` and `examples/awardBadge.md`
- **Leaderboards**: See `examples/leaderboard.md`
- **Asset Management**: See `examples/handleDropAssets.md`
- **Visitor Interactions**: See `examples/visitorInteractions.md`
- **Multiplayer Locking**: See `examples/lockingPatterns.md`

---

## Troubleshooting

### "Credentials missing" Error

Ensure your app is opened from within a Topia world. The credentials come from the iframe URL parameters.

### SDK Methods Not Working

1. Check that `INTERACTIVE_KEY` and `INTERACTIVE_SECRET` are set correctly
2. Verify the credentials are being passed to SDK methods
3. Check the server console for detailed error messages

### CORS Errors

The client dev server proxies API requests. In production, ensure your server allows requests from your client domain.

### Toast/Effects Not Appearing

These operations are fire-and-forget. Check the server logs for errors in the `.catch()` handlers.
