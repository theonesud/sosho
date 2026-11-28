import { TriggerRow } from "../components/trigger-row";
import { ShowcaseSection } from "./showcase-section";

export function TriggersSection() {
  return (
    <ShowcaseSection
      id="triggers"
      title="Triggers"
      description="Schedules and webhooks that start a workflow."
    >
      <div className="stack">
        <TriggerRow
          kind="cron"
          title="Every morning"
          detail="0 7 * * *"
          nextRun="tomorrow at 07:00"
          defaultActive
        />
        <TriggerRow
          kind="webhook"
          title="Invoice webhook"
          detail="http://127.0.0.1:8000/hooks/invoice-intake"
          defaultActive={false}
        />
      </div>
    </ShowcaseSection>
  );
}
