import { Button } from "@ui-sdk/react/button";
import { useState } from "react";
import { EmptyState } from "../components/empty-state";
import { Icon } from "../components/icon";
import { type Decision, InboxRequestCard } from "../components/inbox-request-card";
import { ShowcaseSection } from "./showcase-section";

export function InboxSection() {
  const [decision, setDecision] = useState<Decision | null>(null);

  return (
    <ShowcaseSection id="inbox" title="Inbox" description="A run asks a person for a decision.">
      <div className="resolve" data-resolved={decision ? "" : undefined}>
        <InboxRequestCard
          workflow="Daily digest"
          node="Editor review"
          prompt="The summary scored 0.62. Publish it as is, or send it back for a rewrite?"
          waitingSince="07:02"
          decision={decision}
          onDecide={setDecision}
        />
      </div>
      {decision ? (
        <EmptyState
          icon="inbox"
          title="Inbox is clear"
          afterCollapse
          action={
            <Button data-variant="secondary" onClick={() => setDecision(null)}>
              <Icon name="refresh" />
              Restore request
            </Button>
          }
        >
          The request was {decision}. New requests appear here.
        </EmptyState>
      ) : null}
    </ShowcaseSection>
  );
}
