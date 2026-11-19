import type { TopiaWorld } from "../fixtures";

/**
 * Leaderboards stored as "name|score|..." strings and read back with split("|") let a player set any
 * score: the display name "Mallory|999999" is read as name "Mallory", score 999999. Found in sdk-quest,
 * sdk-race, sdk-tictactoe, sdk-escape-room, sdk-kitchen-rush and sdk-trivia. Fix: store rows as objects
 * ({ displayName, score, ... }), or strip "|" from the name before building the string.
 *
 * Gives the test's visitor (seed the world first) a display name followed by the forged fields, both in
 * the mock (apps that read it from Visitor.get) and in the returned credential overrides (apps that read
 * the query or body displayName). Call the app's score route with the overrides, then assert the row
 * for world.profileId keeps the real score:
 *
 *   const forged = await forgeDisplayName(world, [999999]);
 *   await request.post(world.api("/game-end", forged), { data: { score: 15 } });
 *   expect(board.find((row) => row.profileId === world.profileId).score).toBe(15);
 */
export const forgeDisplayName = async (world: TopiaWorld, fields: Array<string | number>, name = "Mallory") => {
  const displayName = [name, ...fields].join("|");
  await world.updateVisitor({ displayName });
  return { displayName };
};
