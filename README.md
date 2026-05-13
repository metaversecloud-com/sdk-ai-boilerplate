# SDK App README Template

> This README is a template. When you fork the boilerplate into a new app, **replace this file** with one that describes your app — keep the same section structure so world builders and other developers can find what they need in a predictable place.

## Introduction / Summary

One- or two-sentence description of what this app does and who it's for.

This template is meant to give you a simple starting point to build new features in Topia using our JavaScript SDK. Please reference the [SDK documentation](https://metaversecloud-com.github.io/mc-sdk-js/index.html) for a more detailed breakdown of what the SDK is capable of and how to use it.

## Key Features

### Canvas elements & interactions

- **Key Asset:** When clicked, this asset opens the drawer and allows visitors and admins to start interacting with the app.

### Drawer content

- How to play instructions
- Leaderboard
- Admin features (see below)

### Admin features

_Does your app have special admin functionality? If so your key features may look something like this:_

- **Access:** Click on the key asset to open the drawer and then select the Admin tab. Any changes made here only affect this instance of the application and do not impact other instances dropped in this or other worlds.
- **Theme selection:** Use the dropdown to select a theme.
- **Reset:** Click the Reset button to clear the active game state and rebuild the game board in its default state.

### Themes description

- **Winter (default):** A snowy theme that drops snowflakes throughout the scene.
- **Spring:** A garden theme that drops flowers throughout the scene.

## Required Assets with Unique Names

_If your app uses dropped assets on the canvas that are found by unique name, document them here. This helps world builders set up the correct assets for the app to function._

| Unique Name Pattern | Description                                             |
| ------------------- | ------------------------------------------------------- |
| `AppName_keyAsset`  | Key asset that opens the app drawer                     |
| `AppName_item_{id}` | Dynamically created assets (created/deleted by the app) |

> **Note:** Assets with fixed unique names (e.g., `AppName_keyAsset`) must be placed in the world manually by an admin. Assets with dynamic patterns (e.g., `AppName_item_{timestamp}`) are created and managed by the app at runtime.

## Technical Architecture

### Data Objects

_Data objects store information about each implementation of the app per world._

#### Visitor / User

The data object attached to the visitor stores information related specifically to the visitor (e.g., progress). For tracking across multiple world instances, use `${urlSlug}_${sceneDropId}` as a unique key. Example data:

```ts
{
  [`${urlSlug}_${sceneDropId}`]: {
    currentStreak: number,
    lastCollectedDate: string,
    longestStreak: number,
    totalCollected: number,
  }
}
```

#### Key Asset

The data object attached to the dropped key asset stores information related to this specific instance of the app and is deleted if the key asset is removed from the world. Example data:

```ts
{
  isResetInProgress: boolean;
  lastInteractionDate: string;
  lastPlayerTurn: string;
  playerCount: number;
  resetCount: number;
  turnCount: number;
}
```

#### World

The data object attached to the world stores information for every instance of the app in a given world, keyed by `keyAssetId` or `sceneDropId`. It persists even if a specific instance is removed. Keep World data minimal to avoid hitting size limits. Example data:

```ts
{
  [sceneDropId]: {
    keyAssetId: string;
    themeId: string;
  }
}
```

## API Endpoints

_Document every server route the client (or external systems) can call. Group by feature so it's easy to scan._

| Method | Route                | Description                                                            |
| ------ | -------------------- | ---------------------------------------------------------------------- |
| `GET`  | `/visitor`           | Initialize / fetch visitor data (calls `getVisitor` utility)           |
| `GET`  | `/game-state`        | Return the current per-asset game state from the key asset data object |
| `POST` | `/game-state`        | Update game state (admin or gameplay actions)                          |
| `GET`  | `/leaderboard`       | Return the world-scoped leaderboard for this app                       |
| `POST` | `/leaderboard`       | Submit a score to the leaderboard                                      |
| `GET`  | `/admin/settings`    | Return admin-configurable settings for this asset                      |
| `POST` | `/admin/settings`    | Update admin settings (admin-only)                                     |
| `POST` | `/admin/reset`       | Reset the game state for this asset (admin-only)                       |
| `GET`  | `/sse/:assetId`      | Open an SSE stream for real-time updates (if the app uses SSE)         |
| `POST` | `/webhook`           | Receive webhook callbacks from the Topia platform                      |

> Real-time updates pattern: see `.ai/rules.md` → **REAL-TIME UPDATES (SSE)** and the canonical reference implementation in `topia-sdk-apps/sdk-ring-toss/server/utils/sseManager.ts`.

## Environment Variables

Create a `.env` file in the root directory. See `.env-example` for a template.

| Variable               | Description                                                                        | Required |
| ---------------------- | ---------------------------------------------------------------------------------- | -------- |
| `INTERACTIVE_KEY`      | Topia interactive app key                                                          | Yes      |
| `INTERACTIVE_SECRET`   | Topia interactive app secret                                                       | Yes      |
| `INSTANCE_DOMAIN`      | Topia API domain (`api.topia.io` for production, `api-stage.topia.io` for staging) | Yes      |
| `INSTANCE_PROTOCOL`    | `https` for production/staging, `http` only for local                              | Yes      |
| `NODE_ENV`             | Node environment                                                                   | No       |
| `PORT`                 | Server port (defaults to `3001`)                                                   | No       |
| `LEADERBOARD_BASE_URL` | Base URL for the leaderboard service (if applicable)                               | No       |
| `SKIP_PREFLIGHT_CHECK` | Skip CRA preflight check                                                           | No       |

### Where to find `INTERACTIVE_KEY` and `INTERACTIVE_SECRET`

- [Topia Dev Account Dashboard](https://dev.topia.io/t/dashboard/integrations)
- [Topia Production Account Dashboard](https://topia.io/t/dashboard/integrations)

## Getting Started

```bash
# from the app root
npm install
cd client && npm install && cd ..

# create a .env at the app root (see Environment Variables above)
cp .env-example .env

# run the dev server (serves the client and the Express server together)
npm run dev
```

## For Developers

### Built With

#### Client

![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)
![Vite](https://img.shields.io/badge/vite-%23646CFF.svg?style=for-the-badge&logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white)

#### Server

![Node.js](https://img.shields.io/badge/node.js-%2343853D.svg?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/express-%23000000.svg?style=for-the-badge&logo=express&logoColor=white)

### Styling

This project uses the Topia SDK's CSS classes for consistent styling, layered with Tailwind via CSS cascade layers (`@layer tailwind, sdk;` — SDK wins over Tailwind, unlayered project CSS wins over both). Tailwind preflight is disabled to avoid clobbering SDK defaults.

- Read [`.ai/style-guide.md`](.ai/style-guide.md) for the full SDK class catalog, the cascade-layer setup (`client/src/index.css`, `client/index.html`, `client/tailwind.config.js`), custom CSS conventions, and the component structure pattern.
- The canonical reference implementation lives in [`topia-sdk-apps/sdk-escape-room/client/src/index.css`](../sdk-escape-room/client/src/index.css).

### Accessibility

Every UI change must meet **WCAG 2.1 AA**.

- Read [`.ai/accessibility.md`](.ai/accessibility.md) for the required patterns: semantic elements, icon-button labeling, form labels, the modal dialog contract, focus management, contrast, motion, and the testing flow.

### SDK fundamentals

If anything about how the SDK *works* is unclear (Interactive Keys, JWT signing, iframes vs webhooks, session credentials, dropped-asset operations, backend validation), read [`.ai/sdk-fundamentals.md`](.ai/sdk-fundamentals.md).

### Helpful links

- [SDK Developer docs](https://metaversecloud-com.github.io/mc-sdk-js/index.html)
- [View this app in production](https://topia.io/appname-prod) *(replace with your app's URL)*
- On-canvas turn-based game reference — TicTacToe: [GitHub](https://github.com/metaversecloud-com/sdk-tictactoe) · [demo](https://topia.io/tictactoe-prod)
