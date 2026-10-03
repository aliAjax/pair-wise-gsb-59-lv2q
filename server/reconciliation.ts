import { auditEntityId } from "./ids";
import { finalizeBasis, stableHash } from "./operations";
import type {
  AuditBatch,
  AuditLog,
  ReconciliationIssue,
  ReconciliationIssueKind,
  ReconciliationState,
  ReviewDatabase,
  ReviewRole,
  ReviewVersion,
} from "./types";

const TIME_TOLERANCE_MS = 10 * 60 * 1000;

interface IssueInput {
  kind: ReconciliationIssueKind;
  severity: ReconciliationIssue["severity"];
  entityType: ReconciliationIssue["entityType"];
  entityId: string;
  responseId?: string;
  message: string;
  detail?: string;
}

const issueId = (kind: string, entityId: string): string =>
  `ISS-${kind}-${entityId}`.replace(/[^A-Za-z0-9_-]/g, "_");

const sameTime = (a: string, b: string): boolean => {
  const timeA = Date.parse(a);
  const timeB = Date.parse(b);
  if (Number.isNaN(timeA) || Number.isNaN(timeB)) {
    return false;
  }
  return Math.abs(timeA - timeB) <= TIME_TOLERANCE_MS;
};

/**
 * 旧数据回填：缺少批次号的意见 / 澄清 / 版本，
 * 从现有审计日志中按对象、操作人、时间就近配对并补挂批次号。
 * 补不全的不强行配对，留给对账阶段进入待核。
 */
export const backfillLegacyBatches = (
  database: ReviewDatabase,
): { batches: number } => {
  let count = 0;

  const usedLogIds = new Set<string>(
    database.auditLogs
      .filter((log) => log.batchId)
      .map((log) => log.id),
  );

  const nextLegacySeq = (responseId: string): number =>
    database.batches.filter((batch) => batch.responseId === responseId).length +
    1;

  const makeLegacyBatch = (
    operation: AuditBatch["operation"],
    responseId: string | undefined,
    entityId: string,
    actor: string,
    createdAt: string,
  ): AuditBatch => {
    const batch: AuditBatch = {
      id: `LEG-${entityId}`,
      revision: 0,
      operation,
      opSeq: 1,
      status: "committed",
      createdAt,
      committedAt: createdAt,
      actor,
      expectedRevision: 0,
      responseId,
      payload: { backfilled: true, entityId },
      resultEntityId: entityId,
      resultEntityType:
        operation === "finalize_version"
          ? "version"
          : operation === "submit_assessment"
            ? "opinion"
            : "clarification",
      replayCount: 0,
    };
    database.batches.push(batch);
    count += 1;
    return batch;
  };

  const takeLog = (predicate: (log: AuditLog) => boolean): AuditLog | undefined =>
    database.auditLogs.find(
      (log) => !usedLogIds.has(log.id) && predicate(log),
    );

  for (const response of database.responses) {
    for (const opinion of response.reviews) {
      if (opinion.batchId) {
        if (opinion.auditId) {
          usedLogIds.add(opinion.auditId);
        }
        continue;
      }
      const log = takeLog(
        (candidate) =>
          candidate.action === "提交独立意见" &&
          candidate.entity === response.id &&
          candidate.actor === opinion.reviewer &&
          sameTime(candidate.at, opinion.createdAt),
      );
      if (!log) {
        continue;
      }
      const batch = makeLegacyBatch(
        "submit_assessment",
        response.id,
        opinion.id,
        opinion.reviewer,
        opinion.createdAt,
      );
      opinion.batchId = batch.id;
      opinion.opSeq = batch.opSeq;
      opinion.auditId = log.id;
      log.batchId = batch.id;
      log.opSeq = batch.opSeq;
      log.entityRefId = opinion.id;
      usedLogIds.add(log.id);
    }

    for (const clarification of response.clarifications) {
      if (!clarification.batchId) {
        const log = takeLog(
          (candidate) =>
            candidate.action === "发起澄清" &&
            (candidate.entity === clarification.id ||
              (candidate.entity === response.id &&
                sameTime(candidate.at, clarification.requestedAt))) &&
            sameTime(candidate.at, clarification.requestedAt),
        );
        if (log) {
          const batch = makeLegacyBatch(
            "request_clarification",
            response.id,
            clarification.id,
            log.actor,
            clarification.requestedAt,
          );
          clarification.batchId = batch.id;
          clarification.opSeq = batch.opSeq;
          clarification.requestAuditId = log.id;
          log.batchId = batch.id;
          log.opSeq = batch.opSeq;
          log.entityRefId = clarification.id;
          usedLogIds.add(log.id);
        }
      }
      if (!clarification.responseBatchId && clarification.supplierResponse) {
        const log = takeLog(
          (candidate) =>
            candidate.action === "回复澄清" &&
            (candidate.entity === clarification.id ||
              candidate.entity === response.id) &&
            clarification.respondedAt !== undefined &&
            sameTime(candidate.at, clarification.respondedAt),
        );
        if (log) {
          const batch = makeLegacyBatch(
            "respond_clarification",
            response.id,
            clarification.id,
            log.actor,
            clarification.respondedAt ?? clarification.requestedAt,
          );
          batch.resultEntityId = clarification.id;
          clarification.responseBatchId = batch.id;
          clarification.responseOpSeq = batch.opSeq;
          clarification.responseAuditId = log.id;
          log.batchId = batch.id;
          log.opSeq = batch.opSeq;
          log.entityRefId = clarification.id;
          usedLogIds.add(log.id);
        }
      }
    }
  }

  for (const version of database.versions) {
    if (version.batchId) {
      if (version.auditId) {
        usedLogIds.add(version.auditId);
      }
      continue;
    }
    const log = takeLog(
      (candidate) =>
        (candidate.action === "版本定稿" ||
          candidate.action === "汇总签字定稿") &&
        (candidate.entity === version.id ||
          candidate.detail.includes(version.version)) &&
        sameTime(candidate.at, version.createdAt),
    );
    if (!log || version.status !== "finalized") {
      continue;
    }
    const batch = makeLegacyBatch(
      "finalize_version",
      undefined,
      version.id,
      version.createdBy,
      version.createdAt,
    );
    version.batchId = batch.id;
    version.opSeq = batch.opSeq;
    version.auditId = log.id;
    log.batchId = batch.id;
    log.opSeq = batch.opSeq;
    log.entityRefId = version.id;
    usedLogIds.add(log.id);
  }

  return { batches: count };
};

const verifyVersionHash = (
  database: ReviewDatabase,
  version: ReviewVersion,
): "verified" | "missing" | "mismatch" => {
  if (version.status !== "finalized") {
    return "verified";
  }
  if (!version.hashBasis) {
    return "missing";
  }
  const expected = stableHash(version.hashBasis);
  if (expected !== version.contentHash) {
    return "mismatch";
  }
  // 再校验基线是否仍与当前评审数据一致（快照内容被改写可检出）。
  const currentBasis = finalizeBasis(
    database,
    version.label,
    version.createdAt,
  );
  return currentBasis === version.hashBasis ? "verified" : "mismatch";
};

export interface ReconcileStats {
  replayedBatches: number;
  backfilledBatches: number;
}

/** 与当前数据全量对账，输出统一对账结果（总览/条款/复核/导出共用）。 */
export const reconcileDatabase = (
  database: ReviewDatabase,
  stats: ReconcileStats,
  previous?: ReconciliationState,
): ReconciliationState => {
  const detectedAt = new Date().toISOString();
  const previousById = new Map(
    (previous?.issues ?? database.reconciliation?.issues ?? []).map(
      (issue) => [issue.id, issue],
    ),
  );
  const resolutionIds = new Set(
    (previous?.resolutions ?? database.reconciliation?.resolutions ?? []).map(
      (resolution) => resolution.issueId,
    ),
  );
  const collected: IssueInput[] = [];

  const addIssue = (input: IssueInput): void => {
    if (resolutionIds.has(issueId(input.kind, input.entityId))) {
      return;
    }
    collected.push(input);
  };

  // 重置既有隔离标记，根据本次结论重新标记。
  database.responses.forEach((response) => {
    response.quarantined = false;
    response.quarantineReason = undefined;
    response.issueIds = [];
  });
  database.versions.forEach((version) => {
    version.quarantined = false;
    version.quarantineReason = undefined;
    version.issueIds = [];
  });

  // 1. 未完成批次：重放失败 / 修订冲突 → 隔离相关响应。
  for (const batch of database.batches) {
    if (batch.status !== "prepared") {
      continue;
    }
    addIssue({
      kind: "unfinished_batch",
      severity: "quarantined",
      entityType: "batch",
      entityId: batch.id,
      responseId: batch.responseId,
      message: `批次 ${batch.id} 未完成提交，启动重放未能自动恢复，已隔离 ${batch.responseId ?? "全局版本"}。`,
      detail: `操作 ${batch.operation}，操作编号 #${batch.opSeq}，期望修订号 ${batch.expectedRevision}。`,
    });
  }

  // 2. 意见 ↔ 审计日志成对复核。
  for (const response of database.responses) {
    for (const opinion of response.reviews) {
      if (!opinion.batchId || !opinion.auditId) {
        addIssue({
          kind: "orphan_opinion",
          severity: "pending",
          entityType: "response",
          entityId: opinion.id,
          responseId: response.id,
          message: `评审意见 ${opinion.id}（${opinion.reviewer}）缺少审计批次或日志，进入待核。`,
          detail: opinion.comment,
        });
        continue;
      }
      const log = database.auditLogs.find(
        (item) => item.id === opinion.auditId,
      );
      if (!log) {
        addIssue({
          kind: "unmatched_opinion",
          severity: "pending",
          entityType: "response",
          entityId: opinion.id,
          responseId: response.id,
          message: `评审意见 ${opinion.id} 的审计日志 ${opinion.auditId} 不存在，进入待核。`,
        });
      }
    }

    for (const clarification of response.clarifications) {
      if (!clarification.batchId || !clarification.requestAuditId) {
        addIssue({
          kind: "orphan_log",
          severity: "pending",
          entityType: "response",
          entityId: clarification.id,
          responseId: response.id,
          message: `澄清 ${clarification.id} 缺少发起批次或审计日志，进入待核。`,
        });
      }
      if (
        clarification.supplierResponse &&
        (!clarification.responseBatchId || !clarification.responseAuditId)
      ) {
        addIssue({
          kind: "unmatched_clarification",
          severity: "pending",
          entityType: "response",
          entityId: clarification.id,
          responseId: response.id,
          message: `澄清 ${clarification.id} 已有供应商回复但缺少回复批次或日志，进入待核。`,
        });
      }
    }
  }

  // 3. 审计日志 ↔ 业务实体 / 批次复核。
  for (const log of database.auditLogs) {
    const businessActions = [
      "提交独立意见",
      "发起澄清",
      "回复澄清",
      "版本定稿",
      "汇总签字定稿",
    ];
    if (!businessActions.includes(log.action) || !log.batchId) {
      continue;
    }
    const batch = database.batches.find((item) => item.id === log.batchId);
    if (!batch) {
      addIssue({
        kind: "unmatched_log",
        severity: "pending",
        entityType: "audit",
        entityId: log.id,
        message: `审计日志 ${log.id} 引用的批次 ${log.batchId} 不存在，进入待核。`,
      });
    }
  }

  // 4. 批次与业务实体一一对应，禁止重复追加。
  // 澄清的“发起”和“回复”是对同一记录的两类合法操作，
  // 仅当同一操作类型出现多个已提交批次时才判定为重复写入。
  const writeCounts = new Map<string, number>();
  for (const batch of database.batches) {
    if (batch.status !== "committed" || !batch.resultEntityId) {
      continue;
    }
    const key = `${batch.operation}::${batch.resultEntityId}`;
    writeCounts.set(key, (writeCounts.get(key) ?? 0) + 1);
  }
  for (const batch of database.batches) {
    if (batch.status !== "committed" || !batch.resultEntityId) {
      continue;
    }
    const key = `${batch.operation}::${batch.resultEntityId}`;
    if ((writeCounts.get(key) ?? 0) > 1) {
      addIssue({
        kind: "duplicate_batch",
        severity: "quarantined",
        entityType: "batch",
        entityId: batch.id,
        responseId: batch.responseId,
        message: `业务实体 ${batch.resultEntityId} 的 ${batch.operation} 被 ${writeCounts.get(key)} 个批次重复写入，已隔离。`,
      });
    }
  }

  // 5. 定稿哈希复核。
  for (const version of database.versions) {
    const status = verifyVersionHash(database, version);
    version.hashStatus = status;
    if (status === "missing") {
      addIssue({
        kind: "version_hash_missing",
        severity: "pending",
        entityType: "version",
        entityId: version.id,
        message: `定稿版本 ${version.version} 缺少可复核哈希基线，进入待核。`,
      });
    } else if (status === "mismatch") {
      addIssue({
        kind: "version_hash_mismatch",
        severity: "quarantined",
        entityType: "version",
        entityId: version.id,
        message: `定稿版本 ${version.version} 内容哈希与当前数据不一致，已隔离。`,
        detail: `记录哈希 ${version.contentHash}。`,
      });
    }
  }

  // 汇总问题并标记隔离对象。
  const issues: ReconciliationIssue[] = [];
  for (const input of collected) {
    const id = issueId(input.kind, input.entityId);
    const earlier = previousById.get(id);
    issues.push({
      id,
      kind: input.kind,
      severity: input.severity,
      entityType: input.entityType,
      entityId: input.entityId,
      responseId: input.responseId,
      message: input.message,
      detail: input.detail,
      detectedAt: earlier?.detectedAt ?? detectedAt,
      resolved: false,
    });
    if (input.severity !== "quarantined") {
      continue;
    }
    if (input.entityType === "version") {
      const version = database.versions.find(
        (item) => item.id === input.entityId,
      );
      if (version) {
        version.quarantined = true;
        version.quarantineReason = input.message;
        version.issueIds = [...(version.issueIds ?? []), id];
      }
    }
    const responseId =
      input.entityType === "response"
        ? input.responseId
        : input.responseId;
    if (responseId) {
      const response = database.responses.find(
        (item) => item.id === responseId,
      );
      if (response && input.kind !== "version_hash_mismatch") {
        response.quarantined = true;
        response.quarantineReason = input.message;
        response.issueIds = [...(response.issueIds ?? []), id];
      }
    }
  }

  const resolutions =
    previous?.resolutions ?? database.reconciliation?.resolutions ?? [];
  const resolvedIssues = [
    ...(previous?.issues ?? database.reconciliation?.issues ?? []),
  ].filter((issue) => issue.resolved);

  const pendingIssues = issues.filter((issue) => !issue.resolved);
  const priorSummary = previous?.summary;
  const summary = {
    reconciledAt: detectedAt,
    totalBatches: database.batches.length,
    unfinishedBatches: database.batches.filter(
      (batch) => batch.status === "prepared",
    ).length,
    replayedBatches: Math.max(
      stats.replayedBatches,
      priorSummary?.replayedBatches ?? 0,
    ),
    backfilledBatches: Math.max(
      stats.backfilledBatches,
      priorSummary?.backfilledBatches ?? 0,
    ),
    quarantinedResponses: database.responses.filter(
      (response) => response.quarantined,
    ).length,
    quarantinedVersions: database.versions.filter(
      (version) => version.quarantined,
    ).length,
    pendingIssues: pendingIssues.length,
    resolvedIssues: resolvedIssues.length + resolutions.length,
  };

  return {
    summary,
    issues: [...pendingIssues, ...resolvedIssues],
    resolutions,
    lastStartupReplay:
      previous?.lastStartupReplay ??
      database.reconciliation?.lastStartupReplay ??
      detectedAt,
  };
};

export interface QuarantineResolution {
  issueId: string;
  note: string;
  actor: string;
  role: ReviewRole;
}

/**
 * 组长确认修复：登记处理结论、解除隔离、撤销无法恢复的批次，
 * 然后重新对账。采购人员和评审员无权调用（resolver 层先做角色校验）。
 */
export const resolveQuarantineIssue = (
  database: ReviewDatabase,
  input: QuarantineResolution,
): ReconciliationIssue => {
  const existing = database.reconciliation.issues.find(
    (issue) => issue.id === input.issueId && !issue.resolved,
  );
  const issueIdValue = input.issueId;
  const now = new Date().toISOString();

  const batch = database.batches.find((item) =>
    issueIdValue.includes(item.id),
  );
  if (batch && batch.status === "prepared") {
    batch.status = "aborted";
    batch.committedAt = now;
  }

  const auditBatch: AuditBatch = {
    id: `BATCH-RESOLVE-${issueIdValue}`,
    revision:
      database.batches.reduce(
        (maximum, item) => Math.max(maximum, item.revision),
        0,
      ) + 1,
    operation: "resolve_quarantine",
    opSeq: 1,
    status: "committed",
    createdAt: now,
    committedAt: now,
    actor: input.actor,
    role: input.role,
    expectedRevision: 0,
    payload: { issueId: issueIdValue, note: input.note },
    resultEntityId: issueIdValue,
    resultEntityType: undefined,
  };
  database.batches.unshift(auditBatch);

  const auditId = auditEntityId(auditBatch.id, 1);
  database.auditLogs.unshift({
    id: auditId,
    at: now,
    actor: input.actor,
    action: "组长确认修复",
    entity: issueIdValue,
    detail: `对账问题 ${issueIdValue} 已由 ${input.actor} 确认修复：${input.note}`,
    batchId: auditBatch.id,
    opSeq: 1,
    entityRefId: issueIdValue,
  });

  database.reconciliation.resolutions = [
    ...database.reconciliation.resolutions.filter(
      (resolution) => resolution.issueId !== issueIdValue,
    ),
    {
      issueId: issueIdValue,
      at: now,
      by: input.actor,
      note: input.note,
    },
  ];

  const prior = database.reconciliation;
  // 登记修复后只重新对账一次：resolutions 已抑制该问题再次出现，
  // 同时保留历史已解决问题，避免重复或残留未解决记录。
  const reconciled = reconcileDatabase(
    database,
    {
      replayedBatches: prior.summary.replayedBatches,
      backfilledBatches: prior.summary.backfilledBatches,
    },
    prior,
  );

  const resolvedIssue: ReconciliationIssue = {
    id: issueIdValue,
    kind: existing?.kind ?? "unfinished_batch",
    severity: existing?.severity ?? "quarantined",
    entityType: existing?.entityType ?? "batch",
    entityId: existing?.entityId ?? issueIdValue,
    responseId: existing?.responseId,
    message: existing?.message ?? input.note,
    detail: existing?.detail,
    detectedAt: existing?.detectedAt ?? now,
    resolved: true,
    resolvedAt: now,
    resolvedBy: input.actor,
    resolution: input.note,
  };

  database.reconciliation = {
    ...reconciled,
    issues: [
      ...reconciled.issues.filter((issue) => issue.id !== issueIdValue),
      resolvedIssue,
    ],
  };

  return resolvedIssue;
};
