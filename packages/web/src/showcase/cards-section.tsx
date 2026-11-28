import { Button } from "@ui-sdk/react/button";
import { useState } from "react";
import { Icon } from "../components/icon";
import { StatTile } from "../components/stat-tile";
import { WorkflowCard } from "../components/workflow-card";
import { refreshedStatValues, stats, workflowCards } from "./mock";
import { ShowcaseSection } from "./showcase-section";

export function CardsSection() {
  const [refreshed, setRefreshed] = useState(false);

  return (
    <ShowcaseSection
      id="workflows"
      title="Workflows"
      description="Totals for the engine, then one card for each workflow."
    >
      <div className="row">
        <Button data-variant="secondary" onClick={() => setRefreshed((value) => !value)}>
          <Icon name="refresh" />
          Refresh totals
        </Button>
      </div>
      <div className="card stat-strip">
        {stats.map((stat, index) => (
          <StatTile
            key={stat.label}
            {...stat}
            value={refreshed ? (refreshedStatValues[index] ?? stat.value) : stat.value}
          />
        ))}
      </div>
      <div className="grid-3">
        {workflowCards.map((card) => (
          <WorkflowCard key={card.name} {...card} />
        ))}
      </div>
    </ShowcaseSection>
  );
}
