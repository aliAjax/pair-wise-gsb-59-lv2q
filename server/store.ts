import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSeed } from "./data";
import type {
  AssessmentInput,
  AuditBatch,
  AuditLog,
  BatchAction,
  Clarification,
  ClarificationInput,
  ClarificationResponseInput,
  FinalizeVersionInput,
  JournalFile,
  QuarantineEntityType,
  QuarantineItem,
  QuarantineKind,
  ReconciliationReport,
  ResolveQuarantineInput,
  ReviewDatabase,
  ReviewerOpinion,
  ReviewRole,
  ReviewVersion,
  RevisionConflict,
  StoredBatch,
  SupplierResponse,
} from "./types";

const DATA_PATH = join(process.cwd(), "server", "runtime-data.json");
const AUDIT_PATH = join(process.cwd(), "server", "audit-log.json");
const JOURNAL_PATH = join(process.cwd(), "server", "batch-journal.json");

interface FinalizeVersionPayload extends FinalizeVersionInput {
  versionLabel: string;
  contentHash: string;
}

export interface BatchCommit<T> {
  result: T;
  batchId: string;
  revision: number;
  replayed: boolean;
}

export interface WorkspaceSnapshot extends ReviewDatabase {
  auditLogs: AuditLog[];
  batches: AuditBatch[];
  reconciliation: ReconciliationReport;
}

export class RevisionConflictError extends Error {
  readonly conflict: RevisionConflict;

  constructor(conflict: RevisionConflict) {
    super(conflict.message);
    this.name = "RevisionConflictError";
    this.conflict = conflict;
  }
}

const emptyJournal = (): JournalFile => ({
  seq: 1,
  batches: [],
  quarantine: [],
  meta: { lastRunAt: "", replayed: 0, backfilled: 0 },
});

const requireRole = (
  role: ReviewRole,
  allowed: ReviewRole[],
  message = "当前角色无权执行此操作。",
): void => {
  if (!allowed.includes(role)) {
    throw new Error(message);
  }
};

const computeContentHash = (data: ReviewDatabase): string => {
  const basis = data.responses
    .map(
      (response) =>
        `${response.id}:${response.status}:r${response.revision}:${response.reviews
          .map((review) => review.id)
          .join("+")}:${response.clarifications
          .map((clarification) => `${clarification.id}~${clarification.status}`)
          .join("+")}`,
    )
    .join("|");
  let hash = 0x811c9dc5;
  for (let index = 0; index < basis.length; index += 1) {
    hash ^= basis.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

/**
 * 可恢复审计批次存储。
 *
 * 业务数据（runtime-data.json）与审计日志（audit-log.json）分开写盘，
 * 批次日志（batch-journal.json）作为预写日志：先把批次记为 pending，
 * 再分别落业务数据和审计日志，最后标记 applied。进程中断或磁盘出错后，
 * 重启时重放 pending 批次补齐两侧写入，并与现有数据对账。
 */
class ReviewStore {
  private data: ReviewDatabase;
  private auditLogs: AuditLog[];
  private journal: JournalFile;
  private legacySeq = 1;

  constructor() {
    const seed = buildSeed();
    this.data = seed.data;
    this.auditLogs = seed.auditLogs;
    this.journal = emptyJournal();
    this.load();
    this.recover();
    this.persistAll();
  }

  snapshot(): WorkspaceSnapshot {
    return {
      ...structuredClone(this.data),
      auditLogs: structuredClone(this.auditLogs),
      batches: this.journal.batches.map((batch) => {
        const publicBatch: Partial<StoredBatch> = { ...batch };
        delete publicBatch.payload;
        delete publicBatch.result;
        return publicBatch as AuditBatch;
      }),
      reconciliation: this.reconciliation(),
    };
  }

  reconciliation(): ReconciliationReport {
    const quarantine = [...this.journal.quarantine].sort((a, b) =>
      b.detectedAt.localeCompare(a.detectedAt),
    );
    return {
      lastRunAt: this.journal.meta.lastRunAt,
      batchCount: this.journal.batches.length,
      replayedBatches: this.journal.meta.replayed,
      backfilledBatches: this.journal.meta.backfilled,
      pendingQuarantine: quarantine.filter((item) => item.status === "pending")
        .length,
      quarantine,
    };
  }

  submitAssessment(input: AssessmentInput): BatchCommit<ReviewerOpinion> {
    return this.executeBatch<AssessmentInput, ReviewerOpinion>({
      opId: input.opId,
      action: "submit_assessment",
      actor: input.reviewer,
      role: input.role,
      baseRevision: input.baseRevision,
      entityId: input.responseId,
      prepare: () => {
        requireRole(input.role, ["reviewer_a", "reviewer_b", "chair"]);
        if (input.comment.trim().length < 6) {
          throw new Error("评审意见至少需要 6 个字符。");
        }
        const response = this.mustFindResponse(input.responseId);
        const clause = this.data.clauses.find(
          (item) => item.id === response.clauseId,
        );
        if (!clause) {
          throw new Error("对应技术条款不存在。");
        }
        if (input.score < 0 || input.score > clause.weight) {
          throw new Error(`评分必须在 0 至 ${clause.weight} 之间。`);
        }
        if (
          clause.type === "scoring" &&
          input.decision === "compliant" &&
          input.score === 0
        ) {
          throw new Error("评分项判定为符合时必须填写评分。");
        }
        this.assertNotQuarantined(response.id);
        this.assertRevision(response, input.baseRevision);
        return input;
      },
    });
  }

  requestClarification(input: ClarificationInput): BatchCommit<Clarification> {
    return this.executeBatch<ClarificationInput, Clarification>({
      opId: input.opId,
      action: "request_clarification",
      actor: input.actor,
      role: input.role,
      baseRevision: input.baseRevision,
      entityId: input.responseId,
      prepare: () => {
        const response = this.mustFindResponse(input.responseId);
        if (input.requestText.trim().length < 6) {
          throw new Error("澄清要求至少需要 6 个字符。");
        }
        const requestedAt = new Date();
        const dueAt = new Date(input.dueAt);
        if (Number.isNaN(dueAt.getTime()) || dueAt <= requestedAt) {
          throw new Error("澄清截止时间必须晚于当前时间。");
        }
        const maximumDueAt = new Date(requestedAt);
        maximumDueAt.setDate(maximumDueAt.getDate() + 7);
        if (dueAt > maximumDueAt) {
          throw new Error("澄清期限不得超过 7 个自然日。");
        }
        this.assertNotQuarantined(response.id);
        this.assertRevision(response, input.baseRevision);
        return input;
      },
    });
  }

  respondClarification(
    input: ClarificationResponseInput,
  ): BatchCommit<Clarification> {
    const located = this.locateClarification(input.clarificationId);
    return this.executeBatch<ClarificationResponseInput, Clarification>({
      opId: input.opId,
      action: "respond_clarification",
      actor: input.actor,
      role: input.role,
      baseRevision: input.baseRevision,
      entityId: located?.response.id ?? input.clarificationId,
      prepare: () => {
        requireRole(input.role, ["procurement", "chair"]);
        if (!located) {
          throw new Error("澄清记录不存在。");
        }
        if (input.responseText.trim().length < 6) {
          throw new Error("澄清回复至少需要 6 个字符。");
        }
        if (located.clarification.status === "responded") {
          throw new Error("该澄清已登记回复，不能重复提交。");
        }
        this.assertNotQuarantined(located.response.id);
        this.assertRevision(located.response, input.baseRevision);
        return input;
      },
    });
  }

  finalizeVersion(input: FinalizeVersionInput): BatchCommit<ReviewVersion> {
    return this.executeBatch<FinalizeVersionPayload, ReviewVersion>({
      opId: input.opId,
      action: "finalize_version",
      actor: input.actor,
      role: input.role,
      baseRevision: 0,
      entityId: "versions",
      prepare: () => {
        requireRole(input.role, ["chair"]);
        if (input.label.trim().length < 4) {
          throw new Error("版本名称至少需要 4 个字符。");
        }
        const pendingQuarantine = this.journal.quarantine.filter(
          (item) => item.status === "pending",
        );
        if (pendingQuarantine.length > 0) {
          throw new Error(
            `仍有 ${pendingQuarantine.length} 项隔离待核未由组长确认修复，不能定稿。`,
          );
        }
        const blockingClarifications = this.data.responses
          .flatMap((response) => response.clarifications)
          .filter(
            (clarification) =>
              clarification.status === "open" ||
              clarification.status === "overdue",
          );
        if (blockingClarifications.length > 0) {
          throw new Error(
            `仍有 ${blockingClarifications.length} 项未完成澄清，不能定稿。`,
          );
        }
        const maxVersion =
          this.data.versions.reduce((maximum, version) => {
            const numeric = Number(version.version.replace(/\D/g, ""));
            return Number.isFinite(numeric)
              ? Math.max(maximum, numeric)
              : maximum;
          }, 0) + 1;
        return {
          ...input,
          versionLabel: `V${maxVersion}`,
          contentHash: computeContentHash(this.data),
        };
      },
    });
  }

  resolveQuarantine(input: ResolveQuarantineInput): BatchCommit<QuarantineItem> {
    return this.executeBatch<ResolveQuarantineInput, QuarantineItem>({
      opId: input.opId,
      action: "resolve_quarantine",
      actor: input.actor,
      role: input.role,
      baseRevision: 0,
      entityId: input.quarantineId,
      prepare: () => {
        requireRole(
          input.role,
          ["chair"],
          "仅评审组长可确认修复隔离待核项，采购人员和评审员不能越权处理。",
        );
        const item = this.journal.quarantine.find(
          (entry) => entry.id === input.quarantineId,
        );
        if (!item) {
          throw new Error("隔离待核项不存在。");
        }
        if (item.status === "resolved") {
          throw new Error("该隔离待核项已确认修复，不能重复处理。");
        }
        if (input.resolution.trim().length < 4) {
          throw new Error("修复说明至少需要 4 个字符。");
        }
        return input;
      },
    });
  }

  reset(): void {
    const seed = buildSeed();
    this.data = seed.data;
    this.auditLogs = seed.auditLogs;
    this.journal = emptyJournal();
    this.legacySeq = 1;
    this.recover();
    this.persistAll();
  }

  /**
   * 批次提交协议：校验（不落盘）→ 记录 pending 批次 → 写业务数据 →
   * 写审计日志 → 标记 applied。同一 opId 重试直接返回原批次结果，
   * 不重复追加意见或日志。
   */
  private executeBatch<TPayload, TResult>(params: {
    opId: string;
    action: BatchAction;
    actor: string;
    role: ReviewRole;
    baseRevision: number;
    entityId: string;
    prepare: () => TPayload;
  }): BatchCommit<TResult> {
    const existing = this.journal.batches.find(
      (batch) => batch.opId === params.opId,
    );
    if (existing) {
      if (existing.status === "pending") {
        this.replayBatch(existing);
        this.persistAll();
      }
      if (existing.result === undefined || existing.result === null) {
        throw new Error("该操作对应的批次数据不一致，已进入隔离待核。");
      }
      return {
        result: existing.result as TResult,
        batchId: existing.id,
        revision: existing.resultRevision ?? 0,
        replayed: true,
      };
    }
    const payload = params.prepare();
    const batch: StoredBatch = {
      id: this.nextBatchId(),
      opId: params.opId,
      action: params.action,
      actor: params.actor,
      role: params.role,
      baseRevision: params.baseRevision,
      status: "pending",
      entityId: params.entityId,
      payload,
      createdAt: new Date().toISOString(),
    };
    this.journal.batches.push(batch);
    this.persistJournal();
    const result = this.applyByAction(
      params.action,
      payload,
      batch.id,
      batch.createdAt,
    ) as TResult;
    this.persistData();
    this.persistAudit();
    batch.status = "applied";
    batch.appliedAt = new Date().toISOString();
    batch.result = result;
    batch.resultRevision = this.revisionOf(batch.entityId);
    this.persistJournal();
    return {
      result,
      batchId: batch.id,
      revision: batch.resultRevision ?? 0,
      replayed: false,
    };
  }

  /** 重放未完成批次：apply 按 batchId 幂等，补齐缺失的意见、澄清或日志。 */
  private replayBatch(batch: StoredBatch): void {
    const result = this.applyByAction(
      batch.action,
      batch.payload,
      batch.id,
      batch.createdAt,
    );
    batch.status = "applied";
    batch.appliedAt = new Date().toISOString();
    batch.result = result;
    batch.resultRevision = this.revisionOf(batch.entityId);
    this.journal.meta.replayed += 1;
  }

  private applyByAction(
    action: BatchAction,
    payload: unknown,
    batchId: string,
    at: string,
  ): unknown {
    switch (action) {
      case "submit_assessment":
        return this.applyAssessment(payload as AssessmentInput, batchId, at);
      case "request_clarification":
        return this.applyRequestClarification(
          payload as ClarificationInput,
          batchId,
          at,
        );
      case "respond_clarification":
        return this.applyRespondClarification(
          payload as ClarificationResponseInput,
          batchId,
          at,
        );
      case "finalize_version":
        return this.applyFinalizeVersion(
          payload as FinalizeVersionPayload,
          batchId,
          at,
        );
      case "resolve_quarantine":
        return this.applyResolveQuarantine(
          payload as ResolveQuarantineInput,
          batchId,
          at,
        );
    }
  }

  private applyAssessment(
    payload: AssessmentInput,
    batchId: string,
    at: string,
  ): ReviewerOpinion {
    const response = this.mustFindResponse(payload.responseId);
    const clause = this.data.clauses.find(
      (item) => item.id === response.clauseId,
    );
    let opinion = response.reviews.find((item) => item.batchId === batchId);
    if (!opinion) {
      opinion = {
        id: `OP-${batchId}`,
        responseId: response.id,
        reviewer: payload.reviewer.trim(),
        role: payload.role,
        decision: payload.decision,
        score: payload.score,
        comment: payload.comment.trim(),
        createdAt: at,
        batchId,
      };
      response.reviews.push(opinion);
      response.status = payload.decision;
      response.reviewRound = Math.max(response.reviewRound, 1);
      response.revision += 1;
    }
    this.ensureAudit(
      batchId,
      opinion.reviewer,
      "提交独立意见",
      response.id,
      `${clause?.code ?? ""} ${clause?.title ?? ""} 判定为 ${payload.decision}，评分 ${payload.score}。批次 ${batchId}，修订 r${response.revision}。`,
      at,
    );
    return opinion;
  }

  private applyRequestClarification(
    payload: ClarificationInput,
    batchId: string,
    at: string,
  ): Clarification {
    const response = this.mustFindResponse(payload.responseId);
    let clarification = response.clarifications.find(
      (item) => item.batchId === batchId,
    );
    if (!clarification) {
      const round =
        Math.max(0, ...response.clarifications.map((item) => item.round)) + 1;
      clarification = {
        id: `CL-${batchId}`,
        responseId: response.id,
        clauseId: response.clauseId,
        round,
        requestText: payload.requestText.trim(),
        requestedAt: at,
        dueAt: new Date(payload.dueAt).toISOString(),
        status: "open",
        batchId,
      };
      response.clarifications.push(clarification);
      response.status = "clarification";
      response.revision += 1;
    }
    this.ensureAudit(
      batchId,
      payload.actor,
      "发起澄清",
      clarification.id,
      `${response.supplierName} ${response.clauseId} 第 ${clarification.round} 轮澄清已发起。批次 ${batchId}，修订 r${response.revision}。`,
      at,
    );
    return clarification;
  }

  private applyRespondClarification(
    payload: ClarificationResponseInput,
    batchId: string,
    at: string,
  ): Clarification {
    const located = this.locateClarification(payload.clarificationId);
    if (!located) {
      throw new Error("澄清记录不存在。");
    }
    const { response, clarification } = located;
    if (clarification.status !== "responded") {
      clarification.supplierResponse = payload.responseText.trim();
      clarification.respondedAt = at;
      clarification.status = "responded";
      response.status = "pending";
      response.revision += 1;
    }
    this.ensureAudit(
      batchId,
      payload.actor,
      "回复澄清",
      clarification.id,
      `第 ${clarification.round} 轮澄清已回复，等待评审员复核。批次 ${batchId}，修订 r${response.revision}。`,
      at,
    );
    return clarification;
  }

  private applyFinalizeVersion(
    payload: FinalizeVersionPayload,
    batchId: string,
    at: string,
  ): ReviewVersion {
    let version = this.data.versions.find((item) => item.batchId === batchId);
    if (!version) {
      this.data.versions.forEach((item) => {
        item.status = "finalized";
      });
      version = {
        id: `VER-${batchId}`,
        version: payload.versionLabel,
        label: payload.label.trim(),
        status: "finalized",
        createdAt: at,
        createdBy: payload.actor,
        signedBy: [payload.actor],
        clauseCount: this.data.clauses.length,
        responseCount: this.data.responses.length,
        contentHash: payload.contentHash,
        batchId,
      };
      this.data.versions.unshift(version);
    }
    this.ensureAudit(
      batchId,
      payload.actor,
      "汇总签字定稿",
      version.id,
      `${version.version} ${version.label} 已锁定，签署人 ${payload.actor}，内容哈希 ${version.contentHash}。批次 ${batchId}。`,
      at,
    );
    return version;
  }

  private applyResolveQuarantine(
    payload: ResolveQuarantineInput,
    batchId: string,
    at: string,
  ): QuarantineItem {
    const item = this.journal.quarantine.find(
      (entry) => entry.id === payload.quarantineId,
    );
    if (!item) {
      throw new Error("隔离待核项不存在。");
    }
    if (item.status !== "resolved") {
      item.status = "resolved";
      item.resolution = payload.resolution.trim();
      item.resolvedBy = payload.actor;
      item.resolvedAt = at;
      this.repairEntityBatches(item);
    }
    this.ensureAudit(
      batchId,
      payload.actor,
      "确认修复隔离项",
      item.entityId,
      `${item.id}（${item.entityId}）由 ${payload.actor} 确认修复：${item.resolution ?? ""}。批次 ${batchId}。`,
      at,
    );
    return item;
  }

  /**
   * 确认修复时补齐底层批次效果：对相关已应用批次重新执行幂等 apply，
   * 从批次记录补登缺失的审计日志，避免下次重启对账再次隔离。
   */
  private repairEntityBatches(item: QuarantineItem): void {
    this.journal.batches
      .filter((batch) => {
        if (batch.status !== "applied") {
          return false;
        }
        if (batch.entityId === item.entityId) {
          return true;
        }
        if (item.entityType === "version") {
          return this.data.versions.some(
            (version) =>
              version.id === item.entityId && version.batchId === batch.id,
          );
        }
        return false;
      })
      .forEach((batch) => {
        try {
          this.applyByAction(batch.action, batch.payload, batch.id, batch.createdAt);
        } catch {
          // 修复失败时保留隔离处理记录，不影响确认动作本身。
        }
      });
  }

  /** 重启恢复：重放未完成批次 → 旧数据回填批次号 → 与当前数据对账。 */
  private recover(): void {
    this.data.responses.forEach((response) => {
      if (!response.revision) {
        response.revision = 1;
      }
    });
    this.journal.batches
      .filter((batch) => batch.status === "pending")
      .forEach((batch) => {
        try {
          this.replayBatch(batch);
        } catch (error) {
          batch.status = "applied";
          batch.appliedAt = new Date().toISOString();
          this.addQuarantine(
            "isolated",
            batch.action === "finalize_version" ? "version" : "response",
            batch.entityId,
            "批次重放失败",
            `批次 ${batch.id} 重放失败：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      });
    this.backfillLegacy();
    this.reconcile();
    this.journal.meta.lastRunAt = new Date().toISOString();
  }

  /**
   * 旧数据缺批次号时，用现有意见、澄清、版本与审计日志互相配对回填；
   * 补不全的（意见无日志、日志无业务记录、历史定稿哈希无法复核）进入待核。
   */
  private backfillLegacy(): void {
    const consumeLog = (
      predicate: (log: AuditLog) => boolean,
    ): AuditLog | undefined =>
      this.auditLogs.find((log) => !log.batchId && predicate(log));
    const createBackfillBatch = (
      action: BatchAction,
      actor: string,
      role: ReviewRole,
      entityId: string,
      at: string,
    ): StoredBatch => {
      const batch: StoredBatch = {
        id: `BATCH-LEGACY-${String(this.legacySeq).padStart(3, "0")}`,
        opId: `LEGACY-${String(this.legacySeq).padStart(3, "0")}`,
        action,
        actor,
        role,
        baseRevision: 0,
        status: "backfilled",
        entityId,
        payload: null,
        createdAt: at,
        appliedAt: at,
      };
      this.legacySeq += 1;
      this.journal.batches.push(batch);
      this.journal.meta.backfilled += 1;
      return batch;
    };

    this.data.responses.forEach((response) => {
      response.reviews
        .filter((review) => !review.batchId)
        .forEach((review) => {
          const log = consumeLog(
            (candidate) =>
              candidate.entity === response.id &&
              candidate.actor === review.reviewer &&
              candidate.action === "提交独立意见",
          );
          const batch = createBackfillBatch(
            "submit_assessment",
            review.reviewer,
            review.role,
            response.id,
            review.createdAt,
          );
          review.batchId = batch.id;
          if (log) {
            log.batchId = batch.id;
          } else {
            this.addQuarantine(
              "pending_review",
              "response",
              response.id,
              "历史评审意见缺少审计日志",
              `意见 ${review.id}（${review.reviewer}）已入库但没有对应审计日志，批次无法完整回填，相关定稿哈希无法复核。`,
            );
          }
        });
      response.clarifications
        .filter((clarification) => !clarification.batchId)
        .forEach((clarification) => {
          const log = consumeLog(
            (candidate) =>
              candidate.entity === clarification.id &&
              candidate.action === "发起澄清",
          );
          const batch = createBackfillBatch(
            "request_clarification",
            log?.actor ?? "历史数据",
            "procurement",
            clarification.id,
            clarification.requestedAt,
          );
          clarification.batchId = batch.id;
          if (log) {
            log.batchId = batch.id;
          } else {
            this.addQuarantine(
              "pending_review",
              "response",
              response.id,
              "历史澄清记录缺少审计日志",
              `澄清 ${clarification.id}（第 ${clarification.round} 轮）没有对应审计日志，批次无法完整回填。`,
            );
          }
        });
    });

    this.data.versions
      .filter((version) => !version.batchId)
      .forEach((version) => {
        const log = consumeLog(
          (candidate) =>
            candidate.entity === version.id &&
            ["版本定稿", "创建工作版本", "汇总签字定稿"].includes(
              candidate.action,
            ),
        );
        const batch = createBackfillBatch(
          "finalize_version",
          log?.actor ?? version.createdBy,
          "chair",
          version.id,
          version.createdAt,
        );
        version.batchId = batch.id;
        if (log) {
          log.batchId = batch.id;
        }
        if (version.status === "finalized") {
          this.addQuarantine(
            "pending_review",
            "version",
            version.id,
            "历史定稿哈希无法复核",
            `版本 ${version.version} 的内容哈希 ${version.contentHash} 生成于批次机制之前，缺少可核对的批次记录。`,
          );
        }
      });

    this.auditLogs
      .filter((log) => !log.batchId)
      .forEach((log) => {
        this.addQuarantine(
          "pending_review",
          log.entity.startsWith("VER") ? "version" : "response",
          log.entity,
          "审计日志缺少业务记录",
          `日志 ${log.id}（${log.action}）找不到可配对的业务记录，批次无法完整回填。`,
        );
      });
  }

  /** 对账：机制上线后的已应用批次必须意见、日志、哈希齐全，不一致的隔离。 */
  private reconcile(): void {
    const hasLog = (batchId: string): boolean =>
      this.auditLogs.some((log) => log.batchId === batchId);
    this.journal.batches
      .filter((batch) => batch.status === "applied")
      .forEach((batch) => {
        switch (batch.action) {
          case "submit_assessment": {
            const response = this.data.responses.find(
              (item) => item.id === batch.entityId,
            );
            const review = response?.reviews.find(
              (item) => item.batchId === batch.id,
            );
            if (!review || !hasLog(batch.id)) {
              this.addQuarantine(
                "isolated",
                "response",
                batch.entityId,
                "批次效果不完整",
                `批次 ${batch.id} 已标记应用，但评审意见或审计日志缺失。`,
              );
            }
            break;
          }
          case "request_clarification": {
            const response = this.data.responses.find(
              (item) => item.id === batch.entityId,
            );
            const clarification = response?.clarifications.find(
              (item) => item.batchId === batch.id,
            );
            if (!clarification || !hasLog(batch.id)) {
              this.addQuarantine(
                "isolated",
                "response",
                batch.entityId,
                "批次效果不完整",
                `批次 ${batch.id} 已标记应用，但澄清记录或审计日志缺失。`,
              );
            }
            break;
          }
          case "respond_clarification":
          case "resolve_quarantine": {
            if (!hasLog(batch.id)) {
              const quarantinedEntity = this.journal.quarantine.find(
                (item) => item.id === batch.entityId,
              );
              this.addQuarantine(
                "isolated",
                batch.action === "resolve_quarantine"
                  ? ((quarantinedEntity?.entityType ??
                    "response") as QuarantineItem["entityType"])
                  : "response",
                quarantinedEntity?.entityId ?? batch.entityId,
                "批次效果不完整",
                `批次 ${batch.id} 已标记应用，但审计日志缺失。`,
              );
            }
            break;
          }
          case "finalize_version": {
            const version = this.data.versions.find(
              (item) => item.batchId === batch.id,
            );
            const expectedHash = (
              batch.payload as FinalizeVersionPayload | null
            )?.contentHash;
            if (
              !version ||
              !hasLog(batch.id) ||
              (expectedHash !== undefined &&
                version.contentHash !== expectedHash)
            ) {
              this.addQuarantine(
                "isolated",
                "version",
                version?.id ?? batch.entityId,
                "定稿哈希与批次记录不一致",
                `批次 ${batch.id} 记录的定稿哈希 ${expectedHash ?? "未知"} 与版本 ${
                  version?.version ?? "?"
                } 当前哈希 ${version?.contentHash ?? "缺失"} 不一致，或审计日志缺失。`,
              );
            }
            break;
          }
        }
      });
  }

  private addQuarantine(
    kind: QuarantineKind,
    entityType: QuarantineEntityType,
    entityId: string,
    reason: string,
    detail: string,
  ): void {
    const duplicated = this.journal.quarantine.some(
      (item) =>
        item.status === "pending" &&
        item.entityId === entityId &&
        item.reason === reason,
    );
    if (duplicated) {
      return;
    }
    this.journal.quarantine.push({
      id: `Q-${String(this.journal.quarantine.length + 1).padStart(4, "0")}`,
      kind,
      entityType,
      entityId,
      reason,
      detail,
      detectedAt: new Date().toISOString(),
      status: "pending",
    });
  }

  private ensureAudit(
    batchId: string,
    actor: string,
    action: string,
    entity: string,
    detail: string,
    at: string,
  ): void {
    if (this.auditLogs.some((log) => log.batchId === batchId)) {
      return;
    }
    this.auditLogs.unshift({
      id: `AUD-${batchId}`,
      at,
      actor,
      action,
      entity,
      detail,
      batchId,
    });
  }

  private assertNotQuarantined(responseId: string): void {
    const pending = this.journal.quarantine.find(
      (item) =>
        item.status === "pending" &&
        item.entityType === "response" &&
        item.entityId === responseId,
    );
    if (pending) {
      throw new Error(
        `该响应处于隔离待核状态（${pending.id}：${pending.reason}），需评审组长确认修复后才能继续操作。`,
      );
    }
  }

  private assertRevision(
    response: SupplierResponse,
    baseRevision: number,
  ): void {
    if (response.revision !== baseRevision) {
      throw new RevisionConflictError({
        responseId: response.id,
        currentRevision: response.revision,
        status: response.status,
        reviewRound: response.reviewRound,
        reviews: structuredClone(response.reviews),
        message: `该响应已被他人修改（当前修订 r${response.revision}，你基于 r${baseRevision}）。你的输入已保留，请对照对方改动后重新提交。`,
      });
    }
  }

  private mustFindResponse(responseId: string): SupplierResponse {
    const response = this.data.responses.find((item) => item.id === responseId);
    if (!response) {
      throw new Error("供应商响应不存在。");
    }
    return response;
  }

  private locateClarification(
    clarificationId: string,
  ): { response: SupplierResponse; clarification: Clarification } | undefined {
    for (const response of this.data.responses) {
      const clarification = response.clarifications.find(
        (item) => item.id === clarificationId,
      );
      if (clarification) {
        return { response, clarification };
      }
    }
    return undefined;
  }

  private revisionOf(entityId: string): number | undefined {
    return this.data.responses.find((item) => item.id === entityId)?.revision;
  }

  private nextBatchId(): string {
    const id = `BATCH-${String(this.journal.seq).padStart(6, "0")}`;
    this.journal.seq += 1;
    return id;
  }

  private load(): void {
    if (existsSync(DATA_PATH)) {
      try {
        const raw = JSON.parse(readFileSync(DATA_PATH, "utf8")) as Record<
          string,
          unknown
        >;
        const { auditLogs: embeddedLogs, ...business } = raw;
        this.data = business as unknown as ReviewDatabase;
        if (Array.isArray(embeddedLogs) && !existsSync(AUDIT_PATH)) {
          // 旧格式把审计日志混存在业务文件里，拆分到独立文件。
          this.auditLogs = embeddedLogs as AuditLog[];
        }
      } catch {
        // 业务文件损坏时保留种子数据，对账会标记差异。
      }
    }
    if (existsSync(AUDIT_PATH)) {
      try {
        this.auditLogs = JSON.parse(
          readFileSync(AUDIT_PATH, "utf8"),
        ) as AuditLog[];
      } catch {
        // 审计文件损坏时保留已加载数据。
      }
    }
    if (existsSync(JOURNAL_PATH)) {
      try {
        this.journal = JSON.parse(
          readFileSync(JOURNAL_PATH, "utf8"),
        ) as JournalFile;
      } catch {
        // 批次日志损坏时从空日志重新开始，对账会隔离不一致数据。
      }
    }
    this.legacySeq =
      this.journal.batches.filter((batch) => batch.id.startsWith("BATCH-LEGACY-"))
        .length + 1;
  }

  private persistData(): void {
    writeFileSync(DATA_PATH, JSON.stringify(this.data, null, 2), "utf8");
  }

  private persistAudit(): void {
    writeFileSync(AUDIT_PATH, JSON.stringify(this.auditLogs, null, 2), "utf8");
  }

  private persistJournal(): void {
    writeFileSync(JOURNAL_PATH, JSON.stringify(this.journal, null, 2), "utf8");
  }

  private persistAll(): void {
    this.persistData();
    this.persistAudit();
    this.persistJournal();
  }
}

export const reviewStore = new ReviewStore();
