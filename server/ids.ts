/** 业务实体 / 审计 / 批次编号生成器（无副作用，供各模块共享）。 */
export const newBatchId = (): string =>
  `BATCH-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const opinionEntityId = (batchId: string, opSeq: number): string =>
  `OP-${batchId}-${opSeq}`;

export const clarificationEntityId = (
  batchId: string,
  opSeq: number,
): string => `CL-${batchId}-${opSeq}`;

export const versionEntityId = (batchId: string): string =>
  `VER-${batchId}`;

export const auditEntityId = (batchId: string, opSeq: number): string =>
  `AUD-${batchId}-${opSeq}`;
