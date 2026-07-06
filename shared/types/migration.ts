/**
 * SPlayer-Next → Soto Player-Community 数据迁移 API
 */

/** 迁移结果 */
export interface MigrationResult {
  /** 是否成功 */
  ok: boolean;
  /** 已迁移的子目录列表 */
  migrated: string[];
  /** 失败时的错误信息 */
  error?: string;
}

/** 数据迁移 API */
export interface MigrationApi {
  /** 检测旧 SPlayer-Next 用户数据是否存在 */
  hasLegacyData: () => Promise<boolean>;
  /** 执行迁移：把旧数据复制到当前位置（覆盖） */
  perform: () => Promise<MigrationResult>;
}
