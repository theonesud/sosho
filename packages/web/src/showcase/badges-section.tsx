import { NodeKindBadge } from "../components/node-kind-badge";
import { RunStatusBadge } from "../components/run-status-badge";
import { nodeKinds, runStatuses } from "../types";
import { ShowcaseSection } from "./showcase-section";

export function BadgesSection() {
  return (
    <ShowcaseSection
      id="badges"
      title="Badges"
      description="Color marks run state only. Each state also has an icon and a label. Node kinds stay neutral."
    >
      <div className="badge-row">
        {runStatuses.map((status) => (
          <RunStatusBadge key={status} status={status} />
        ))}
      </div>
      <div className="badge-row">
        {nodeKinds.map((kind) => (
          <NodeKindBadge key={kind} kind={kind} />
        ))}
      </div>
    </ShowcaseSection>
  );
}
