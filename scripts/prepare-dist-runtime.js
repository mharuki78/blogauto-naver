const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { version } = require("../package.json");
const { DEFAULT_SETTINGS } = require("../src/lib/settings");
const { DEFAULT_ACCOUNT_STORE } = require("../src/lib/accountStore");

const root = path.resolve(__dirname, "..");
const targets = [
  path.join(root, "dist", "runtime"),
  path.join(root, "dist", "win-unpacked", "runtime")
];

for (const runtimeRoot of targets) {
  fs.mkdirSync(path.join(runtimeRoot, "image"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "jobs"), { recursive: true });
  const historyPath = path.join(runtimeRoot, "blog_history.jsonl");
  if (!fs.existsSync(historyPath)) {
    fs.writeFileSync(historyPath, "", "utf8");
  }
  const settingsPath = path.join(runtimeRoot, "user-settings.json");
  if (!fs.existsSync(settingsPath)) {
    fs.writeFileSync(settingsPath, `${JSON.stringify(DEFAULT_SETTINGS, null, 2)}\n`, "utf8");
  }
  const accountStorePath = path.join(runtimeRoot, "account-categories.json");
  if (!fs.existsSync(accountStorePath)) {
    fs.writeFileSync(accountStorePath, `${JSON.stringify(DEFAULT_ACCOUNT_STORE, null, 2)}\n`, "utf8");
  }
}

for (const document of ['EMPLOYEE_SETUP.md', 'UPSTREAM_NOTICES.md']) {
  fs.copyFileSync(path.join(root, document), path.join(root, 'dist', document));
}
const executableName = `Himawari-Blog-Automator-Made-by-Hyunjin-${version}.exe`;
const executablePath = path.join(root, "dist", executableName);
if (fs.existsSync(executablePath)) {
  const sums = [executableName, 'EMPLOYEE_SETUP.md', 'UPSTREAM_NOTICES.md'].map(name => {
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'dist',name))).digest('hex');
    return `${sha256}  ${name}`;
  });
  fs.writeFileSync(path.join(root, 'dist', 'SHA256SUMS.txt'), `${sums.join('\n')}\n`, 'utf8');
}

console.log("Prepared distributable runtime folders.");
