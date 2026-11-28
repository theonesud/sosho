import type { RunNodeInfo } from "../run/run-node-body";
import type { NodeStatus } from "../run/run-state";

export interface RunApi {
  readonly statusOf: (nodeId: string) => NodeStatus | undefined;
  readonly infoOf: (nodeId: string) => RunNodeInfo;
}
