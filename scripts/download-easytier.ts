/**
 * EasyTier 二进制下载脚本（全平台）
 *
 * 用法：pnpm download-easytier
 *
 * 从 GitHub Releases 下载 easytier-core 预编译二进制到 native/easytier/<os>-<arch>/
 * 支持平台：windows-x86_64 / windows-arm64 / linux-x86_64 / linux-aarch64 /
 *          macos-x86_64 / macos-aarch64
 *
 * 若 参考项目/EasyTier/二进制文件/ 存在则优先从本地复制（离线场景）。
 *
 * EasyTier: https://github.com/EasyTier/EasyTier
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const VERSION = "v2.6.4";
const BASE_URL = `https://github.com/EasyTier/EasyTier/releases/download/${VERSION}`;
const MIRRORS = ["", "https://gh.llkk.cc/", "https://gh.ddlc.top/", "https://slink.ltd/"];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const TARGET_ROOT = path.join(PROJECT_ROOT, "native", "easytier");
const LOCAL_SRC = path.join(PROJECT_ROOT, "参考项目", "EasyTier", "二进制文件");

/** 目标平台 → 远端资产命名 */
const TARGETS: Array<{
  dir: string;
  remote: string;
  binary: string;
  deps?: string[];
}> = [
  {
    dir: "win-x64",
    remote: "easytier-windows-x86_64",
    binary: "easytier-core.exe",
    deps: ["wintun.dll", "Packet.dll", "WinDivert64.sys"],
  },
  {
    dir: "win-arm64",
    remote: "easytier-windows-arm64",
    binary: "easytier-core.exe",
    deps: ["wintun.dll", "Packet.dll", "WinDivert64.sys"],
  },
  { dir: "linux-x64", remote: "easytier-linux-x86_64", binary: "easytier-core" },
  { dir: "linux-arm64", remote: "easytier-linux-aarch64", binary: "easytier-core" },
  { dir: "mac-x64", remote: "easytier-macos-x86_64", binary: "easytier-core" },
  { dir: "mac-arm64", remote: "easytier-macos-aarch64", binary: "easytier-core" },
];

/** 优先从 参考项目/EasyTier/二进制文件/ 本地复制 */
const copyFromLocal = (target: {
  dir: string;
  remote: string;
  binary: string;
  deps?: string[];
}): boolean => {
  if (!existsSync(LOCAL_SRC)) return false;
  const localDir = path.join(LOCAL_SRC, target.remote);
  if (!existsSync(localDir)) return false;
  const dstDir = path.join(TARGET_ROOT, target.dir);
  mkdirSync(dstDir, { recursive: true });
  // 复制 easytier-core + Windows 依赖 DLL
  for (const file of readdirSync(localDir)) {
    // 跳过 cli / web / web-embed（不需要）
    if (/easytier-(cli|web|web-embed)/.test(file)) continue;
    copyFileSync(path.join(localDir, file), path.join(dstDir, file));
  }
  console.log(`[本地] ${target.dir} <- ${localDir}`);
  return true;
};

/** 下载并解压单个平台 */
const downloadOne = async (target: {
  dir: string;
  remote: string;
  binary: string;
  deps?: string[];
}): Promise<boolean> => {
  const dstDir = path.join(TARGET_ROOT, target.dir);
  const dstBinary = path.join(dstDir, target.binary);
  // 检查主二进制 + 所有依赖是否都已存在，缺少任一文件则重新下载
  const allFilesExist =
    existsSync(dstBinary) && (target.deps ?? []).every((dep) => existsSync(path.join(dstDir, dep)));
  if (allFilesExist) {
    console.log(`[跳过] ${target.dir} 所有文件已存在`);
    return true;
  }
  if (existsSync(dstBinary)) {
    console.log(`[补全] ${target.dir} 主二进制已存在，但依赖缺失，重新下载`);
  }
  mkdirSync(dstDir, { recursive: true });

  const zipName = `${target.remote}-${VERSION}.zip`;
  const zipPath = path.join(dstDir, zipName);

  // 尝试镜像
  let downloaded = false;
  for (const mirror of MIRRORS) {
    const url = `${mirror}${BASE_URL}/${zipName}`;
    console.log(`[尝试] ${url}`);
    try {
      const resp = await fetch(url, { redirect: "follow" });
      if (!resp.ok || !resp.body) {
        console.log(`[失败] HTTP ${resp.status}`);
        continue;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 1024) {
        console.log(`[失败] 文件过小`);
        continue;
      }
      writeFileSync(zipPath, buf);
      downloaded = true;
      console.log(`[成功] 下载完成`);
      break;
    } catch (err) {
      console.log(`[失败] ${(err as Error).message}`);
    }
  }
  if (!downloaded) {
    console.error(`[错误] ${target.dir} 所有镜像均失败`);
    return false;
  }

  // 解压：用 PowerShell（Windows）或 unzip/7z（其他平台）
  // Windows 平台需解压全部文件（含 wintun.dll 等依赖），其他平台只需 easytier-core
  const binary = target.binary;
  const isWindows = target.dir.startsWith("win");
  const extracted = (() => {
    if (process.platform === "win32") {
      // PowerShell Expand-Archive 解压全部文件
      const r = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path '${zipPath}' -DestinationPath '${dstDir}' -Force; Remove-Item '${zipPath}'`,
        ],
        { encoding: "utf8" },
      );
      return r.status === 0;
    }
    // 非 Windows 开发机：Windows 目标也需解压全部文件
    if (isWindows) {
      if (spawnSync("unzip", ["-o", zipPath, "-d", dstDir]).status === 0) {
        try {
          unlinkSync(zipPath);
        } catch {
          // ignore
        }
        return true;
      }
      if (spawnSync("7z", ["x", "-y", zipPath, `-o${dstDir}`]).status === 0) {
        try {
          unlinkSync(zipPath);
        } catch {
          // ignore
        }
        return true;
      }
      return false;
    }
    // Linux/macOS 目标：只需 easytier-core
    if (spawnSync("unzip", ["-o", zipPath, binary, "-d", dstDir]).status === 0) {
      try {
        unlinkSync(zipPath);
      } catch {
        // ignore
      }
      return true;
    }
    if (spawnSync("7z", ["x", "-y", zipPath, binary, `-o${dstDir}`]).status === 0) {
      try {
        unlinkSync(zipPath);
      } catch {
        // ignore
      }
      return true;
    }
    return false;
  })();

  if (!extracted) {
    console.error(`[错误] ${target.dir} 解压失败，请手动解压 ${zipPath}`);
    return false;
  }
  // zip 内可能有子目录，将子目录中的文件提升到目标目录
  const walk = (dir: string): string[] => {
    const files: string[] = [];
    for (const f of readdirSync(dir)) {
      const full = path.join(dir, f);
      if (statSync(full).isDirectory()) {
        files.push(...walk(full));
      } else {
        files.push(full);
      }
    }
    return files;
  };
  // 如果主二进制不在目标目录根层，从子目录中提升所有文件
  if (!existsSync(path.join(dstDir, binary))) {
    for (const src of walk(dstDir)) {
      const filename = path.basename(src);
      const dst = path.join(dstDir, filename);
      if (src !== dst) {
        copyFileSync(src, dst);
      }
    }
  }
  // 验证主二进制存在
  if (!existsSync(path.join(dstDir, binary))) {
    console.error(`[错误] ${target.dir} 解压后未找到 ${binary}`);
    return false;
  }
  // 验证 Windows 依赖
  if (isWindows && target.deps) {
    for (const dep of target.deps) {
      if (!existsSync(path.join(dstDir, dep))) {
        console.warn(`[警告] ${target.dir} 缺少依赖: ${dep}`);
      }
    }
  }
  console.log(`[完成] ${target.dir}/${binary}`);
  return true;
};

const main = async (): Promise<void> => {
  console.log(`==========================================`);
  console.log(` EasyTier 二进制下载脚本`);
  console.log(` 版本: ${VERSION}`);
  console.log(` 目标: ${TARGET_ROOT}`);
  console.log(`==========================================`);

  mkdirSync(TARGET_ROOT, { recursive: true });
  let allOk = true;
  for (const target of TARGETS) {
    if (copyFromLocal(target)) continue;
    const ok = await downloadOne(target);
    if (!ok) allOk = false;
  }
  if (!allOk) {
    console.error("\n部分平台下载失败，请检查网络或手动放置二进制。");
    process.exit(1);
  }
  console.log("\n全部平台就绪。");
};

void main();