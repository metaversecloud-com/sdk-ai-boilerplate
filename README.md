# README Template

Please update the following in each of your SDK application.

## Introduction / Summary

This template is meant to give you a simple starting point to build new features in Topia using our Javascript SDK. Please reference the [documentation](https://metaversecloud-com.github.io/mc-sdk-js/index.html) for a more detailed breakdown of what the SDK is capable of and how to use it!

## Key Features

### Canvas elements & interactions

- Key Asset: When clicked this asset will open the drawer and allow users and admins to start interacting with the app.

### Drawer content

- How to play instructions
- Leaderboard
- Admin features (see below)

### Admin features

_Does your app have special admin functionality? If so your key features may looks something like this:_

- Access: Click on the key asset to open the drawer and then select the Admin tab. Any changes you make here will only affect this instance of the application and will not impact other instances dropped in this or other worlds.
- Theme selection: Use the dropdown to select a theme.
- Reset: Click on the Reset button to clear the active game state and rebuild the game board in it's default state.

### Themes description

- Winter (default): A snowy theme that when selected will drop snowflakes throughout the scene
- Spring: A garden theme that when selected will drop flowers throughout the scene

### Data objects

#### Visitor / User

The data object attached to the visitor should store information related specifically to the visitor i.e. progress. For tracking across multiple world/instances use `${urlSlug}_${sceneDropId}` as a unique key. Example data:

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

The data object attached to the dropped key asset will should information related to this specific implementation of the app and would be deleted if the key asset is removed from world. Example data:

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

The data object attached to the world will store information for every instance of the app in a given world by keyAssetId or sceneDropId and will persist even if a specific instance is removed from world. Data stored in the World data object should be minimal to avoid running into limits. Example data:

```ts
{
  [sceneDropId]: {
    keyAssetId: string;
    themeId: string;
  }
}
```

## Environment Variables

Create a `.env` file in the root directory. See `.env-example` for a template.

| Variable               | Description                                                                        | Required |
| ---------------------- | ---------------------------------------------------------------------------------- | -------- |
| `NODE_ENV`             | Node environment                                                                   | No       |
| `SKIP_PREFLIGHT_CHECK` | Skip CRA preflight check                                                           | No       |
| `LEADERBOARD_BASE_URL` | Base URL for the leaderboard service                                               | No       |
| `INSTANCE_DOMAIN`      | Topia API domain (`api.topia.io` for production, `api-stage.topia.io` for staging) | Yes      |
| `INTERACTIVE_KEY`      | Topia interactive app key                                                          | Yes      |
| `INTERACTIVE_SECRET`   | Topia interactive app secret                                                       | Yes      |

## Developers:

### Built With

#### Client

![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB)
![Vite](https://img.shields.io/badge/vite-%23646CFF.svg?style=for-the-badge&logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white)

#### Server

![Node.js](https://img.shields.io/badge/node.js-%2343853D.svg?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/express-%23000000.svg?style=for-the-badge&logo=express&logoColor=white)

### Styling Requirements

This project uses the Topia SDK's CSS classes for consistent styling. Please follow these requirements:

1. **Use SDK CSS classes** from https://sdk-style.s3.amazonaws.com/styles-3.0.2.css for all UI components.
2. **Do not use Tailwind utilities** when an SDK class exists for that purpose.
3. **Follow the examples** in `.ai/examples/styles.md` and `.ai/examples/page.md`.
4. **Use the correct component structure** with proper aliased imports.

See the comprehensive style guide in `.ai/style-guide.md` for complete requirements and examples.

### Getting Started

- Clone this repository
- Run `npm i` in server
- `cd client`
- Run `npm i` in client
- `cd ..` back to server

### Add your .env environmental variables

```json
INSTANCE_DOMAIN=api.topia.io
INSTANCE_PROTOCOL=https
INTERACTIVE_KEY=xxxxxxxxxxxxx
INTERACTIVE_SECRET=xxxxxxxxxxxxxx
```

### Where to find INTERACTIVE_KEY and INTERACTIVE_SECRET

[Topia Dev Account Dashboard](https://dev.topia.io/t/dashboard/integrations)

[Topia Production Account Dashboard](https://topia.io/t/dashboard/integrations)

### Helpful links

- [SDK Developer docs](https://metaversecloud-com.github.io/mc-sdk-js/index.html)
- [View it in action!](topia.io/appname-prod)
- To see an example of an on canvas turn based game check out TicTacToe:
  - (github))[https://github.com/metaversecloud-com/sdk-tictactoe]
  - (demo))[https://topia.io/tictactoe-prod]

## New for June 2025: Multiplayer Experience Engine

Topia has developed a powerful new Experience Engine that enables extremely low-latency, interactive in-canvas multiplayer experiences. This engine is purpose-built for real-time interaction and supports a wide range of dynamic behaviors, making it ideal for collaborative activities, games, and social experiences within Topia worlds.

### Key Features

- Ultra Low Latency: Real-time feedback for seamless multi-user interaction and state synchronization.
- Physics & Collision: Includes a robust physics and collision system to support realistic and responsive behaviors.
- Real-Time Interactivity: Supports dynamic responses to user input and environmental changes inside the canvas.
- Optimized for the Web: Engineered to perform smoothly across browser-based environments with minimal resource impact.

### SDK Integration: Leverage the SDK inside the Experience Engine to:

- Trigger visual/audio effects based on real-time interactions
- Save and persist spatial data, such as object positions or interaction states

This engine unlocks a whole new layer of interactivity, paving the way for creative, immersive experiences including educational tools, multiplayer games, or collaborative activities.

### Get In Touch

To sign up for the experience engine private beta, visit https://topia.io/p/game-engine.
