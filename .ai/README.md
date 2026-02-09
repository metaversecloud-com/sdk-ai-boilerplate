# SDK Apps AI Documentation

This folder contains guidelines and examples for AI assistants working with Topia SDK applications.

## Quick Start by Use Case

| I want to... | Start here |
|--------------|------------|
| **Set up a new app** | `guides/getting-started.md` |
| **Build a multiplayer game** | `examples/multiplayerTurnBased.md`, `examples/lockingPatterns.md` |
| **Add badges/rewards** | `examples/badges.md`, `examples/awardBadge.md` |
| **Manage assets** | `examples/handleDropAssets.md`, `examples/handleRemoveDroppedAsset.md` |
| **Add visitor interactions** | `examples/visitorInteractions.md` |
| **Add visual effects** | `examples/worldActivity.md` |
| **Track analytics** | `examples/analyticsTracking.md` |
| **Migrate existing data** | `examples/dataMigration.md` |
| **Style components** | `style-guide.md` |

## Guides

| File | Purpose |
|------|---------|
| `guides/getting-started.md` | Complete setup, development, and deployment walkthrough |

## Core Files

| File | Purpose |
|------|---------|
| `rules.md` | Base rules for SDK development (detailed version) |
| `style-guide.md` | CSS classes and component styling patterns |

## Templates

| File | Purpose |
|------|---------|
| `templates/prompts.md` | Ideal prompts to give Claude for implementing SDK features |
| `templates/component.tsx` | React component template |
| `templates/plan.md` | Implementation plan template |

## Examples

### Visitor Interactions
| File | SDK Feature |
|------|-------------|
| `examples/visitorInteractions.md` | Toast notifications, move/teleport visitors, manage iframes |

### Concurrency & Multiplayer
| File | SDK Feature |
|------|-------------|
| `examples/lockingPatterns.md` | Prevent race conditions with time-based locking |
| `examples/multiplayerTurnBased.md` | Turn-based games: player selection, turns, win detection |

### Badges & Inventory
| File | SDK Feature |
|------|-------------|
| `examples/awardBadge.md` | Grant inventory items (badges) with toast notifications |
| `examples/badges.md` | Complete badges system: ecosystem cache, visitor inventory, UI display |
| `examples/inventoryCache.md` | Cache ecosystem inventory items with 24h TTL |

### Asset Management
| File | SDK Feature |
|------|-------------|
| `examples/getAnchorAssets.md` | Fetch dropped assets by scene and unique name |
| `examples/handleDropAssets.md` | Create and drop assets into a world |
| `examples/handleRemoveDroppedAsset.md` | Delete asset with effects and notifications |
| `examples/handleRemoveDroppedAssets.md` | Bulk delete assets |
| `examples/handleUpdateDroppedAsset.md` | Update asset properties |

### Game State & Configuration
| File | SDK Feature |
|------|-------------|
| `examples/handleGetConfiguration.md` | Retrieve world/visitor configuration |
| `examples/handleResetGameState.md` | Reset game state (admin only) |
| `examples/leaderboard.md` | Store, parse, sort, and display visitor leaderboards |

### Analytics & Effects
| File | SDK Feature |
|------|-------------|
| `examples/analyticsTracking.md` | Track user engagement, completions, and custom events |
| `examples/worldActivity.md` | Particle effects and activity indicators |

### Data Management
| File | SDK Feature |
|------|-------------|
| `examples/dataMigration.md` | Schema evolution, key renames, format conversions |

## Getting Started

1. Read `guides/getting-started.md` for setup instructions
2. Read `../CLAUDE.md` for development rules
3. Reference `style-guide.md` for UI components
4. Check `examples/` for SDK patterns
5. Use `templates/prompts.md` for AI-assisted development
