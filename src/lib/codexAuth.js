const { spawn } = require("node:child_process");

function codexSpawnOptions(codexPath, extra = {}) {
  return {
    shell: /\.(cmd|bat)$/i.test(String(codexPath || "")),
    windowsHide: true,
    ...extra
  };
}

function checkCodexLogin(codexPath) {
  return new Promise((resolve) => {
    let settled = false;
    let output = "";
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      child = spawn(codexPath, ["login", "status"], codexSpawnOptions(codexPath, { stdio: ["ignore", "pipe", "pipe"] }));
    } catch {
      finish({ available: false, loggedIn: false, mode: "none" });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish({ available: false, loggedIn: false, mode: "none" });
    }, 10000);
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        output = (output + String(chunk)).slice(-2000);
      });
    }
    child.once("error", () => {
      clearTimeout(timer);
      finish({ available: false, loggedIn: false, mode: "none" });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const loggedIn = code === 0;
      const mode = !loggedIn ? "none" : /chatgpt/i.test(output) ? "chatgpt" : /api key/i.test(output) ? "api" : "other";
      const available = !/not recognized|not found|cannot find/i.test(output);
      finish({ available, loggedIn, mode });
    });
  });
}

function startCodexLogin(codexPath) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(codexPath, ["login"], codexSpawnOptions(codexPath, {
        detached: true,
        stdio: "ignore",
        windowsHide: false
      }));
    } catch (error) {
      reject(error);
      return;
    }
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve({ started: true });
    });
  });
}

module.exports = { checkCodexLogin, startCodexLogin };
