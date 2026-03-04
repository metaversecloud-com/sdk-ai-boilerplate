# Multiplayer Turn-Based Games

Patterns for building turn-based multiplayer games like Tic-Tac-Toe, Chess, Connect 4, and similar games. Covers player management, turn tracking, move validation, and win detection.

## Table of Contents

- [Game State Data Structure](#game-state-data-structure)
- [Player Selection/Joining](#player-selectionjoining)
- [Turn Tracking](#turn-tracking)
- [Move Validation](#move-validation)
- [Win Detection](#win-detection)
- [Game Reset](#game-reset)
- [Complete Example](#complete-example)

---

## Game State Data Structure

Store game state in a dropped asset's data object:

```ts
// server/types/GameData.ts
export type PlayerData = {
  visitorId: number | null;
  profileId: string | null;
  username: string | null;
};

export type GameDataType = {
  // Asset identification
  keyAssetId: string;

  // Player slots
  player1: PlayerData;
  player2: PlayerData;
  playerCount: number;

  // Turn management
  lastPlayerTurn: number | null; // visitorId of last player who moved
  turnCount: number;

  // Game state
  isGameOver: boolean;
  isResetInProgress: boolean;
  winner: number | null; // visitorId of winner

  // Game-specific state (examples)
  board?: any; // Board state
  claimedCells?: object; // Tic-tac-toe cells
  columns?: number[][]; // Connect 4 columns
  moveHistory?: string[]; // Chess moves

  // Timestamps
  lastInteraction: Date;
  resetCount: number;
};

// Default state for initialization
export const defaultGameData: GameDataType = {
  keyAssetId: "",
  player1: { visitorId: null, profileId: null, username: null },
  player2: { visitorId: null, profileId: null, username: null },
  playerCount: 0,
  lastPlayerTurn: null,
  turnCount: 0,
  isGameOver: false,
  isResetInProgress: false,
  winner: null,
  lastInteraction: new Date(),
  resetCount: 0,
};
```

### Initialize Game Data

```ts
// server/utils/droppedAssets/initializeDroppedAssetDataObject.ts
import { defaultGameData } from "../../types/GameData.js";

export const initializeDroppedAssetDataObject = async (droppedAsset: any) => {
  await droppedAsset.fetchDataObject();

  // Check if initialization is needed
  if (!droppedAsset.dataObject?.keyAssetId) {
    const lockId = `${droppedAsset.id}-${new Date(Math.round(new Date().getTime() / 60000) * 60000)}`;

    await droppedAsset.setDataObject(
      {
        ...defaultGameData,
        keyAssetId: droppedAsset.id,
      },
      { lock: { lockId, releaseLock: true } },
    );

    return true; // Was initialized
  }

  return false; // Already initialized
};
```

---

## Player Selection/Joining

Allow players to join the game by selecting a slot:

```ts
// server/controllers/handlePlayerSelection.ts
import { Request, Response } from "express";
import { World } from "../utils/topiaInit.js";
import { getCredentials, errorHandler } from "../utils/index.js";
import { getDroppedAssetDataObject } from "../utils/droppedAssets/index.js";

export const handlePlayerSelection = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { urlSlug, visitorId, profileId, username } = credentials;
    const { playerSlot } = req.params; // "1" or "2"

    const { keyAsset } = await getDroppedAssetDataObject(credentials);
    const { keyAssetId, playerCount, player1, player2 } = keyAsset.dataObject;

    let text = "";
    let shouldUpdateGame = true;

    // Validate player selection
    const isPlayer1 = playerSlot === "1";
    const targetSlot = isPlayer1 ? player1 : player2;
    const otherSlot = isPlayer1 ? player2 : player1;

    if (player1.visitorId === visitorId || player2.visitorId === visitorId) {
      // Already in the game
      text = `You are already Player ${player1.visitorId === visitorId ? "1" : "2"}`;
      shouldUpdateGame = false;
    } else if (targetSlot.visitorId) {
      // Slot taken
      text = `Player ${playerSlot} slot is already taken.`;
      shouldUpdateGame = false;
    } else if (otherSlot.visitorId) {
      // Second player joining - game can start!
      text = "Let the game begin!";
    } else {
      // First player joining
      text = "Waiting for another player to join...";
    }

    if (shouldUpdateGame) {
      const world = await World.create(urlSlug, { credentials });

      await Promise.all([
        // Update game state
        keyAsset.updateDataObject({
          lastInteraction: new Date(),
          playerCount: playerCount + 1,
          [`player${playerSlot}`]: { profileId, username, visitorId },
        }),

        // Trigger world activity based on game state
        world.triggerActivity({
          type: otherSlot.visitorId ? "GAME_ON" : "GAME_WAITING",
          assetId: keyAssetId,
        }),
      ]);
    }

    // Notify the player
    const visitor = await Visitor.get(visitorId, urlSlug, { credentials });
    visitor
      .fireToast({
        groupId: "game",
        title: shouldUpdateGame ? "Joined!" : "Notice",
        text,
      })
      .catch(() => {});

    return res.json({ success: true, message: text });
  } catch (error) {
    return errorHandler({
      error,
      functionName: "handlePlayerSelection",
      message: "Error selecting player",
      req,
      res,
    });
  }
};
```

---

## Turn Tracking

Track whose turn it is using `lastPlayerTurn`:

```ts
// Check if it's this player's turn
const isMyTurn = (gameData: GameDataType, visitorId: number): boolean => {
  const { player1, player2, lastPlayerTurn } = gameData;

  // First move - either player can go (or player1 by convention)
  if (lastPlayerTurn === null) {
    return player1.visitorId === visitorId; // Player 1 goes first
  }

  // After first move - must be the OTHER player's turn
  return lastPlayerTurn !== visitorId;
};

// Get the other player's info for notifications
const getOtherPlayer = (gameData: GameDataType, visitorId: number): PlayerData => {
  const { player1, player2 } = gameData;
  return player1.visitorId === visitorId ? player2 : player1;
};
```

### Turn Validation in Controllers

```ts
export const handleMakeMove = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { visitorId, profileId, urlSlug } = credentials;
    const { move } = req.body;

    const { keyAsset } = await getDroppedAssetDataObject(credentials);
    const { player1, player2, lastPlayerTurn, turnCount, isGameOver, isResetInProgress, keyAssetId, resetCount } =
      keyAsset.dataObject;

    let text = "";
    let shouldUpdateGame = false;

    // Validation checks (in order of priority)
    if (isResetInProgress) {
      text = "Game is resetting. Please wait.";
    } else if (isGameOver) {
      text = "Game over! Press Reset to play again.";
    } else if (!player1.visitorId || !player2.visitorId) {
      text = "Waiting for two players to join.";
    } else if (player1.visitorId !== visitorId && player2.visitorId !== visitorId) {
      text = "You are not a player in this game.";
    } else if (lastPlayerTurn === visitorId) {
      // It's the other player's turn
      const otherPlayer = getOtherPlayer(keyAsset.dataObject, visitorId);
      text = `It's ${otherPlayer.username}'s turn.`;
    } else {
      // Valid move - process it
      shouldUpdateGame = true;
    }

    if (!shouldUpdateGame) {
      return res.json({ success: false, message: text });
    }

    // Acquire lock for concurrent move protection
    const timestamp = new Date(Math.round(new Date().getTime() / 5000) * 5000);
    const lockId = `${keyAssetId}-${resetCount}-${turnCount}-${timestamp}`;

    try {
      // Process the move and update game state
      const updatedData = {
        lastPlayerTurn: visitorId,
        turnCount: turnCount + 1,
        lastInteraction: new Date(),
        // ... game-specific move data
      };

      await keyAsset.updateDataObject(updatedData, {
        lock: { lockId, releaseLock: true },
      });

      return res.json({ success: true });
    } catch (lockError) {
      return res.status(409).json({
        success: false,
        message: "Move already in progress. Please wait.",
      });
    }
  } catch (error) {
    return errorHandler({
      error,
      functionName: "handleMakeMove",
      message: "Error making move",
      req,
      res,
    });
  }
};
```

---

## Move Validation

Validate moves before applying them:

### Tic-Tac-Toe Style (Cell Claims)

```ts
// Check if a cell is available
const isCellAvailable = (claimedCells: object, cell: number): boolean => {
  return !claimedCells[cell];
};

// In controller:
if (!isCellAvailable(claimedCells, requestedCell)) {
  text = "That cell is already taken.";
  shouldUpdateGame = false;
}
```

### Connect 4 Style (Column Drops)

```ts
// Check if a column has space
const isColumnAvailable = (columns: number[][], column: number, maxHeight: number): boolean => {
  return columns[column].length < maxHeight;
};

// Get the row where a piece would land
const getDropRow = (columns: number[][], column: number): number => {
  return columns[column].length;
};
```

### Chess Style (External Validation)

```ts
import { Chess } from "chess.js";

// Validate move using chess.js
const validateChessMove = (fen: string, from: string, to: string): boolean => {
  const chess = new Chess(fen);
  const move = chess.move({ from, to });
  return move !== null;
};
```

---

## Win Detection

Check for win conditions after each move:

### Tic-Tac-Toe Win Detection

```ts
// server/utils/getGameStatus.ts
type GameStatus = {
  hasWinningCombo: boolean;
  winningCombo?: number[];
  isDraw: boolean;
};

export const getGameStatus = (claimedCells: { [key: number]: number }): GameStatus => {
  // All possible winning combinations
  const winningCombos = [
    [0, 1, 2], // Top row
    [3, 4, 5], // Middle row
    [6, 7, 8], // Bottom row
    [0, 3, 6], // Left column
    [1, 4, 7], // Middle column
    [2, 5, 8], // Right column
    [0, 4, 8], // Diagonal
    [2, 4, 6], // Anti-diagonal
  ];

  // Check each winning combination
  for (const combo of winningCombos) {
    const [a, b, c] = combo;
    if (claimedCells[a] && claimedCells[a] === claimedCells[b] && claimedCells[b] === claimedCells[c]) {
      return {
        hasWinningCombo: true,
        winningCombo: combo,
        isDraw: false,
      };
    }
  }

  // Check for draw (all cells filled)
  const filledCells = Object.keys(claimedCells).length;
  if (filledCells === 9) {
    return { hasWinningCombo: false, isDraw: true };
  }

  // Game continues
  return { hasWinningCombo: false, isDraw: false };
};
```

### Connect 4 Win Detection

```ts
// Check if player has 4 in a row
export const checkConnect4Win = (columns: number[][], playerId: number): boolean => {
  const ROWS = 6;
  const COLS = 7;

  // Convert columns to 2D board for easier checking
  const board: (number | null)[][] = Array(ROWS)
    .fill(null)
    .map(() => Array(COLS).fill(null));

  columns.forEach((col, colIdx) => {
    col.forEach((cell, rowIdx) => {
      board[rowIdx][colIdx] = cell;
    });
  });

  // Check horizontal, vertical, and diagonal
  const directions = [
    [0, 1], // Horizontal
    [1, 0], // Vertical
    [1, 1], // Diagonal down-right
    [1, -1], // Diagonal down-left
  ];

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (board[row][col] !== playerId) continue;

      for (const [dr, dc] of directions) {
        let count = 1;
        for (let i = 1; i < 4; i++) {
          const newRow = row + dr * i;
          const newCol = col + dc * i;
          if (newRow >= 0 && newRow < ROWS && newCol >= 0 && newCol < COLS && board[newRow][newCol] === playerId) {
            count++;
          } else {
            break;
          }
        }
        if (count >= 4) return true;
      }
    }
  }

  return false;
};
```

### Process Win in Controller

```ts
// After processing a valid move
const gameStatus = getGameStatus(updatedClaimedCells);

const analytics: AnalyticType[] = [];
let updatedData: Partial<GameDataType> = {
  lastPlayerTurn: visitorId,
  turnCount: turnCount + 1,
  claimedCells: updatedClaimedCells,
};

if (gameStatus.hasWinningCombo) {
  updatedData.isGameOver = true;
  updatedData.winner = visitorId;

  // Track analytics for winner and both players
  analytics.push(
    { analyticName: "wins", profileId, urlSlug, uniqueKey: profileId },
    { analyticName: "completions", profileId: player1.profileId, urlSlug, uniqueKey: player1.profileId },
    { analyticName: "completions", profileId: player2.profileId, urlSlug, uniqueKey: player2.profileId },
  );

  text = "You win!";
} else if (gameStatus.isDraw) {
  updatedData.isGameOver = true;

  analytics.push(
    { analyticName: "ties", profileId: player1.profileId, urlSlug, uniqueKey: player1.profileId },
    { analyticName: "ties", profileId: player2.profileId, urlSlug, uniqueKey: player2.profileId },
    { analyticName: "completions", profileId: player1.profileId, urlSlug, uniqueKey: player1.profileId },
    { analyticName: "completions", profileId: player2.profileId, urlSlug, uniqueKey: player2.profileId },
  );

  text = "It's a draw!";
}

await keyAsset.updateDataObject(updatedData, {
  lock: { lockId, releaseLock: true },
  analytics,
});
```

---

## Game Reset

Allow players to reset the game:

```ts
// server/controllers/handleResetGame.ts
export const handleResetGame = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { urlSlug, visitorId, profileId } = credentials;

    const { keyAsset } = await getDroppedAssetDataObject(credentials);
    const { player1, player2, resetCount, keyAssetId } = keyAsset.dataObject;

    // Only players or admins can reset
    const isPlayer = player1.visitorId === visitorId || player2.visitorId === visitorId;
    const visitor = await Visitor.get(visitorId, urlSlug, { credentials });

    if (!isPlayer && !visitor.isAdmin) {
      return res.json({ success: false, message: "Only players can reset the game." });
    }

    // Mark reset in progress
    await keyAsset.updateDataObject({ isResetInProgress: true });

    // Reset to default state while preserving some data
    const lockId = `reset-${keyAssetId}-${Date.now()}`;

    await keyAsset.setDataObject(
      {
        ...defaultGameData,
        keyAssetId,
        resetCount: resetCount + 1,
        lastInteraction: new Date(),
      },
      { lock: { lockId, releaseLock: true } },
    );

    // Notify via toast
    visitor
      .fireToast({
        groupId: "game",
        title: "Game Reset",
        text: "The game has been reset. Find a new opponent!",
      })
      .catch(() => {});

    return res.json({ success: true });
  } catch (error) {
    return errorHandler({
      error,
      functionName: "handleResetGame",
      message: "Error resetting game",
      req,
      res,
    });
  }
};
```

---

## Complete Example

Here's a complete controller for a Tic-Tac-Toe style move:

```ts
// server/controllers/handleClaimCell.ts
import { Request, Response } from "express";
import { Visitor } from "../utils/topiaInit.js";
import { getCredentials, errorHandler } from "../utils/index.js";
import { getDroppedAssetDataObject } from "../utils/droppedAssets/index.js";
import { getGameStatus } from "../utils/getGameStatus.js";
import { AnalyticType } from "../types/index.js";

export const handleClaimCell = async (req: Request, res: Response) => {
  try {
    const credentials = getCredentials(req.query);
    const { visitorId, profileId, urlSlug } = credentials;
    const { cell } = req.body;

    // Get current game state
    const { keyAsset } = await getDroppedAssetDataObject(credentials);
    const {
      claimedCells,
      player1,
      player2,
      lastPlayerTurn,
      turnCount,
      isGameOver,
      isResetInProgress,
      keyAssetId,
      resetCount,
    } = keyAsset.dataObject;

    let text = "";
    let shouldUpdateGame = false;

    // --- VALIDATION ---
    if (isResetInProgress) {
      text = "Game is resetting. Please wait.";
    } else if (isGameOver) {
      text = "Game over! Press Reset to play again.";
    } else if (!player1.visitorId || !player2.visitorId) {
      text = "Two players are needed to start.";
    } else if (player1.visitorId !== visitorId && player2.visitorId !== visitorId) {
      text = "You're not a player in this game.";
    } else if (claimedCells[cell]) {
      text = "That cell is already taken.";
    } else if (lastPlayerTurn === visitorId) {
      const otherPlayer = player1.visitorId === visitorId ? player2 : player1;
      text = `It's ${otherPlayer.username}'s turn.`;
    } else {
      shouldUpdateGame = true;
    }

    // --- EARLY RETURN IF INVALID ---
    if (!shouldUpdateGame) {
      const visitor = await Visitor.get(visitorId, urlSlug, { credentials });
      visitor.fireToast({ groupId: "game", title: "Invalid Move", text }).catch(() => {});
      return res.json({ success: false, message: text });
    }

    // --- ACQUIRE LOCK ---
    const timestamp = new Date(Math.round(new Date().getTime() / 5000) * 5000);
    const lockId = `${keyAssetId}-${resetCount}-${turnCount}-${timestamp}`;

    try {
      // Apply move
      const updatedClaimedCells = { ...claimedCells, [cell]: visitorId };

      // Check for win/draw
      const gameStatus = getGameStatus(updatedClaimedCells);

      // Build update data
      const analytics: AnalyticType[] = [];
      const updatedData: any = {
        lastPlayerTurn: visitorId,
        turnCount: turnCount + 1,
        lastInteraction: new Date(),
        claimedCells: updatedClaimedCells,
      };

      if (gameStatus.hasWinningCombo) {
        updatedData.isGameOver = true;
        updatedData.winner = visitorId;
        text = "You win!";

        analytics.push(
          { analyticName: "wins", profileId, urlSlug, uniqueKey: profileId },
          { analyticName: "completions", profileId: player1.profileId, urlSlug, uniqueKey: player1.profileId },
          { analyticName: "completions", profileId: player2.profileId, urlSlug, uniqueKey: player2.profileId },
        );
      } else if (gameStatus.isDraw) {
        updatedData.isGameOver = true;
        text = "It's a draw!";

        analytics.push(
          { analyticName: "ties", profileId: player1.profileId, urlSlug, uniqueKey: player1.profileId },
          { analyticName: "ties", profileId: player2.profileId, urlSlug, uniqueKey: player2.profileId },
        );
      } else {
        const otherPlayer = player1.visitorId === visitorId ? player2 : player1;
        text = `${otherPlayer.username}'s turn`;
      }

      // --- UPDATE GAME STATE ---
      await keyAsset.updateDataObject(updatedData, {
        lock: { lockId, releaseLock: true },
        analytics: analytics.length > 0 ? analytics : undefined,
      });

      // Notify player
      const visitor = await Visitor.get(visitorId, urlSlug, { credentials });
      visitor.fireToast({ groupId: "game", title: "Move Made", text }).catch(() => {});

      return res.json({
        success: true,
        data: {
          gameStatus,
          claimedCells: updatedClaimedCells,
        },
      });
    } catch (lockError) {
      return res.status(409).json({
        success: false,
        message: "Another move is in progress. Please try again.",
      });
    }
  } catch (error) {
    return errorHandler({
      error,
      functionName: "handleClaimCell",
      message: "Error claiming cell",
      req,
      res,
    });
  }
};
```

---

## API Routes for Multiplayer Games

```ts
// server/routes.ts
import { handlePlayerSelection } from "./controllers/handlePlayerSelection.js";
import { handleClaimCell } from "./controllers/handleClaimCell.js";
import { handleResetGame } from "./controllers/handleResetGame.js";
import { handleGetGameState } from "./controllers/handleGetGameState.js";

router.get("/game-state", handleGetGameState);
router.post("/player/:playerSlot", handlePlayerSelection);
router.post("/move", handleClaimCell);
router.post("/reset", handleResetGame);
```

---

## Key Patterns Summary

| Pattern               | Purpose                           |
| --------------------- | --------------------------------- |
| `lastPlayerTurn`      | Track whose turn it is            |
| `turnCount`           | Create unique lock IDs per turn   |
| `resetCount`          | Invalidate old locks after reset  |
| `playerCount`         | Track if game is ready (needs 2)  |
| `isGameOver`          | Prevent moves after game ends     |
| `isResetInProgress`   | Prevent moves during reset        |
| Time-based locks      | Prevent concurrent move conflicts |
| Analytics on win/draw | Track game completions            |
