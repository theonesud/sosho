import { Button } from "@ui-sdk/react/button";
import { Callout } from "../components/callout";
import { EmptyState } from "../components/empty-state";
import { Icon } from "../components/icon";
import { ShowcaseSection } from "./showcase-section";

export function FeedbackSection() {
  return (
    <ShowcaseSection
      id="feedback"
      title="Feedback"
      description="Callouts, empty states, and error states."
    >
      <div className="grid-2">
        <Callout tone="info" title="Draft saved">
          Version 13 is a draft. Publish it to use it in new runs.
        </Callout>
        <Callout tone="success" title="Run finished">
          All 10 nodes finished in 42 seconds.
        </Callout>
        <Callout tone="warning" title="Loop limit near">
          The loop from Rewrite draft to Quality gate ran 2 of 3 times.
        </Callout>
        <Callout tone="danger" title="Node failed">
          Publish digest returned status 502. Fix the tool and resume the run.
        </Callout>
      </div>
      <div className="grid-2">
        <EmptyState icon="workflow" title="No workflows yet">
          Create a workflow to connect triggers, models, and tools.
        </EmptyState>
        <EmptyState
          icon="danger"
          tone="danger"
          title="Engine is not reachable"
          action={
            <Button data-variant="secondary">
              <Icon name="refresh" />
              Try again
            </Button>
          }
        >
          The app cannot reach the engine API. Check that the engine runs.
        </EmptyState>
      </div>
    </ShowcaseSection>
  );
}
