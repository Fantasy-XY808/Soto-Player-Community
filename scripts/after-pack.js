import { readdir, unlink, rm, stat, open, rename, readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

/** 保留的 locale */
const keepLocales = new Set(["en-US.pak", "zh-CN.pak"]);

/**
 * v3.4.10：过滤 asar，移除不该打包的大目录
 *
 * 问题：electron-builder 26 + pnpm 下 files 配置被拆成 firstOrDefaultFilePatterns
 * （硬编码默认通配符 + 排除 node_modules/public/dist）和 nodeModuleFilePatterns（来自 files）。
 * 导致 target/（7GB Rust 产物）、参考项目/（125MB）、native/openrgb 多平台二进制等全打进 asar。
 *
 * 修复：afterPack 阶段直接操作 asar 二进制——读取 header JSON，过滤掉 target/ 等目录，
 * 重新计算 offset，写新 header + 复制保留的文件数据。不解压，不重打，O(n) 遍历一次。
 */
const filterAsar = async (asarPath) => {
  const fd = await open(asarPath, "r");

  // 1. 读取 asar header
  // asar 格式：8字节 pickle size + 4字节 0x04 + 4字节 json size + json header + 文件数据
  let header;
  let dataOffset;
  try {
    const sizeBuf = Buffer.alloc(8);
    await fd.read(sizeBuf, 0, 8, 0);
    // sizeBuf[4..8] 是 payload size（含 4字节 0x04 + 4字节 json size + json）
    const payloadSize = sizeBuf.readUInt32LE(4);
    const jsonSizeBuf = Buffer.alloc(8);
    await fd.read(jsonSizeBuf, 0, 8, 8);
    const jsonSize = jsonSizeBuf.readUInt32LE(4);
    const headerBuf = Buffer.alloc(jsonSize);
    await fd.read(headerBuf, 0, jsonSize, 16);
    try {
      header = JSON.parse(headerBuf.toString("utf8"));
    } catch (err) {
      throw new Error(`解析 asar header JSON 失败 (${asarPath}): ${err.message}`);
    }
    // 数据段起始 offset（相对文件头）
    dataOffset = 8 + payloadSize;
  } catch (err) {
    await fd.close();
    throw err;
  }

  // 2. 过滤 header，移除不该打包的目录和根目录文件
  const dirsToRemove = new Set([
    "target",
    "target_bak",
    "参考项目",
    "参考项目_bak",
    "src",
    "electron",
    "shared",
    "scripts",
    "native",
    "docs",
    "demo",
    "build",
    "training",
    "windows",
    ".github",
    ".dbg",
    ".vscode",
    ".rust-target",
  ]);

  // 根目录下不该打包的文件（electron-builder 26 + pnpm 的 firstOrDefaultFilePatterns
  // 硬编码 通配符 会把这些配置/文档/源码文件全打进 asar，这里兜底过滤）
  const rootFilesToRemove = new Set([
    ".npmrc",
    ".prettierignore",
    ".prettierrc.yaml",
    "AGENTS.md",
    "Plan.md",
    "TO-DO.md",
    "USER_AGREEMENT.md",
    "README.md",
    "README.zh-CN.md",
    "Cargo.lock",
    "Cargo.toml",
    "asar-list.txt",
    "auto-eslint.mjs",
    "eslint.config.mjs",
    "dev-app-update.yml",
    "electron-builder.config.ts",
    "electron.vite.config.ts",
    "uno.config.ts",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "tsconfig.node.json",
    "tsconfig.web.json",
    "components.d.ts",
    "auto-imports.d.ts",
    "LICENSE", // license 已通过 nsis.license 配置单独提供
  ]);

  let removedCount = 0;
  let removedBytes = 0;

  const filterNode = (node, path) => {
    if (!node.files) return true;
    for (const name of Object.keys(node.files)) {
      const childPath = path ? `${path}/${name}` : name;
      const child = node.files[name];
      const shouldRemove =
        dirsToRemove.has(childPath) ||
        (path === "" && rootFilesToRemove.has(name));
      if (shouldRemove) {
        // 计算被删除的字节数
        if (child.size) {
          removedBytes += child.size;
        } else if (child.files) {
          // 目录：递归计算
          const calcDirSize = (n) => {
            if (!n.files) return 0;
            let total = 0;
            for (const k of Object.keys(n.files)) {
              const c = n.files[k];
              total += c.size ?? calcDirSize(c);
            }
            return total;
          };
          removedBytes += calcDirSize(child);
        }
        removedCount++;
        delete node.files[name];
      } else if (child.files) {
        const keep = filterNode(child, childPath);
        if (!keep) {
          delete node.files[name];
          removedCount++;
        }
      }
    }
    return Object.keys(node.files).length > 0;
  };

  filterNode(header, "");

  // 3. 重新计算 offset，收集要保留的文件
  const filesToKeep = [];
  let currentOffset = 0;

  const recalculateOffsets = (node) => {
    if (!node.files) return;
    for (const name of Object.keys(node.files)) {
      const child = node.files[name];
      if (child.files) {
        recalculateOffsets(child);
      } else if (child.size !== undefined && child.offset !== undefined) {
        const oldOffset = parseInt(child.offset, 10);
        filesToKeep.push({
          offset: oldOffset,
          size: child.size,
          newOffset: currentOffset,
        });
        child.offset = String(currentOffset);
        currentOffset += child.size;
        // asar 对齐：每个文件 4 字节对齐
        const padding = (4 - (child.size % 4)) % 4;
        currentOffset += padding;
      }
    }
  };

  recalculateOffsets(header);

  console.log(
    `[after-pack] 过滤 asar: 删除 ${removedCount} 项, 释放 ${Math.round(removedBytes / 1024 / 1024)} MB`,
  );

  // 4. 写新 asar 文件
  // asar 二进制格式（基于 @electron/asar 的 Pickle 序列化）：
  //   sizePickle (8 字节): payload size=4, payload=headerBuf.length
  //   headerPickle (8+jsonPaddedSize 字节):
  //     payload size = 4 + jsonPaddedSize（writeString 写入 4 字节长度 + alignInt(jsonLen,4) 字节数据）
  //     字符串长度 = jsonLen（未对齐的实际长度）
  //     JSON 数据 + 0 填充对齐到 4 字节
  const tmpPath = asarPath + ".tmp";
  const bakPath = asarPath + ".bak";
  const newJson = JSON.stringify(header);
  const newJsonBuf = Buffer.from(newJson, "utf8");
  const jsonPaddedSize = Math.ceil(newJsonBuf.length / 4) * 4;
  const headerBufLength = 4 + 4 + jsonPaddedSize; // headerPickle 缓冲区总长 = payload size 字段 + payload
  const headerLen = 4 + 4 + headerBufLength; // asar 头总长 = sizePickle(8) + headerPickle

  const headerPickle = Buffer.alloc(headerLen);
  headerPickle.writeUInt32LE(4, 0); // sizePickle payload size = 4
  headerPickle.writeUInt32LE(headerBufLength, 4); // sizePickle payload = headerBuf.length
  headerPickle.writeUInt32LE(4 + jsonPaddedSize, 8); // headerPickle payload size（之前误写为 4，导致读取时 endIndex 不足）
  headerPickle.writeUInt32LE(newJsonBuf.length, 12); // 字符串长度（未对齐）
  newJsonBuf.copy(headerPickle, 16);

  // v3.4.10 加固：try/finally 确保 fd 关闭；写入失败时清理 tmpPath（原 asar 未被触碰）
  const newFd = await open(tmpPath, "w");
  try {
    await newFd.write(headerPickle, 0, headerLen, 0);

    // 5. 按新 offset 复制文件数据
    const oldFd = await open(asarPath, "r");
    try {
      let writePosition = headerLen;
      const COPY_BUF_SIZE = 4 * 1024 * 1024; // 4MB buffer
      const copyBuf = Buffer.alloc(COPY_BUF_SIZE);

      for (const file of filesToKeep) {
        const fileDataOffset = dataOffset + file.offset;
        let remaining = file.size;
        let readPos = fileDataOffset;
        while (remaining > 0) {
          const toRead = Math.min(remaining, COPY_BUF_SIZE);
          await oldFd.read(copyBuf, 0, toRead, readPos);
          await newFd.write(copyBuf, 0, toRead, writePosition);
          readPos += toRead;
          writePosition += toRead;
          remaining -= toRead;
        }
        // 4 字节对齐 padding
        const padding = (4 - (file.size % 4)) % 4;
        if (padding > 0) {
          const padBuf = Buffer.alloc(padding, 0);
          await newFd.write(padBuf, 0, padding, writePosition);
          writePosition += padding;
        }
      }
      await newFd.sync();
    } finally {
      await newFd.close();
      await oldFd.close();
    }
  } catch (err) {
    // 写入失败：清理 tmpPath，原 asar 未被触碰，应用仍可正常启动
    try {
      await rm(tmpPath, { force: true });
    } catch {}
    throw err;
  } finally {
    await fd.close();
  }

  // 6. 原子替换：backup asarPath → .bak，rename tmp → asarPath，rm .bak
  // 任一步失败都可从 .bak 还原，避免 rm 后 rename 失败导致 asar 丢失
  await rm(bakPath, { force: true });
  await rename(asarPath, bakPath);
  try {
    await rename(tmpPath, asarPath);
  } catch (err) {
    try {
      await rename(bakPath, asarPath);
    } catch (restoreErr) {
      console.error("[after-pack] asar 还原失败，原文件在 .bak:", restoreErr);
    }
    try {
      await rm(tmpPath, { force: true });
    } catch {}
    throw err;
  }
  await rm(bakPath, { force: true });

  const newStat = await stat(asarPath);
  const sizeMB = Math.round(newStat.size / 1024 / 1024);
  const sizeGB = (newStat.size / 1024 / 1024 / 1024).toFixed(2);
  console.log(`[after-pack] asar 过滤完成: ${sizeMB} MB (${sizeGB} GB)`);
};

/** 还原 beforePack 暂存的大目录 */
const restoreStashedDirs = async () => {
  const stashBase = join(process.cwd(), "..", ".soto-build-stash");
  if (!existsSync(stashBase)) {
    return;
  }

  // 找最新的构建子目录（按时间戳命名）
  let buildDirs = [];
  try {
    buildDirs = await readdir(stashBase);
  } catch {
    return;
  }

  for (const buildDir of buildDirs) {
    const buildStashPath = join(stashBase, buildDir);
    const manifestPath = join(buildStashPath, "manifest.json");
    if (!existsSync(manifestPath)) {
      continue;
    }

    try {
      const manifestRaw = await readFile(manifestPath, "utf8");
      const manifest = JSON.parse(manifestRaw);

      for (const entry of manifest) {
        if (!existsSync(entry.stashPath)) {
          console.warn(`[after-pack] stash 中找不到 ${entry.name}，跳过`);
          continue;
        }
        if (existsSync(entry.originalPath)) {
          // 原位置已有同名目录（构建过程中重新生成），删除 stash 中的旧版本
          console.log(`[after-pack] ${entry.name} 原位置已存在，丢弃 stash 副本`);
          await rm(entry.stashPath, { recursive: true, force: true });
        } else {
          console.log(`[after-pack] 还原 ${entry.name} ← ${entry.stashPath}`);
          await rename(entry.stashPath, entry.originalPath);
        }
      }

      // 清理已处理的构建暂存目录
      await rm(buildStashPath, { recursive: true, force: true });
      console.log(`[after-pack] 已清理暂存目录 ${buildDir}`);
    } catch (err) {
      console.error(`[after-pack] 还原 ${buildDir} 失败:`, err);
    }
  }
};

/** 打包后清理多余的 Chromium locale 文件 + 过滤 asar */
const afterPack = async (context) => {
  const localeDir = join(
    context.appOutDir,
    context.packager.platform.name === "mac"
      ? `${context.packager.appInfo.productFilename}.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources`
      : "locales",
  );
  try {
    const files = await readdir(localeDir);
    await Promise.all(
      files
        .filter((f) => f.endsWith(".pak") && !keepLocales.has(f))
        .map((f) => unlink(join(localeDir, f))),
    );
  } catch {}

  // v3.4.10：过滤 asar，移除 electron-builder 误打的项目文件
  // 用 try/finally 确保即使 asar 过滤失败也还原暂存目录，避免目录丢失
  try {
    // mac 上 Resources 是大写，win/linux 是小写 resources；两种都试
    const candidates = [
      join(context.appOutDir, "resources", "app.asar"),
      join(context.appOutDir, "Resources", "app.asar"),
    ];
    let asarPath = null;
    for (const p of candidates) {
      if (existsSync(p)) {
        asarPath = p;
        break;
      }
    }
    if (asarPath) {
      await filterAsar(asarPath);
    } else {
      console.warn(
        `[after-pack] 未找到 app.asar (尝试过: ${candidates.join(", ")})，跳过过滤`,
      );
    }
  } catch (err) {
    console.error("[after-pack] asar 过滤失败:", err);
    throw err;
  } finally {
    await restoreStashedDirs();
  }
};

export default afterPack;
