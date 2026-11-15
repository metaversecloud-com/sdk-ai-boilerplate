// Shared by every SDK app: keep this file identical across repos.
import { ChildProcess, execFileSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_IMAGE, appEnv } from "../appEnv";

const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRELOAD_DIR = path.join(E2E_DIR, "helpers/preload");
const FIRED = "[e2e] rejecting a promise nobody handles";
const SURVIVED = "[e2e] still running after the unhandled rejection";

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = net.createServer();
    server.listen(0, () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type PrivateServerResult<T> = {
  /** What `use` resolved to; undefined if it threw (e.g. the connection dropped when the app crashed). */
  result?: T;
  error?: unknown;
  /** Whether the instance still answered its health check afterwards. */
  alive: boolean;
  /** The instance's stdout and stderr. */
  output: string;
};

/**
 * Runs `use` against a private app instance on a free port (same build or Docker image as the shared
 * server, same mocks, env from appEnv.ts), so a test can crash the app without taking the shared server
 * down for every other test. Slow (it starts a server): call test.slow() in the test.
 *
 * unhandledRejection: true preloads helpers/preload/unhandledRejection.cjs, which rejects a promise
 * nobody handles as soon as the app listens; `alive` then tells whether the process survived it.
 */
export const withPrivateServer = async <T>(
  use: (baseURL: string) => Promise<T>,
  { unhandledRejection = false, env = {} }: { unhandledRejection?: boolean; env?: Record<string, string> } = {},
): Promise<PrivateServerResult<T>> => {
  const port = await freePort();
  const baseURL = `http://localhost:${port}`;
  const container = `sdk-app-e2e-private-${port}`;
  let child: ChildProcess;
  if (APP_IMAGE) {
    const vars = {
      ...appEnv(3000),
      ...env,
      ...(unhandledRejection && { NODE_OPTIONS: "--require=/e2e-preload/unhandledRejection.cjs" }),
    };
    child = spawn("docker", [
      "run",
      "--rm",
      "--init",
      "--name",
      container,
      "--add-host=host.docker.internal:host-gateway",
      "-p",
      `${port}:3000`,
      ...(unhandledRejection ? ["-v", `${PRELOAD_DIR}:/e2e-preload:ro`] : []),
      ...Object.entries(vars).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
      APP_IMAGE,
    ]);
  } else {
    // Not the worker's NODE_OPTIONS: Playwright may have put its own loader there.
    const nodeOptions = unhandledRejection ? `--require "${path.join(PRELOAD_DIR, "unhandledRejection.cjs")}"` : "";
    // Same command as the shared server (minus the build it already ran), in its own process group so
    // npm and the app go down together.
    child = spawn("npm", ["start", "--prefix", ".."], {
      cwd: E2E_DIR,
      env: { ...process.env, ...appEnv(port), ...env, NODE_OPTIONS: nodeOptions },
      detached: true,
    });
  }

  let output = "";
  child.stdout?.on("data", (chunk) => (output += chunk));
  child.stderr?.on("data", (chunk) => (output += chunk));
  let exited = false;
  const exit = new Promise<void>((resolve) => child.once("exit", () => ((exited = true), resolve())));
  const health = () =>
    fetch(`${baseURL}/api/system/health`)
      .then((r) => r.ok)
      .catch(() => false);
  const alive = async () => !exited && (await health());

  try {
    for (let started = Date.now(); !(await health()); await sleep(100)) {
      // Exiting on the deliberate rejection before the first health check is a result, not a failed start.
      if (exited && unhandledRejection && output.includes(FIRED)) return { alive: false, output };
      if (exited || Date.now() - started > 60_000)
        throw new Error(`private app instance didn't start:\n${output.slice(-2000)}`);
    }
    if (unhandledRejection) {
      // Either the process reports it survived or it exits; whichever comes first.
      for (let started = Date.now(); !output.includes(SURVIVED) && !exited && Date.now() - started < 10_000; )
        await sleep(50);
    }
    let result: T | undefined;
    let error: unknown;
    // A crashing request may never get an answer.
    await Promise.race([
      use(baseURL).then(
        (r) => (result = r),
        (e) => (error = e),
      ),
      exit,
    ]);
    // A crash right after the response: process.exit runs once the rejection is processed.
    await Promise.race([exit, sleep(500)]);
    return { result, error, alive: await alive(), output };
  } finally {
    if (APP_IMAGE) {
      try {
        execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
      } catch {
        // Already gone.
      }
    } else if (!exited && child.pid) {
      process.kill(-child.pid, "SIGKILL");
    }
    await Promise.race([exit, sleep(5_000)]);
  }
};
