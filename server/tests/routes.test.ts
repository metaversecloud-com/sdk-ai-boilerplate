const topiaMock = require("../mocks/@rtsdk/topia").__mock;

import express from "express";
import request from "supertest";
import axios from "axios";

import router from "../routes.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

const baseCreds = {
  assetId: "asset-123",
  interactivePublicKey: process.env.INTERACTIVE_KEY,
  interactiveNonce: "nonce-xyz",
  visitorId: 1,
  urlSlug: "my-world",
};

// Mock axios for external API calls
jest.mock("axios");
const mockedAxios = jest.mocked(axios);

// Mock the utils
jest.mock("@utils/index.js", () => ({
  errorHandler: jest.fn(),
  getCredentials: jest.fn(),
  getDroppedAsset: jest.fn(),
  Visitor: {
    get: jest.fn(),
  },
  World: {
    create: jest.fn(),
  },
}));

const mockUtils = jest.mocked(require("@utils/index.js"));

describe("routes", () => {
  beforeEach(() => {
    topiaMock.reset();
    jest.clearAllMocks();
  });

  test("GET /system/health returns status OK and env keys", async () => {
    const app = makeApp();
    let res = await request(app).get("/api/system/health");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "OK");
    expect(res.body).toHaveProperty("envs");
    expect(res.body.envs).toHaveProperty("NODE_ENV");
  });

  test("GET /game-state returns game state with dropped asset and admin status", async () => {
    const mockDroppedAsset = {
      id: "dropped-asset-123",
      position: { x: 100, y: 200 },
      name: "Test Asset"
    };

    const mockVisitor = {
      isAdmin: true,
      id: 1
    };

    const mockWorld = {
      triggerParticle: jest.fn().mockResolvedValue({}),
      fireToast: jest.fn().mockResolvedValue({})
    };

    // Setup mocks
    mockUtils.getCredentials.mockReturnValue(baseCreds);
    mockUtils.getDroppedAsset.mockResolvedValue(mockDroppedAsset);
    mockUtils.Visitor.get.mockResolvedValue(mockVisitor);
    mockUtils.World.create.mockReturnValue(mockWorld);
    mockedAxios.post.mockResolvedValue({ data: { success: true } });

    const app = makeApp();
    const res = await request(app)
      .get("/api/game-state")
      .query(baseCreds);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("success", true);
    expect(res.body).toHaveProperty("droppedAsset", mockDroppedAsset);
    expect(res.body).toHaveProperty("isAdmin", true);

    // Verify mocks were called correctly
    expect(mockUtils.getCredentials).toHaveBeenCalledWith(expect.objectContaining({
      assetId: "asset-123",
      interactiveNonce: "nonce-xyz",
      urlSlug: "my-world",
      visitorId: "1" // Query params come as strings
    }));
    expect(mockUtils.getDroppedAsset).toHaveBeenCalledWith(baseCreds);
    expect(mockUtils.Visitor.get).toHaveBeenCalledWith(baseCreds.visitorId, baseCreds.urlSlug, { credentials: baseCreds });
    expect(mockUtils.World.create).toHaveBeenCalledWith(baseCreds.urlSlug, { credentials: baseCreds });
    expect(mockWorld.triggerParticle).toHaveBeenCalledWith({
      name: "Sparkle",
      duration: 3,
      position: mockDroppedAsset.position
    });
    expect(mockWorld.fireToast).toHaveBeenCalledWith({
      title: "You've leveled up!",
      text: "Congratulations! You've reached a new level."
    });
  });

  test("GET /game-state handles errors when getDroppedAsset fails", async () => {
    const mockError = new Error("Asset not found");

    mockUtils.getCredentials.mockReturnValue(baseCreds);
    mockUtils.getDroppedAsset.mockResolvedValue(mockError);

    // Mock errorHandler to actually call res.status().json() to end the response
    mockUtils.errorHandler.mockImplementation(({ res }: any) => {
      if (res) {
        return res.status(500).json({ error: "Internal server error" });
      }
      return { status: 500, message: "error" };
    });

    const app = makeApp();
    await request(app)
      .get("/api/game-state")
      .query(baseCreds);

    expect(mockUtils.errorHandler).toHaveBeenCalledWith({
      error: mockError,
      functionName: "getDroppedAssetDetails",
      message: "Error getting dropped asset instance and data object",
      req: expect.any(Object),
      res: expect.any(Object)
    });
  }, 30000);
});
