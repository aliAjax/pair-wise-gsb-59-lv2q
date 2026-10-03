import { auditEntityId, newBatchId } from "./ids";
import {
  OperationValidationError,
  operationHandlers,
  targetRevision,
} from "./operations";
import type {
  AuditBatch,
  BatchOperationType,
  ReviewDatabase,
  ReviewRole,
} from "./types";

export interface BatchStore {
  transaction<T>(
    work: (database: ReviewDatabase, checkpoint: () => void) => T,
  ): T;
}

export interface RunBatchRequest {
  operation: BatchOperationType;
  actor: string;
  role?: ReviewRole;
  responseId?: string;
  batchId?: string;
  expectedRevision?: number;
  payload: Record<string, unknown>;
  startupReplay?: boolean;
}

interface LatestChange {
  latestBy?: string;
  latestAt?: string;
  latestDetail?: string;
}

export type RunBatchResult =
  | {
      outcome: "applied";
      batch: AuditBatch;
      entityType: "opinion" | "clarification" | "version";
      entityId: string;
      auditId: string;
    }
  | {
      outcome: "recovered";
      batch: AuditBatch;
      entityType: "opinion" | "clarification" | "version";
      entityId: string;
      auditId: string;
    }
  | {
      outcome: "duplicate";
      batch: AuditBatch;
      entityType: "opinion" | "clarification" | "version";
      entityId: string;
      auditId: string;
    }
  | {
      outcome: "aborted";
      batchId: string;
      message: string;
    }
  | ({
      outcome: "conflict";
      batchId: string;
      expectedRevision: number;
      currentRevision: number;
      responseId?: string;
      message: string;
    } & LatestChange)
  | {
      outcome: "quarantined";
      batchId: string;
      responseId?: string;
      issueId?: string;
      message: string;
    }
  | {
      outcome: "validation_failed";
      batchId: string;
      message: string;
    };

const nextBatchRevision = (database: ReviewDatabase): number =>
  database.batches.reduce(
    (maximum, batch) => Math.max(maximum, batch.revision),
    0,
  ) + 1;

const createBatchAudit = (
  database: ReviewDatabase,
  batch: AuditBatch,
  descriptor: { action: string; entity: string; detail: string },
  auditId: string,
): void => {
  database.auditLogs.unshift({
    id: auditId,
    at: batch.committedAt ?? new Date().toISOString(),
    actor: batch.actor,
    action: descriptor.action,
    entity: descriptor.entity,
    detail: descriptor.detail,
    batchId: batch.id,
    opSeq: batch.opSeq,
    entityRefId: descriptor.entity,
  });
};

const linkAudit = (
  database: ReviewDatabase,
  batch: AuditBatch,
  entityType: "opinion" | "clarification" | "version",
  entityId: string,
  auditId: string,
): void => {
  if (entityType === "opinion") {
    database.responses.forEach((response) => {
      const opinion = response.reviews.find((item) => item.id === entityId);
      if (opinion) {
        opinion.auditId = auditId;
        opinion.batchId = batch.id;
        opinion.opSeq = batch.opSeq;
      }
    });
  } else if (entityType === "clarification") {
    database.responses.forEach((response) => {
      const clarification = response.clarifications.find(
        (item) => item.id === entityId,
      );
      if (clarification) {
        if (batch.operation === "respond_clarification") {
          clarification.responseAuditId = auditId;
        } else {
          clarification.requestAuditId = auditId;
        }
      }
    });
  } else {
    const version = database.versions.find((item) => item.id === entityId);
    if (version) {
      version.auditId = auditId;
    }
  }
};

const bumpRevision = (
  database: ReviewDatabase,
  operation: BatchOperationType,
  responseId?: string,
): void => {
  if (operation === "finalize_version") {
    database.globalRevision += 1;
    return;
  }
  if (responseId) {
    const response = database.responses.find(
      (item) => item.id === responseId,
    );
    if (response) {
      response.revision += 1;
    }
  }
};

const findEntity = (
  database: ReviewDatabase,
  entityType: "opinion" | "clarification" | "version",
  entityId: string,
): { exists: boolean; responseId?: string } => {
  if (entityType === "opinion") {
    const response = database.responses.find((item) =>
      item.reviews.some((review) => review.id === entityId),
    );
    return { exists: Boolean(response), responseId: response?.id };
  }
  if (entityType === "clarification") {
    const response = database.responses.find((item) =>
      item.clarifications.some((itemx) => itemx.id === entityId),
    );
    return { exists: Boolean(response), responseId: response?.id };
  }
  return {
    exists: database.versions.some((version) => version.id === entityId),
  };
};

const describeLatestChange = (
  database: ReviewDatabase,
  responseId?: string,
): LatestChange => {
  if (!responseId) {
    const version = database.versions[0];
    return version
      ? {
          latestBy: version.createdBy,
          latestAt: version.createdAt,
          latestDetail: `${version.version} ${version.label}`,
        }
      : {};
  }
  const response = database.responses.find((item) => item.id === responseId);
  if (!response) {
    return {};
  }
  const latestOpinion = response.reviews[response.reviews.length - 1];
  const latestClarification =
    response.clarifications[response.clarifications.length - 1];
  const opinionTime = latestOpinion
    ? Date.parse(latestOpinion.createdAt)
    : 0;
  const clarificationTime = latestClarification
    ? Math.max(
        Date.parse(latestClarification.requestedAt),
        latestClarification.respondedAt
          ? Date.parse(latestClarification.respondedAt)
          : 0,
      )
    : 0;
  if (opinionTime >= clarificationTime && latestOpinion) {
    return {
      latestBy: latestOpinion.reviewer,
      latestAt: latestOpinion.createdAt,
      latestDetail: `判定为 ${latestOpinion.decision}，评分 ${latestOpinion.score}`,
    };
  }
  if (latestClarification) {
    return {
      latestBy: latestClarification.supplierResponse ? "供应商" : "采购人员",
      latestAt: latestClarification.respondedAt ?? latestClarification.requestedAt,
      latestDetail: `第 ${latestClarification.round} 轮澄清${
        latestClarification.supplierResponse ? "已回复" : "已发起"
      }`,
    };
  }
  return {};
};

const conflictResult = (
  batchId: string,
  batch: AuditBatch | undefined,
  database: ReviewDatabase,
  expectedRevision: number,
  responseId?: string,
): RunBatchResult => {
  const { current } = targetRevision(
    database,
    batch?.operation ?? "submit_assessment",
    responseId,
  );
  return {
    outcome: "conflict",
    batchId,
    expectedRevision,
    currentRevision: current,
    responseId,
    message:
      "该响应已被另一个窗口修改，您的输入已保留，请查看对方改动后基于最新版本重试。",
    ...describeLatestChange(database, responseId),
  };
};

/**
 * 以可恢复审计批次执行关键操作：
 * - prepared 先落盘（崩溃后可重放），业务数据 + 审计日志 + committed 同事务补齐；
 * - 相同 batchId 的重试返回原结果，不重复追加意见或日志；
 * - 修订号不匹配时不写入，返回并发冲突，由调用方提示并保留用户输入。
 */
export const runBatch = (
  store: BatchStore,
  request: RunBatchRequest,
): RunBatchResult =>
  store.transaction((database, checkpoint) => {
    const batchId = request.batchId || newBatchId();
    const existing = database.batches.find((batch) => batch.id === batchId);

    if (existing) {
      return resumeBatch(database, checkpoint, existing, request);
    }

    const expectedRevision = request.expectedRevision ?? 0;
    const { current, response } = targetRevision(
      database,
      request.operation,
      request.responseId,
    );

    if (
      request.operation !== "finalize_version" &&
      response?.quarantined
    ) {
      return {
        outcome: "quarantined",
        batchId,
        responseId: response.id,
        message:
          "该响应处于对账隔离状态，须由评审组长确认修复后才能继续操作。",
      };
    }
    if (request.operation === "finalize_version") {
      const quarantinedResponse = database.responses.find(
        (item) => item.quarantined,
      );
      if (quarantinedResponse) {
        return {
          outcome: "quarantined",
          batchId,
          responseId: quarantinedResponse.id,
          message: "存在对账隔离的供应商响应，组长确认修复前不能定稿。",
        };
      }
      const quarantinedVersion = database.versions.find(
        (item) => item.quarantined,
      );
      if (quarantinedVersion) {
        return {
          outcome: "quarantined",
          batchId,
          message: "存在对账隔离的评审版本，组长确认修复前不能定稿。",
        };
      }
    }

    if (expectedRevision !== 0 && current !== expectedRevision) {
      return conflictResult(
        batchId,
        undefined,
        database,
        expectedRevision,
        request.responseId,
      );
    }

    const now = new Date().toISOString();
    const batch: AuditBatch = {
      id: batchId,
      revision: nextBatchRevision(database),
      operation: request.operation,
      opSeq: 1,
      status: "prepared",
      createdAt: now,
      actor: request.actor,
      role: request.role,
      expectedRevision,
      responseId: request.responseId,
      payload: request.payload,
      replayCount: 0,
    };
    database.batches.unshift(batch);
    checkpoint();

    let applied: ReturnType<
      typeof operationHandlers[BatchOperationType]
    >;
    try {
      applied = operationHandlers[request.operation](database, batch);
    } catch (error) {
      batch.status = "aborted";
      batch.committedAt = new Date().toISOString();
      checkpoint();
      const message =
        error instanceof OperationValidationError
          ? error.message
          : "批次执行失败，已安全回滚为已撤销，请修正后重试。";
      return {
        outcome: "validation_failed",
        batchId,
        message,
      };
    }

    const auditId = auditEntityId(batch.id, batch.opSeq);
    createBatchAudit(database, batch, applied.audit, auditId);
    linkAudit(
      database,
      batch,
      applied.entityType,
      applied.entityId,
      auditId,
    );
    bumpRevision(database, request.operation, applied.responseId);
    batch.status = "committed";
    batch.committedAt = new Date().toISOString();
    batch.resultEntityId = applied.entityId;
    batch.resultEntityType = applied.entityType;
    checkpoint();

    return {
      outcome: "applied",
      batch,
      entityType: applied.entityType,
      entityId: applied.entityId,
      auditId,
    };
  });

const resumeBatch = (
  database: ReviewDatabase,
  checkpoint: () => void,
  batch: AuditBatch,
  request: RunBatchRequest,
): RunBatchResult => {
  if (batch.status === "aborted") {
    return {
      outcome: "aborted",
      batchId: batch.id,
      message: "该批次已被撤销，请重新发起操作。",
    };
  }

  const auditId = auditEntityId(batch.id, batch.opSeq);
  const entityType =
    batch.resultEntityType ??
    (batch.operation === "finalize_version"
      ? "version"
      : "clarification");

  if (batch.status === "committed") {
    const entityId = batch.resultEntityId;
    if (entityId) {
      const located = findEntity(database, entityType, entityId);
      if (!located.exists) {
        return {
          outcome: "quarantined",
          batchId: batch.id,
          responseId: located.responseId ?? batch.responseId,
          message: `批次 ${batch.id} 已提交但业务实体缺失，需隔离并由组长确认修复。`,
        };
      }
    }
    if (!database.auditLogs.some((log) => log.id === auditId)) {
      // 日志缺失但业务数据存在：补齐日志，保证意见与审计成对。
      const descriptor = fallbackDescriptor(batch);
      createBatchAudit(database, batch, descriptor, auditId);
      if (entityId) {
        linkAudit(database, batch, entityType, entityId, auditId);
      }
      checkpoint();
    }
    return entityId
      ? {
          outcome: "duplicate",
          batch,
          entityType,
          entityId,
          auditId,
        }
      : {
          outcome: "quarantined",
          batchId: batch.id,
          responseId: batch.responseId,
          message: `批次 ${batch.id} 缺少结果编号，无法返回原结果。`,
        };
  }

  // prepared：崩溃恢复或同一批次的在途重试。
  if (request.startupReplay) {
    batch.replayCount = (batch.replayCount ?? 0) + 1;
    batch.lastReplayAt = new Date().toISOString();
  }

  const entityIdGuess =
    batch.operation === "finalize_version"
      ? `VER-${batch.id}`
      : batch.operation === "submit_assessment"
        ? `OP-${batch.id}-${batch.opSeq}`
        : `CL-${batch.id}-${batch.opSeq}`;
  const guessedType: "opinion" | "clarification" | "version" =
    batch.operation === "finalize_version"
      ? "version"
      : batch.operation === "submit_assessment"
        ? "opinion"
        : "clarification";
  const located = findEntity(database, guessedType, entityIdGuess);

  if (located.exists) {
    // 业务已落盘但提交标记未更新：只补齐日志与提交标记。
    if (!database.auditLogs.some((log) => log.id === auditId)) {
      createBatchAudit(database, batch, fallbackDescriptor(batch), auditId);
      linkAudit(database, batch, guessedType, entityIdGuess, auditId);
    }
    batch.status = "committed";
    batch.committedAt = new Date().toISOString();
    batch.resultEntityId = entityIdGuess;
    batch.resultEntityType = guessedType;
    checkpoint();
    return {
      outcome: "recovered",
      batch,
      entityType: guessedType,
      entityId: entityIdGuess,
      auditId,
    };
  }

  const { current } = targetRevision(
    database,
    batch.operation,
    batch.responseId,
  );
  if (current !== batch.expectedRevision) {
    // 并发窗口：对方改动已经生效，保留现场，交对账隔离并由组长裁决。
    return conflictResult(
      batch.id,
      batch,
      database,
      batch.expectedRevision,
      batch.responseId,
    );
  }

  let applied: ReturnType<OperationHandlerFn>;
  try {
    applied = operationHandlers[batch.operation](database, batch);
  } catch (error) {
    const message =
      error instanceof OperationValidationError
        ? error.message
        : "未完成批次重放失败。";
    return {
      outcome: "validation_failed",
      batchId: batch.id,
      message,
    };
  }
  createBatchAudit(database, batch, applied.audit, auditId);
  linkAudit(
    database,
    batch,
    applied.entityType,
    applied.entityId,
    auditId,
  );
  bumpRevision(database, batch.operation, applied.responseId);
  batch.status = "committed";
  batch.committedAt = new Date().toISOString();
  batch.resultEntityId = applied.entityId;
  batch.resultEntityType = applied.entityType;
  checkpoint();
  return {
    outcome: "recovered",
    batch,
    entityType: applied.entityType,
    entityId: applied.entityId,
    auditId,
  };
};

type OperationHandlerFn =
  (typeof operationHandlers)[BatchOperationType];

const fallbackDescriptor = (
  batch: AuditBatch,
): { action: string; entity: string; detail: string } => {
  const actionByOperation: Record<BatchOperationType, string> = {
    submit_assessment: "提交独立意见",
    request_clarification: "发起澄清",
    respond_clarification: "回复澄清",
    finalize_version: "汇总签字定稿",
    resolve_quarantine: "组长确认修复",
  };
  return {
    action: actionByOperation[batch.operation],
    entity: batch.responseId ?? `VER-${batch.id}`,
    detail: `批次 ${batch.id} #${batch.opSeq} 恢复时补齐的审计日志。`,
  };
};
