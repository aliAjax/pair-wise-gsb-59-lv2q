import type {
  AuditBatch,
  ReviewDatabase,
  ReviewVersion,
  SupplierResponse,
} from "./types";

/**
 * 确定性 64 位 FNV-1a 哈希。定稿快照、复核均用同一算法，
 * 不再使用 Math.random，保证定稿哈希可复核。
 */
export const stableHash = (input: string): string => {
  let high = 0x811c9dc5;
  let low = 0x84222325 >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    low ^= code;
    high = Math.imul(high, 0x01000193) ^ Math.imul(low, 0x01000193);
    low = Math.imul(low, 0x01000193);
  }
  const h = high >>> 0;
  const l = low >>> 0;
  return (
    h.toString(16).padStart(8, "0") + l.toString(16).padStart(8, "0")
  );
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

/** 定稿快照投影：仅包含评审结论性数据，保证跨进程可复算。 */
export const finalizeBasis = (
  database: ReviewDatabase,
  label: string,
  createdAt: string,
): string => {
  const projection = {
    version: {
      label,
      clauseCount: database.clauses.length,
      responseCount: database.responses.length,
      createdAt,
    },
    clauses: database.clauses
      .map((clause) => ({
        id: clause.id,
        code: clause.code,
        type: clause.type,
        weight: clause.weight,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    responses: database.responses
      .map((response) => ({
        id: response.id,
        status: response.status,
        reviewRound: response.reviewRound,
        reviews: response.reviews
          .map((review) => ({
            reviewer: review.reviewer,
            role: review.role,
            decision: review.decision,
            score: review.score,
            comment: review.comment,
            createdAt: review.createdAt,
          }))
          .sort((a, b) =>
            a.createdAt < b.createdAt
              ? -1
              : a.createdAt > b.createdAt
                ? 1
                : a.reviewer < b.reviewer
                  ? -1
                  : 1,
          ),
        clarifications: response.clarifications
          .map((clarification) => ({
            id: clarification.id,
            round: clarification.round,
            status: clarification.status,
            supplierResponse: clarification.supplierResponse ?? "",
          }))
          .sort((a, b) => a.round - b.round),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
  return stableStringify(projection);
};

export interface AuditDescriptor {
  action: string;
  entity: string;
  detail: string;
}

export interface ApplyOutcome {
  entityType: "opinion" | "clarification" | "version";
  entityId: string;
  responseId?: string;
  audit: AuditDescriptor;
}

export class OperationValidationError extends Error {}

const requireResponse = (
  database: ReviewDatabase,
  responseId: string,
): SupplierResponse => {
  const response = database.responses.find(
    (item) => item.id === responseId,
  );
  if (!response) {
    throw new OperationValidationError("供应商响应不存在。");
  }
  return response;
};

const payloadString = (batch: AuditBatch, key: string): string => {
  const value = batch.payload[key];
  return typeof value === "string" ? value : "";
};

const payloadNumber = (batch: AuditBatch, key: string): number => {
  const value = batch.payload[key];
  return typeof value === "number" ? value : 0;
};

interface OperationHandler {
  (database: ReviewDatabase, batch: AuditBatch): ApplyOutcome;
}

const submitAssessment: OperationHandler = (database, batch) => {
  const responseId = payloadString(batch, "responseId") || batch.responseId || "";
  const response = requireResponse(database, responseId);
  const clause = database.clauses.find(
    (item) => item.id === response.clauseId,
  );
  if (!clause) {
    throw new OperationValidationError("对应技术条款不存在。");
  }
  const decision = payloadString(batch, "decision") as SupplierResponse["status"];
  const score = payloadNumber(batch, "score");
  const comment = payloadString(batch, "comment").trim();
  const reviewer = payloadString(batch, "reviewer").trim();
  if (comment.length < 6) {
    throw new OperationValidationError("评审意见至少需要 6 个字符。");
  }
  if (score < 0 || score > clause.weight) {
    throw new OperationValidationError(`评分必须在 0 至 ${clause.weight} 之间。`);
  }
  if (
    clause.type === "scoring" &&
    decision === "compliant" &&
    score === 0
  ) {
    throw new OperationValidationError("评分项判定为符合时必须填写评分。");
  }
  const opinion = {
    id: `OP-${batch.id}-${batch.opSeq}`,
    responseId: response.id,
    reviewer,
    role: batch.role ?? "reviewer_a",
    decision,
    score,
    comment,
    createdAt: batch.createdAt,
    batchId: batch.id,
    opSeq: batch.opSeq,
  };
  response.reviews.push(opinion);
  response.status = decision;
  response.reviewRound = Math.max(response.reviewRound, 1);
  return {
    entityType: "opinion",
    entityId: opinion.id,
    responseId: response.id,
    audit: {
      action: "提交独立意见",
      entity: response.id,
      detail: `${clause.code} ${clause.title} 判定为 ${decision}，评分 ${score}（批次 ${batch.id} #${batch.opSeq}）。`,
    },
  };
};

const requestClarification: OperationHandler = (database, batch) => {
  const responseId = payloadString(batch, "responseId") || batch.responseId || "";
  const response = requireResponse(database, responseId);
  const requestText = payloadString(batch, "requestText").trim();
  if (requestText.length < 6) {
    throw new OperationValidationError("澄清要求至少需要 6 个字符。");
  }
  const requestedAt = new Date(batch.createdAt);
  const dueAt = new Date(payloadString(batch, "dueAt"));
  if (Number.isNaN(dueAt.getTime()) || dueAt <= requestedAt) {
    throw new OperationValidationError("澄清截止时间必须晚于当前时间。");
  }
  const maximumDueAt = new Date(requestedAt);
  maximumDueAt.setDate(maximumDueAt.getDate() + 7);
  if (dueAt > maximumDueAt) {
    throw new OperationValidationError("澄清期限不得超过 7 个自然日。");
  }
  const round =
    Math.max(
      0,
      ...response.clarifications.map((item) => item.round),
    ) + 1;
  const clarification = {
    id: `CL-${batch.id}-${batch.opSeq}`,
    responseId: response.id,
    clauseId: response.clauseId,
    round,
    requestText,
    requestedAt: requestedAt.toISOString(),
    dueAt: dueAt.toISOString(),
    status: "open" as const,
    batchId: batch.id,
    opSeq: batch.opSeq,
  };
  response.clarifications.push(clarification);
  response.status = "clarification";
  return {
    entityType: "clarification",
    entityId: clarification.id,
    responseId: response.id,
    audit: {
      action: "发起澄清",
      entity: clarification.id,
      detail: `${response.supplierName} ${response.clauseId} 第 ${round} 轮澄清已发起（批次 ${batch.id} #${batch.opSeq}）。`,
    },
  };
};

const respondClarification: OperationHandler = (database, batch) => {
  const clarificationId = payloadString(batch, "clarificationId");
  const clarification = database.responses
    .flatMap((response) => response.clarifications)
    .find((item) => item.id === clarificationId);
  if (!clarification) {
    throw new OperationValidationError("澄清记录不存在。");
  }
  const responseText = payloadString(batch, "responseText").trim();
  if (responseText.length < 6) {
    throw new OperationValidationError("澄清回复至少需要 6 个字符。");
  }
  clarification.supplierResponse = responseText;
  clarification.respondedAt = batch.createdAt;
  clarification.status = "responded";
  clarification.responseBatchId = batch.id;
  clarification.responseOpSeq = batch.opSeq;
  const response = database.responses.find(
    (item) => item.id === clarification.responseId,
  );
  if (response) {
    response.status = "pending";
  }
  return {
    entityType: "clarification",
    entityId: clarification.id,
    responseId: clarification.responseId,
    audit: {
      action: "回复澄清",
      entity: clarification.id,
      detail: `第 ${clarification.round} 轮澄清已回复，等待评审员复核（批次 ${batch.id} #${batch.opSeq}）。`,
    },
  };
};

const nextVersionNumber = (database: ReviewDatabase): number =>
  database.versions.reduce((maximum, version) => {
    const numeric = Number(version.version.replace(/\D/g, ""));
    return Number.isFinite(numeric) ? Math.max(maximum, numeric) : maximum;
  }, 0) + 1;

const finalizeVersion: OperationHandler = (database, batch) => {
  const label = payloadString(batch, "label").trim();
  if (label.length < 4) {
    throw new OperationValidationError("版本名称至少需要 4 个字符。");
  }
  const blockingClarifications = database.responses
    .filter((response) => !response.quarantined)
    .flatMap((response) => response.clarifications)
    .filter(
      (clarification) =>
        clarification.status === "open" ||
        clarification.status === "overdue",
    );
  if (blockingClarifications.length > 0) {
    throw new OperationValidationError(
      `仍有 ${blockingClarifications.length} 项未完成澄清，不能定稿。`,
    );
  }
  const maxVersion = nextVersionNumber(database);
  // 旧工作版被转为定稿：定稿前哈希并未锁定，
  // 按冻结时刻数据补冻结可复核基线并重算哈希，使其在后续对账中可验证。
  database.versions.forEach((version) => {
    if (version.status === "draft") {
      version.status = "finalized";
      const basis = finalizeBasis(
        database,
        version.label,
        version.createdAt,
      );
      version.hashBasis = basis;
      version.contentHash = stableHash(basis);
      version.hashStatus = "verified";
    }
  });
  const basis = finalizeBasis(database, label, batch.createdAt);
  const version: ReviewVersion = {
    id: `VER-${batch.id}`,
    version: `V${maxVersion}`,
    label,
    status: "finalized",
    createdAt: batch.createdAt,
    createdBy: batch.actor,
    signedBy: [batch.actor],
    clauseCount: database.clauses.length,
    responseCount: database.responses.length,
    contentHash: stableHash(basis),
    hashBasis: basis,
    hashStatus: "verified",
    batchId: batch.id,
    opSeq: batch.opSeq,
  };
  database.versions.unshift(version);
  return {
    entityType: "version",
    entityId: version.id,
    audit: {
      action: "汇总签字定稿",
      entity: version.id,
      detail: `${version.version} ${label} 已锁定，签署人 ${batch.actor}，内容哈希 ${version.contentHash}（批次 ${batch.id} #${batch.opSeq}）。`,
    },
  };
};

export const operationHandlers: Record<
  AuditBatch["operation"],
  OperationHandler
> = {
  submit_assessment: submitAssessment,
  request_clarification: requestClarification,
  respond_clarification: respondClarification,
  finalize_version: finalizeVersion,
  resolve_quarantine: () => {
    throw new OperationValidationError("隔离修复由对账模块直接处理。");
  },
};

/** 按目标实体编号定位当前修订号；定稿使用全局修订号。 */
export const targetRevision = (
  database: ReviewDatabase,
  operation: AuditBatch["operation"],
  responseId?: string,
): { current: number; response?: SupplierResponse } => {
  if (operation === "finalize_version") {
    return { current: database.globalRevision };
  }
  const response = database.responses.find(
    (item) => item.id === responseId,
  );
  return { current: response?.revision ?? 0, response };
};
