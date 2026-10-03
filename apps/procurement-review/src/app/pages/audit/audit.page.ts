import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { toSignal } from "@angular/core/rxjs-interop";
import { Store } from "@ngrx/store";
import { ButtonModule } from "primeng/button";
import { InputTextModule } from "primeng/inputtext";
import { SelectModule } from "primeng/select";
import { TableModule } from "primeng/table";
import { TagModule } from "primeng/tag";
import { ReviewActions } from "../../core/state/review.actions";
import {
  batchOperationLabels,
  issueKindLabels,
  roleProfiles,
  type AuditLog,
  type ReconciliationIssue,
} from "../../core/models/review.models";import {
  selectAuditLogs,
  selectBatches,
  selectPendingIssues,
  selectReconciliation,
  selectRole,
  selectVersions,
} from "../../core/state/review.selectors";

interface ExportRow {
  at: string;
  actor: string;
  action: string;
  entity: string;
  detail: string;
  batchId: string;
  opSeq: number | string;
}

@Component({
  selector: "app-audit-page",
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    InputTextModule,
    SelectModule,
    TableModule,
    TagModule,
  ],
  templateUrl: "./audit.page.html",
  styleUrl: "./audit.page.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditPage {
  private readonly store = inject(Store);

  readonly issueLabels = issueKindLabels;
  readonly operationLabels = batchOperationLabels;
  readonly roleProfiles = roleProfiles;
  readonly logs = toSignal(this.store.select(selectAuditLogs), {
    initialValue: [],
  });
  readonly versions = toSignal(this.store.select(selectVersions), {
    initialValue: [],
  });
  readonly batches = toSignal(this.store.select(selectBatches), {
    initialValue: [],
  });
  readonly reconciliation = toSignal(
    this.store.select(selectReconciliation),
    { initialValue: undefined },
  );
  readonly issues = toSignal(this.store.select(selectPendingIssues), {
    initialValue: [] as ReconciliationIssue[],
  });
  readonly role = toSignal(this.store.select(selectRole), {
    initialValue: "reviewer_a",
  });
  readonly keyword = signal("");
  readonly action = signal("all");
  readonly actionOptions = computed(() => [
    { label: "全部动作", value: "all" },
    ...Array.from(new Set(this.logs().map((log) => log.action))).map(
      (item) => ({ label: item, value: item }),
    ),
  ]);
  readonly filteredLogs = computed<AuditLog[]>(() => {
    const keyword = this.keyword().trim().toLowerCase();
    const action = this.action();
    return this.logs().filter((log) => {
      const matchesAction = action === "all" || log.action === action;
      const matchesKeyword =
        !keyword ||
        [
          log.actor,
          log.action,
          log.entity,
          log.detail,
          log.batchId,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(keyword);
      return matchesAction && matchesKeyword;
    });
  });
  /** 复核队列中同一批待处理问题，保证总览/复核/导出读取同一对账结果。 */
  readonly pendingIssuesForExport = computed(() => this.issues());
  readonly finalVersion = computed(
    () => this.versions().find((version) => version.status === "finalized"),
  );
  readonly finalizedCount = computed(
    () => this.versions().filter((version) => version.status === "finalized").length,
  );
  readonly committedBatches = computed(
    () => this.batches().filter((batch) => batch.status === "committed").length,
  );

  /** 导出内容 = 过滤后的审计事件（含批次号、操作编号）+ 对账结论。 */
  private exportRows(): ExportRow[] {
    return this.filteredLogs().map((log) => ({
      at: log.at,
      actor: log.actor,
      action: log.action,
      entity: log.entity,
      detail: log.detail,
      batchId: log.batchId ?? "",
      opSeq: log.opSeq ?? "",
    }));
  }

  exportJson(): void {
    const reconciliation = this.reconciliation();
    const payload = {
      exportedAt: new Date().toISOString(),
      reconciliation: reconciliation
        ? {
            summary: reconciliation.summary,
            pendingIssues: this.pendingIssuesForExport(),
          }
        : null,
      auditEvents: this.exportRows(),
    };
    this.download(
      "procurement-review-audit.json",
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8",
    );
  }

  exportCsv(): void {
    const header = [
      "时间",
      "操作人",
      "动作",
      "对象",
      "详情",
      "审计批次号",
      "操作编号",
    ];
    const rows = this.exportRows().map((row) => [
      row.at,
      row.actor,
      row.action,
      row.entity,
      row.detail,
      row.batchId,
      String(row.opSeq),
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    this.download(
      "procurement-review-audit.csv",
      "﻿" + csv,
      "text/csv;charset=utf-8",
    );
  }

  resetReviewData(): void {
    this.store.dispatch(ReviewActions.resetReviewData());
  }

  issueLabel(kind: string): string {
    return this.issueLabels[kind] ?? kind;
  }

  private download(filename: string, content: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }
}
