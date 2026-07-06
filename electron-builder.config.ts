import type { Configuration } from "electron-builder";

const config: Configuration = {
  appId: "top.fantasy-xy808.soto-player-community",
  productName: "Soto Player-Community",
  copyright: "Copyright © 2025 imsyy · 2026 Soto",
  directories: { buildResources: "public" },
  // afterPack: "./scripts/after-pack.ts",
  compression: "maximum",
  files: [
    "public/**",
    "out/**",
    "!**/.vscode/*",
    "!src/**",
    "!native/**",
    "!scripts/**",
    "!electron/**",
    "!shared/**",
    "!electron.vite.config.{js,ts,mjs,cjs}",
    "!electron-builder.config.{js,ts,mjs,cjs}",
    "!uno.config.{js,ts,mjs,cjs}",
    "!{.eslintcache,eslint.config.mjs,auto-eslint.mjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}",
    "!{components.d.ts,auto-imports.d.ts}",
    "!{.env,.env.*,.npmrc,pnpm-lock.yaml}",
    "!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}",
    "!**/*.{d.ts,map,md}",
    "!**/{CHANGELOG,LICENSE,license,README,readme}*",
  ],
  // 保留的语言
  electronLanguages: ["zh-CN", "en-US"],
  asarUnpack: ["public/**"],
  extraResources: [
    {
      from: "native/audio-engine",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/media-ctrl",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/taskbar-lyric",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/taskbar-thumbnail",
      to: "native",
      filter: ["*.node"],
    },
    // EasyTier 内嵌二进制（一起听 P2P 内网穿透）
    // 平台对应目录：win-x64 / win-arm64 / linux-x64 / linux-arm64 / mac-x64 / mac-arm64
    // electron-builder 会在对应平台构建时按 arch 选择目录
    {
      from: "native/easytier/${os}-${arch}",
      to: "native/easytier",
      filter: ["**/*"],
    },
  ],
  win: {
    executableName: "Soto-Player-Community",
    icon: "public/icons/logo.ico",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    forceCodeSigning: false,
    target: ["nsis", "portable"],
    protocols: [{ name: "Orpheus Protocol", schemes: ["orpheus"] }],
    // --no-tun 模式下 EasyTier 不创建 WinTUN 虚拟网卡，应用无需管理员权限
    // 强制 requireAdministrator 会在 UAC 关闭/标准账户下导致启动失败，与无 TUN 模式矛盾
    // asInvoker：以当前用户权限启动，避免无谓的 UAC 弹窗，提升首次启动成功率
    requestedExecutionLevel: "asInvoker",
  },
  nsis: {
    oneClick: false,
    guid: "top.imsyy.soto-player-community",
    installerIcon: "public/icons/favicon.ico",
    uninstallerIcon: "public/icons/favicon.ico",
    artifactName: "${productName}-${version}-${arch}-setup.${ext}",
    shortcutName: "Soto Player-Community",
    uninstallDisplayName: "Soto Player-Community",
    createDesktopShortcut: "always",
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    license: "build/license.txt",
  },
  portable: {
    artifactName: "${productName}-${version}-${arch}-portable.${ext}",
  },
  mac: {
    executableName: "Soto-Player-Community",
    icon: "public/icons/icon.icns",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    identity: null,
    hardenedRuntime: false,
    notarize: false,
    darkModeSupport: true,
    category: "public.app-category.music",
    entitlementsInherit: "public/entitlements.mac.plist",
    extendInfo: {
      NSCameraUsageDescription: "Application requests access to the device's camera.",
      NSMicrophoneUsageDescription: "Application requests access to the device's microphone.",
      NSDocumentsFolderUsageDescription:
        "Application requests access to the user's Documents folder.",
      NSDownloadsFolderUsageDescription:
        "Application requests access to the user's Downloads folder.",
      CFBundleURLTypes: [{ CFBundleURLName: "Orpheus Protocol", CFBundleURLSchemes: ["orpheus"] }],
    },
    target: ["dmg", "zip"],
  },
  dmg: {
    artifactName: "${productName}-${version}-${arch}.${ext}",
  },
  linux: {
    executableName: "soto-player-community",
    icon: "public/icons/favicon-512x512.png",
    artifactName: "${name}-${version}-${arch}.${ext}",
    maintainer: "imsyy.top",
    category: "Audio;Music;AudioVideo;",
    target: ["AppImage", "deb", "rpm", "tar.gz"],
    syncDesktopName: true,
    desktop: { entry: { MimeType: "x-scheme-handler/orpheus;" } },
  },
  appImage: {
    artifactName: "${name}-${version}-${arch}.${ext}",
  },
  npmRebuild: false,
  electronDownload: {
    mirror: "https://npmmirror.com/mirrors/electron/",
  },
  publish: {
    provider: "github",
    owner: "Fantasy-XY808",
    repo: "Soto-Player-Community",
  },
};

export default config;