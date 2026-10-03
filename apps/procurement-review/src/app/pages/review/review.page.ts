import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from "@angular/forms";
import { toSignal } from "@angular/core/rxjs-interop";
import { Store } from "@ngrx/store";
import { ButtonModule } from "primeng/button";
import { DialogModule } from "primeng/dialog";
import { InputTextModule } from "primeng/inputtext";
import { TableModule } from "primeng/table";
import { TagModule } from "primeng/tag";
import { TextareaModule } from "primeng/textarea";
import {
  createOperationId,
  quarantineKindLabels,
  quarantineStatusLabels,
  roleProfiles,
  type Clarification,
  type Clause,
  type QuarantineItem,
  type SupplierResponse,
} from "../../core/models/review.models";
import { ReviewActions } from "../../core/state/review.actions";
import {
  hasReviewDifference,
  selectClauses,
  selectPendingClarifications,
  selectReconciliation,
  selectRole,
  selectVersions,
} from "../../core/state/review.selectors";
import {
  ClarificationTagComponent,
  StatusTagComponent,
  VersionTagComponent,
} from "../../shared/status-tag.component";

interface PendingClarification {
  clause: Clause;
  response: SupplierResponse;
  clarification: Clarification;
}

@Component({
  selector: "app-review-page",
  imports: [
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    InputTextModule,
    TableModule,
    TagModule,
    TextareaModule,
    ClarificationTagComponent,
    StatusTagComponent,
    VersionTagComponent,
  ],
  templateUrl: "./review.page.html",
  styleUrl: "./review.page.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewPage {
  private readonly store = inject(Store);

  readonly versions = toSignal(this.store.select(selectVersions), {
    initialValue: [],
  });
  readonly clauses = toSignal(this.store.select(selectClauses), {
    initialValue: [],
  });
  readonly role = toSignal(this.store.select(selectRole), {
    initialValue: "reviewer_a",
  });
  readonly reconciliation = toSignal(this.store.select(selectReconciliation), {
    initialValue: undefined,
  });
  readonly pendingClarifications = toSignal(
    this.store.select(selectPendingClarifications),
    { initialValue: [] as PendingClarification[] },
  );
  readonly finalizeVisible = signal(false);
  readonly responseVisible = signal(false);
  readonly resolveVisible = signal(false);
  readonly selectedClarification = signal<PendingClarification | null>(null);
  readonly selectedQuarantine = signal<QuarantineItem | null>(null);
  readonly isChair = computed(() => this.role() === "chair");
  readonly canRespond = computed(() =>
    ["procurement", "chair"].includes(this.role()),
  );
  readonly quarantine = computed(
    () => this.reconciliation()?.quarantine ?? [],
  );
  readonly pendingQuarantine = computed(() =>
    this.quarantine().filter((item) => item.status === "pending"),
  );
  readonly canFinalize = computed(
    () => this.isChair() && this.pendingQuarantine().length === 0,
  );
  readonly differences = computed(() =>
    this.clauses().flatMap((clause) =>
      clause.responses
        .filter(hasReviewDifference)
        .map((response) => ({ clause, response })),
    ),
  );
  readonly finalizedCount = computed(
    () => this.versions().filter((version) => version.status === "finalized").length,
  );

  readonly kindLabels = quarantineKindLabels;
  readonly statusLabels = quarantineStatusLabels;

  kindLabel(item: QuarantineItem): string {
    return this.kindLabels[item.kind];
  }

  statusLabel(item: QuarantineItem): string {
    return this.statusLabels[item.status];
  }

  readonly finalizeForm = new FormGroup({
    label: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(4)],
    }),
  });
  readonly responseForm = new FormGroup({
    responseText: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(6)],
    }),
  });
  readonly resolveForm = new FormGroup({
    resolution: new FormControl("", {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(4)],
    }),
  });

  private finalizeOpId = createOperationId();
  private respondOpId = createOperationId();
  private resolveOpId = createOperationId();

  constructor() {
    this.finalizeForm.valueChanges.subscribe(() => {
      this.finalizeOpId = createOperationId();
    });
    this.responseForm.valueChanges.subscribe(() => {
      this.respondOpId = createOperationId();
    });
    this.resolveForm.valueChanges.subscribe(() => {
      this.resolveOpId = createOperationId();
    });
  }

  openFinalize(): void {
    this.finalizeForm.reset({ label: "技术响应符合性评审汇总" });
    this.finalizeVisible.set(true);
  }

  finalizeVersion(): void {
    if (!this.canFinalize() || this.finalizeForm.invalid) {
      this.finalizeForm.markAllAsTouched();
      return;
    }
    this.store.dispatch(
      ReviewActions.finalizeVersion({
        input: {
          label: this.finalizeForm.controls.label.value,
          actor: roleProfiles[this.role()].name,
          role: this.role(),
          opId: this.finalizeOpId,
        },
      }),
    );
    this.finalizeVisible.set(false);
  }

  openResponse(item: PendingClarification): void {
    this.selectedClarification.set(item);
    this.responseForm.reset({ responseText: "" });
    this.responseVisible.set(true);
  }

  respondClarification(): void {
    const item = this.selectedClarification();
    if (
      !item ||
      !this.canRespond() ||
      this.responseForm.invalid
    ) {
      this.responseForm.markAllAsTouched();
      return;
    }
    this.store.dispatch(
      ReviewActions.respondClarification({
        input: {
          clarificationId: item.clarification.id,
          responseText: this.responseForm.controls.responseText.value,
          actor: roleProfiles[this.role()].name,
          role: this.role(),
          baseRevision: item.response.revision,
          opId: this.respondOpId,
        },
      }),
    );
    this.responseVisible.set(false);
  }

  openResolve(item: QuarantineItem): void {
    if (!this.isChair()) {
      return;
    }
    this.selectedQuarantine.set(item);
    this.resolveForm.reset({ resolution: "" });
    this.resolveVisible.set(true);
  }

  resolveQuarantine(): void {
    const item = this.selectedQuarantine();
    if (!item || !this.isChair() || this.resolveForm.invalid) {
      this.resolveForm.markAllAsTouched();
      return;
    }
    this.store.dispatch(
      ReviewActions.resolveQuarantine({
        input: {
          quarantineId: item.id,
          resolution: this.resolveForm.controls.resolution.value,
          actor: roleProfiles[this.role()].name,
          role: this.role(),
          opId: this.resolveOpId,
        },
      }),
    );
    this.resolveVisible.set(false);
  }
}
