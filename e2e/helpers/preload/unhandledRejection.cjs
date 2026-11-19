// Preloaded into a private app instance (NODE_OPTIONS=--require, see privateServer.ts) to check how the
// process treats a promise rejection nobody handles. Once the app listens on PORT, every module has been
// imported and every process handler registered: reject a promise without a handler, then report that
// the process is still running. If a handler exits the process, the second line never appears.
const net = require("node:net");

const listen = net.Server.prototype.listen;
let fired = false;
net.Server.prototype.listen = function (...args) {
  this.once("listening", () => {
    if (fired || this.address()?.port !== Number(process.env.PORT)) return;
    fired = true;
    console.log("[e2e] rejecting a promise nobody handles");
    Promise.reject(new Error("e2e: deliberate unhandled rejection"));
    setTimeout(() => console.log("[e2e] still running after the unhandled rejection"), 200);
  });
  return listen.apply(this, args);
};
