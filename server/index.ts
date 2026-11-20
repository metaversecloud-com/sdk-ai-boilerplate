import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import router from "./routes.js";
import path from "path";
import { cleanReturnPayload } from "@utils/cleanReturnPayload.js";
import { fileURLToPath } from "url";

dotenv.config({ path: "../.env" });

function checkEnvVariables() {
  const requiredEnvVariables = ["INTERACTIVE_KEY", "INTERACTIVE_SECRET"];
  const missingVariables = requiredEnvVariables.filter((variable) => !process.env[variable]);

  if (missingVariables.length > 0) {
    throw new Error(`Missing required environment variables in the .env file: ${missingVariables.join(", ")}`);
  } else {
    console.log("All required environment variables provided.");
  }
}
checkEnvVariables();

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
// A malformed JSON body gets a clean 400 instead of Express' default error page (stack trace, file paths).
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err?.type === "entity.parse.failed") return res.status(400).json({ success: false, error: "Invalid JSON" });
  next(err);
});
// Strips the interactive secret, signed JWTs and session credentials from every /api response,
// including raw SDK objects and SDK errors. Must be registered before the routes to run at all.
app.use("/api", function (req, res, next) {
  const ogSend = res.send;
  // @ts-ignore
  res.send = function (data) {
    res.send = ogSend;
    if (!data) return res.send(data);
    try {
      // Clean a copy: deleting fields from a live SDK object would break code still using it.
      return res.send(cleanReturnPayload(JSON.parse(typeof data === "string" ? data : JSON.stringify(data))));
    } catch {
      // Not JSON (plain text, buffers): nothing to scrub.
      return res.send(data);
    }
  };
  next();
});
app.use("/api", router);

if (process.env.NODE_ENV === "development") {
  const corsOptions = {
    origin: ["http://localhost:3000", "http://localhost:5173"],
    credentials: true, //access-control-allow-credentials:true
    optionSuccessStatus: 200,
  };
  app.use(cors(corsOptions));
} else {
  // Node serves the files for the React app
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  app.use(express.static(path.resolve(__dirname, "../../../client/build")));

  // All other GET requests not handled before will return our React app
  app.get("*", (req, res) => {
    res.sendFile(path.resolve(__dirname, "../../../client/build", "index.html"));
  });
}

// Prevent crashes from unhandled promise rejections (e.g., API timeouts after response sent).
// @rtsdk/topia registers its own handler that calls process.exit(1) when it's imported: remove it first.
process.removeAllListeners("unhandledRejection");
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  // ERR_HTTP_HEADERS_SENT is non-fatal — response was already sent, just log it
  if ((error as any).code === "ERR_HTTP_HEADERS_SENT") {
    console.error("Caught ERR_HTTP_HEADERS_SENT (response already sent):", error.message);
    return;
  }
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

app.listen(PORT, () => {
  console.log(`Server is running on port: ${PORT}`);
});
