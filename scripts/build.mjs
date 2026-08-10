import { build } from "esbuild";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(scriptDir);
const distDir = path.join(projectDir, "dist");
const cacheDir = path.join(projectDir, ".build-cache");
const workDir = path.join(projectDir, `.build-work-${process.pid}`);
const nodeVersion = process.versions.node;
const postjectBin = path.join(projectDir, "node_modules", ".bin", "postject");
const seaFuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const targets = [
  { platform: "macos", displayPlatform: "macOS", nodePlatform: "darwin", label: "arm64", nodeArch: "arm64", archiveType: "tar.gz" },
  { platform: "macos", displayPlatform: "macOS", nodePlatform: "darwin", label: "amd64", nodeArch: "x64", archiveType: "tar.gz" },
  { platform: "windows", displayPlatform: "Windows", nodePlatform: "win", label: "arm64", nodeArch: "arm64", archiveType: "zip" },
  { platform: "windows", displayPlatform: "Windows", nodePlatform: "win", label: "amd64", nodeArch: "x64", archiveType: "zip" }
];

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function collectAssets(directory, prefix = "") {
  const assets = {};
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(assets, await collectAssets(absolute, relative));
    else if (entry.isFile()) assets[relative] = (await readFile(absolute)).toString("base64");
  }
  return assets;
}

async function download(url, destination) {
  if (await pathExists(destination)) {
    console.log(`  使用缓存：${path.basename(destination)}`);
    return;
  }
  console.log(`  下载：${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）：${url}`);
  const temporary = `${destination}.download-${process.pid}`;
  await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
  await rename(temporary, destination);
}

async function createBundle() {
  const assets = await collectAssets(path.join(projectDir, "public"));
  const banner = [
    "const __reviewPilotEmitWarning = process.emitWarning;",
    "process.emitWarning = function (warning, ...args) {",
    "  const options = args[0];",
    "  const type = typeof options === 'string' ? options : options?.type;",
    "  if (type === 'ExperimentalWarning') return;",
    "  return __reviewPilotEmitWarning.call(process, warning, ...args);",
    "};",
    "globalThis.__REVIEWPILOT_STANDALONE__ = true;",
    `globalThis.__REVIEWPILOT_ASSETS__ = ${JSON.stringify(assets)};`
  ].join("\n");
  const bundlePath = path.join(workDir, "reviewpilot.cjs");
  await build({
    entryPoints: [path.join(projectDir, "server.mjs")],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    banner: { js: banner },
    define: { "import.meta.url": JSON.stringify("file:///standalone/server.mjs") },
    logLevel: "warning"
  });
  return bundlePath;
}

async function createSeaBlob(bundlePath) {
  const blobPath = path.join(workDir, "reviewpilot.blob");
  const configPath = path.join(workDir, "sea-config.json");
  await writeFile(configPath, `${JSON.stringify({
    main: bundlePath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false
  }, null, 2)}\n`);
  await run(process.execPath, ["--experimental-sea-config", configPath], { maxBuffer: 10 * 1024 * 1024 });
  return blobPath;
}

async function extractNodeRuntime(target) {
  const archiveName = `node-v${nodeVersion}-${target.nodePlatform}-${target.nodeArch}.${target.archiveType}`;
  const archiveRoot = `node-v${nodeVersion}-${target.nodePlatform}-${target.nodeArch}`;
  const archivePath = path.join(cacheDir, archiveName);
  await download(`https://nodejs.org/dist/v${nodeVersion}/${archiveName}`, archivePath);
  const extractDir = path.join(workDir, `node-${target.platform}-${target.label}`);
  await mkdir(extractDir, { recursive: true });
  if (target.nodePlatform === "darwin") {
    await run("/usr/bin/tar", [
      "-xzf",
      archivePath,
      "-C",
      extractDir,
      "--strip-components=2",
      `${archiveRoot}/bin/node`
    ]);
    return path.join(extractDir, "node");
  }
  await run("/usr/bin/unzip", ["-q", archivePath, `${archiveRoot}/node.exe`, "-d", extractDir]);
  return path.join(extractDir, archiveRoot, "node.exe");
}

async function stripWindowsSignature(executablePath) {
  const executable = await readFile(executablePath);
  if (executable.length < 256 || executable.readUInt16LE(0) !== 0x5a4d) {
    throw new Error("Windows Node 运行时不是有效的 PE 文件");
  }
  const peOffset = executable.readUInt32LE(0x3c);
  if (peOffset + 160 > executable.length || executable.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error("Windows Node 运行时的 PE 头无效");
  }
  const optionalHeader = peOffset + 24;
  const optionalMagic = executable.readUInt16LE(optionalHeader);
  const dataDirectory = optionalHeader + (optionalMagic === 0x20b ? 112 : optionalMagic === 0x10b ? 96 : 0);
  if (dataDirectory === optionalHeader) throw new Error("不支持该 Windows PE 格式");
  const certificateEntry = dataDirectory + (4 * 8);
  const certificateOffset = executable.readUInt32LE(certificateEntry);
  const certificateSize = executable.readUInt32LE(certificateEntry + 4);
  executable.writeUInt32LE(0, certificateEntry);
  executable.writeUInt32LE(0, certificateEntry + 4);
  const certificateEnd = certificateOffset + certificateSize;
  const unsigned = certificateOffset > 0 && certificateSize > 0 && certificateEnd === executable.length
    ? executable.subarray(0, certificateOffset)
    : executable;
  await writeFile(executablePath, unsigned);
}

async function createExecutable(target, blobPath) {
  console.log(`\n  生成 ${target.displayPlatform} ${target.label} 版本…`);
  const nodeRuntime = await extractNodeRuntime(target);
  const baseName = `ReviewPilot-${target.platform}-${target.label}`;
  const executable = path.join(distDir, `${baseName}${target.nodePlatform === "win" ? ".exe" : ""}`);
  await copyFile(nodeRuntime, executable);
  await chmod(executable, 0o755);
  if (target.nodePlatform === "darwin") {
    try {
      await run("/usr/bin/codesign", ["--remove-signature", executable]);
    } catch {
      // Some Node distributions may already be unsigned.
    }
  } else {
    await stripWindowsSignature(executable);
  }
  const injectionArguments = [
    executable,
    "NODE_SEA_BLOB",
    blobPath,
    "--sentinel-fuse",
    seaFuse
  ];
  if (target.nodePlatform === "darwin") injectionArguments.push("--macho-segment-name", "NODE_SEA");
  await run(postjectBin, injectionArguments, { maxBuffer: 20 * 1024 * 1024 });
  if (target.nodePlatform === "darwin") {
    const signingIdentity = process.env.MACOS_CODESIGN_IDENTITY || "-";
    const signingArguments = ["--force", "--sign", signingIdentity];
    if (signingIdentity !== "-") signingArguments.push("--options", "runtime", "--timestamp");
    signingArguments.push(executable);
    await run("/usr/bin/codesign", signingArguments, { maxBuffer: 10 * 1024 * 1024 });
  }

  const zipPath = path.join(distDir, `${baseName}.zip`);
  await run("/usr/bin/zip", ["-j", "-9", zipPath, executable]);
  const { stdout } = await run("/usr/bin/file", [executable]);
  console.log(`  完成：${path.relative(projectDir, executable)}`);
  console.log(`  发布包：${path.relative(projectDir, zipPath)}`);
  console.log(`  ${stdout.trim()}`);
}

async function main() {
  if (process.platform !== "darwin") throw new Error("当前构建脚本需要在 macOS 上运行");
  if (!(await pathExists(postjectBin))) throw new Error("缺少构建依赖，请先执行 npm install");
  await rm(workDir, { recursive: true, force: true });
  await rm(distDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await mkdir(distDir, { recursive: true });
  try {
    console.log(`ReviewPilot 独立程序构建（Node.js ${nodeVersion}）`);
    const bundlePath = await createBundle();
    const blobPath = await createSeaBlob(bundlePath);
    for (const target of targets) await createExecutable(target, blobPath);
    console.log("\n构建完成。dist 中已生成 macOS 与 Windows 的 arm64/amd64 发布包。\n");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`\n构建失败：${error.message}\n`);
  process.exitCode = 1;
});
