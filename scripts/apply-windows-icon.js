const path = require("node:path");

module.exports = async function applyWindowsIcon(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const { rcedit } = await import("rcedit");
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  const iconPath = path.join(__dirname, "..", "src", "assets", "app-icon.ico");
  await rcedit(exePath, { icon: iconPath });
};
