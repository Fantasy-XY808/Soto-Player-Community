/**
 * QM 模块函数签名
 * 入参来自 IPC 非受控数据；module 内部直接解构即可，
 * 值类型为 unknown，但 qmRequest 的 param 也是 `Record<string, unknown>`，直接透传不需 cast
 */

export type QMParams = Record<string, unknown>;

export type QMModule = (params: QMParams) => Promise<unknown>;
