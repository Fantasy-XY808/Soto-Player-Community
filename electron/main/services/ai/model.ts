/**
 * AI 模型配置服务
 *
 * 持久化用户配置的 AI 模型（OpenAI 兼容 / Anthropic），API Key 通过 Electron
 * safeStorage 加密后写入磁盘，永不返回明文。
 *
 * 配置文件路径：{configDir}/ai-models.json
 * 加密强度依赖系统钥匙串（macOS Keychain / Windows DPAPI / Linux libsecret）。
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { configDir } from "@main/utils/paths";
import { aiLog } from "@main/utils/logger";
import type {
  AiModelConfig,
  AiModelProtocol,
  AiModelSaveInput,
  AiModelState,
} from "@shared/types/settings";

/** 持久化文件路径 */
const STORAGE_FILE = path.join(configDir, "ai-models.json");

/** 持久化模型结构（包含加密后的 API Key） */
interface PersistedAiModel {
  id: string;
  name: string;
  protocol: AiModelProtocol;
  baseUrl: string;
  model: string;
  /** safeStorage.encryptString 加密后的 base64 字符串 */
  encryptedApiKey: string;
}

interface PersistedAiModelState {
  models: PersistedAiModel[];
  activeModelId: string | null;
}

/** 空状态 */
const emptyState = (): PersistedAiModelState => ({ models: [], activeModelId: null });

/**
 * 读取持久化状态
 *
 * 文件不存在 / 解析失败时返回空状态；activeModelId 失效（指向不存在的模型）时置 null。
 */
const readPersisted = (): PersistedAiModelState => {
  try {
    const raw = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")) as PersistedAiModelState;
    if (!Array.isArray(raw?.models)) return emptyState();
    const activeModelId = raw.models.some((model) => model.id === raw.activeModelId)
      ? raw.activeModelId
      : null;
    return { models: raw.models, activeModelId };
  } catch {
    return emptyState();
  }
};

/** 原子写入持久化状态 */
const writePersisted = (state: PersistedAiModelState): void => {
  try {
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    atomicWriteSync(STORAGE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    aiLog.error("写入 AI 模型配置失败:", error);
    throw new Error("AI 模型配置保存失败");
  }
};

/**
 * 使用 safeStorage 加密 API Key
 *
 * 系统不支持加密存储时直接抛错，避免明文落盘。
 */
const encryptApiKey = (apiKey: string): string => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统安全存储不可用，无法保存 API Key");
  }
  return safeStorage.encryptString(apiKey).toString("base64");
};

/**
 * 解密 API Key（仅在主进程内调用，用于实际请求时取明文）
 *
 * 解密失败（凭证损坏 / 系统迁移）时返回空字符串，让上层重新提示用户输入。
 */
export const decryptApiKey = (id: string): string => {
  const state = readPersisted();
  const model = state.models.find((item) => item.id === id);
  if (!model?.encryptedApiKey) return "";
  if (!safeStorage.isEncryptionAvailable()) return "";
  try {
    return safeStorage.decryptString(Buffer.from(model.encryptedApiKey, "base64"));
  } catch (error) {
    aiLog.warn(`解密 API Key 失败 (model=${id}):`, error);
    return "";
  }
};

/** 转换为对外暴露的状态（不含密钥明文，仅含 hasApiKey 标记） */
const toPublicState = (state: PersistedAiModelState): AiModelState => ({
  activeModelId: state.activeModelId,
  models: state.models.map<AiModelConfig>((model) => ({
    id: model.id,
    name: model.name,
    protocol: model.protocol,
    baseUrl: model.baseUrl,
    model: model.model,
    hasApiKey: Boolean(model.encryptedApiKey),
  })),
});

/**
 * 校验并规范化输入字段
 *
 * - 去除首尾空白；baseUrl 去除尾部斜杠
 * - 协议必须为 openai-compatible / anthropic
 * - baseUrl 必须为 http(s)
 */
const normalizeInput = (
  input: AiModelSaveInput,
): Omit<AiModelSaveInput, "id" | "apiKey"> => {
  const name = input.name?.trim();
  const baseUrl = input.baseUrl?.trim().replace(/\/+$/, "");
  const model = input.model?.trim();
  if (!name || !model || !/^https?:\/\//i.test(baseUrl)) {
    throw new Error("请填写有效的模型名称、API 地址和模型 ID");
  }
  if (input.protocol !== "openai-compatible" && input.protocol !== "anthropic") {
    throw new Error("不支持的 AI 模型协议");
  }
  return { name, protocol: input.protocol, baseUrl, model };
};

/**
 * 获取 AI 模型配置
 * @returns 不包含密钥明文的模型配置
 */
export const listAiModels = (): AiModelState => toPublicState(readPersisted());

/**
 * 保存 AI 模型配置（新增或编辑）
 *
 * 编辑时若未提供 apiKey 则沿用已加密的旧密钥。
 * @param input - 模型配置输入
 * @returns 保存后的模型配置状态
 */
export const saveAiModel = (input: AiModelSaveInput): AiModelState => {
  const state = readPersisted();
  const normalized = normalizeInput(input);
  const existing = input.id ? state.models.find((item) => item.id === input.id) : undefined;
  if (input.id && !existing) throw new Error("AI 模型配置不存在");

  // 提供新 apiKey 时加密；否则沿用旧密钥；都没有则报错
  const encryptedApiKey = input.apiKey?.trim()
    ? encryptApiKey(input.apiKey.trim())
    : (existing?.encryptedApiKey ?? "");
  if (!encryptedApiKey) throw new Error("请填写 API Key");

  const saved: PersistedAiModel = {
    id: existing?.id ?? randomUUID(),
    ...normalized,
    encryptedApiKey,
  };
  if (existing) state.models.splice(state.models.indexOf(existing), 1, saved);
  else state.models.push(saved);
  // 首次添加时自动设为激活
  if (!state.activeModelId) state.activeModelId = saved.id;
  writePersisted(state);
  return toPublicState(state);
};

/**
 * 删除 AI 模型配置
 * @param id - 本地配置 ID
 * @returns 删除后的模型配置状态
 */
export const removeAiModel = (id: string): AiModelState => {
  const state = readPersisted();
  state.models = state.models.filter((model) => model.id !== id);
  if (state.activeModelId === id) state.activeModelId = null;
  writePersisted(state);
  return toPublicState(state);
};

/**
 * 设置当前使用的 AI 模型
 * @param id - 本地配置 ID，传入 null 表示不启用模型
 * @returns 更新后的模型配置状态
 */
export const setActiveAiModel = (id: string | null): AiModelState => {
  const state = readPersisted();
  if (id !== null && !state.models.some((model) => model.id === id)) {
    throw new Error("AI 模型配置不存在");
  }
  state.activeModelId = id;
  writePersisted(state);
  return toPublicState(state);
};
