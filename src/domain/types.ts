/** 领域模型:工作流、决策、候选、任务、revision。对应 design.md D3/D4。 */

export const WORKFLOW_STATES = [
  "draft",
  "researching",
  "decision_pending",
  "planned",
  "implementing",
  "paused",
  "completed",
  "archived",
] as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[number];

/** 合法状态转换表;paused 可恢复到任意活动状态。 */
const TRANSITIONS: Readonly<Record<WorkflowState, readonly WorkflowState[]>> = {
  archived: [],
  completed: [
    "archived",
  ],
  decision_pending: [
    "planned",
    "researching",
    "paused",
  ],
  draft: [
    "researching",
  ],
  implementing: [
    "paused",
    "completed",
    "planned",
  ],
  paused: [
    "researching",
    "decision_pending",
    "planned",
    "implementing",
  ],
  planned: [
    "implementing",
    "decision_pending",
    "paused",
  ],
  researching: [
    "decision_pending",
    "paused",
  ],
};

export function isWorkflowState(value: string): value is WorkflowState {
  return (WORKFLOW_STATES as readonly string[]).includes(value);
}

export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: WorkflowState, to: WorkflowState): void {
  if (!canTransition(from, to)) {
    throw new Error(`非法状态转换: ${from} -> ${to}`);
  }
}

/** README.md frontmatter 对应的工作流元信息。 */
export interface WorkflowManifest {
  createdAt: string;
  executionModel?: string;
  id: string;
  parent?: string;
  planningModel?: string;
  reviewModel?: string;
  revision: number;
  state: WorkflowState;
  thinkingLevel?: string;
  title: string;
  updatedAt: string;
}

export interface Candidate {
  cons: string[];
  id: string;
  pros: string[];
  risks: string[];
  summary: string;
  title: string;
}

export interface DecisionPoint {
  candidates: Candidate[];
  constraints: string[];
  context: string;
  id: string;
  question: string;
  recommendedId?: string;
}

export interface Selection {
  at: string;
  candidateId: string;
  note?: string;
  pointId: string;
  revision: number;
}

export type TaskState = "pending" | "in_progress" | "done" | "failed";

export interface PlanTask {
  acceptance: string;
  dependsOn: string[];
  id: string;
  state: TaskState;
  title: string;
  verify: string;
}

/** session entry 恢复锚点,见 design.md D6。 */
export interface SessionAnchor {
  currentTaskId?: string;
  revision: number;
  state: WorkflowState;
  workflowId: string;
}

export const SESSION_ANCHOR_TYPE = "xpi-superplan";

export function encodeAnchor(anchor: SessionAnchor): string {
  return JSON.stringify(anchor);
}
