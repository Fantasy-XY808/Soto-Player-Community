/**
 * Tidal 模块函数签名
 * 入参来自 IPC 非受控数据，模块内部解构即可
 */

export type TidalParams = Record<string, unknown>;

export type TidalModule = (params: TidalParams) => Promise<unknown>;
