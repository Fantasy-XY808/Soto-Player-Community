import { rename, mkdir, stat, rm, writeFile, readdir, readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

/**
 * v3.4.10：打包前把项目根目录的大目录临时移到项目外，避免被 electron-builder 打进 asar
 *
 * 背景：electron-builder 26 + pnpm 下 files 排除规则对 target/ 等目录不生效，
 * firstOrDefaultFilePatterns 硬编码的通配符会把 7GB 的 Rust target/ 全打进 asar。
 * afterPack 虽然能过滤，但 electron-builder 仍会先把 7GB 写进 asar 再被过滤，慢且费空间。
 *
 * 方案：beforePack 把这些目录移到项目外暂存目录，打包完成后 afterPack 再移回来。
 * 这样 electron-builder 根本看不到这些目录，asar 从源头就干净。
 *
 * 安全性：使用 manifest 记录转移的目录，afterPack 按清单还原。即使 afterPack 失败，
 * 用户也可从 stash 目录手动恢复（路径打印在日志里）。
 *
 * v3.4.10 加固：
 * - beforePack 开始时扫描 stashBase，还原上次构建中断残留的 stash（按 manifest 还原）
 * - buildId 加 process.pid 防同毫秒并发冲突
 * - Windows 上 target/ 被占用导致 EPERM/EBUSY 时明确提示关 dev server / rust-analyzer
 */

/** 项目根目录（electron-builder 的工作目录） */
const projectRoot = process.cwd();

/** 暂存目录（项目外，避免被通配符匹配） */
const stashDir = join(projectRoot, "..", ".soto-build-stash");

/** 需要临时移出的大目录列表 */
const dirsToStash = [
  "target",
  "target_bak",
  "参考项目",
  "参考项目_bak",
  ".rust-target",
];

/** 扫描并清理/还原上次构建中断残留的 stash 目录 */
const cleanupStaleStash = async () => {
  if (!existsSync(stashDir)) {
    return;
  }
  let buildDirs = [];
  try {
    buildDirs = await readdir(stashDir);
  } catch {
    return;
  }
  for (const buildDir of buildDirs) {
    const buildStashPath = join(stashDir, buildDir);
    const manifestPath = join(buildStashPath, "manifest.json");
    if (!existsSync(manifestPath)) {
      // 无 manifest：残留的空目录或异常 stash，直接清理
      console.warn(`[before-pack] 清理无 manifest 的残留 stash: ${buildDir}`);
      try {
        await rm(buildStashPath, { recursive: true, force: true });
      } catch {}
      continue;
    }
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      for (const entry of manifest) {
        if (!existsSync(entry.stashPath)) continue;
        if (existsSync(entry.originalPath)) {
          // 原位置已有同名目录（用户重新 clone 等），丢弃 stash 副本
          console.log(`[before-pack] ${entry.name} 原位置已存在，丢弃 stash 副本`);
          await rm(entry.stashPath, { recursive: true, force: true });
        } else {
          console.log(`[before-pack] 还原残留 stash: ${entry.name} ← ${entry.stashPath}`);
          await rename(entry.stashPath, entry.originalPath);
        }
      }
      await rm(buildStashPath, { recursive: true, force: true });
      console.log(`[before-pack] 清理残留 stash: ${buildDir}`);
    } catch (err) {
      console.error(`[before-pack] 处理残留 stash ${buildDir} 失败:`, err);
    }
  }
};

const beforePack = async (context) => {
  // 先清理上次构建中断残留的 stash（有 manifest 还原 / 无 manifest 直接 rm）
  await cleanupStaleStash();

  // 暂存目录用时间戳+pid 子目录，支持并发构建不冲突
  const buildId = `build-${Date.now()}-${process.pid}`;
  const buildStashDir = join(stashDir, buildId);

  await mkdir(buildStashDir, { recursive: true });

  const manifest = [];

  for (const dirName of dirsToStash) {
    const originalPath = join(projectRoot, dirName);
    if (!existsSync(originalPath)) {
      continue;
    }
    try {
      const st = await stat(originalPath);
      if (!st.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    const stashPath = join(buildStashDir, dirName);
    console.log(`[before-pack] 移出 ${dirName} → ${stashPath}`);
    try {
      await rename(originalPath, stashPath);
      manifest.push({ name: dirName, originalPath, stashPath });
    } catch (err) {
      // Windows 上 target/ 里的 .dll/.pdb 可能被 dev server / rust-analyzer / IDE 占用
      if (err.code === "EPERM" || err.code === "EBUSY" || err.code === "EACCES") {
        console.error(
          `[before-pack] 移出 ${dirName} 失败 (${err.code})：请关闭 dev server / rust-analyzer / IDE 后重试`,
        );
      } else {
        console.error(`[before-pack] 移出 ${dirName} 失败:`, err);
      }
      // 移出失败不阻塞构建，afterPack 仍能过滤（只是慢）
    }
  }

  // 写 manifest，afterPack 会读取并还原
  if (manifest.length > 0) {
    const manifestPath = join(buildStashDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    console.log(
      `[before-pack] 已暂存 ${manifest.length} 个目录，manifest: ${manifestPath}`,
    );
    console.log(`[before-pack] 若构建异常中断，可手动从 ${buildStashDir} 恢复`);
  } else {
    // 没有目录需要转移，清理空的暂存目录
    try {
      await rm(buildStashDir, { recursive: true, force: true });
    } catch {}
    console.log("[before-pack] 无需暂存目录");
  }
};

export default beforePack;
