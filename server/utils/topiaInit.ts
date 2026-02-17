import dotenv from "dotenv";
dotenv.config({ path: "../.env" });

import {
  Topia,
  AssetFactory,
  DroppedAssetFactory,
  EcosystemFactory,
  UserFactory,
  VisitorFactory,
  WorldFactory,
  WorldActivityFactory,
} from "@rtsdk/topia";

const config = {
  apiDomain: process.env.INSTANCE_DOMAIN || "api.topia.io",
  apiProtocol: process.env.INSTANCE_PROTOCOL || "https",
  interactiveKey: process.env.INTERACTIVE_KEY,
  interactiveSecret: process.env.INTERACTIVE_SECRET,
};

const myTopiaInstance = new Topia(config);

const Asset = new AssetFactory(myTopiaInstance);
const DroppedAsset = new DroppedAssetFactory(myTopiaInstance);
const Ecosystem = new EcosystemFactory(myTopiaInstance);
const User = new UserFactory(myTopiaInstance);
const Visitor = new VisitorFactory(myTopiaInstance);
const World = new WorldFactory(myTopiaInstance);
const WorldActivity = new WorldActivityFactory(myTopiaInstance);

export { Asset, DroppedAsset, Ecosystem, User, Visitor, World, WorldActivity };
