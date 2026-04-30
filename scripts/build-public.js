const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const out = path.join(root, "public");
const files = ["index.html", "app.js", "styles.css", "README.md", "config.public.example.js"];
const directories = ["src"];

function copyDirectory(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}

for (const directory of directories) {
  copyDirectory(path.join(root, directory), path.join(out, directory));
}

const apiBaseUrl = process.env.API_BASE_URL || "";
const config = `window.MISSION_TRACKER_CONFIG = ${JSON.stringify({ apiBaseUrl }, null, 2)};\n`;
fs.writeFileSync(path.join(out, "config.public.js"), config);
