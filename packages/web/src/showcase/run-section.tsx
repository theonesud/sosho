import { Button } from "@ui-sdk/react/button";
import { Meter, MeterIndicator, MeterLabel, MeterTrack, MeterValue } from "@ui-sdk/react/meter";
import {
  Progress,
  ProgressIndicator,
  ProgressLabel,
  ProgressTrack,
  ProgressValue,
} from "@ui-sdk/react/progress";
import { useState } from "react";
import { JsonViewer } from "../components/json-viewer";
import { RunStatusBadge } from "../components/run-status-badge";
import { RunTimeline } from "../components/run-timeline";
import type { RunEvent, RunStatus } from "../types";
import { nodeInput, nodeOutput, runEvents } from "./mock";
import { ShowcaseSection } from "./showcase-section";

interface Step {
  readonly progress: number;
  readonly quality: number;
  readonly status: RunStatus;
  readonly title: string;
}

const steps: readonly Step[] = [
  { progress: 60, quality: 62, status: "running", title: "Quality gate retried" },
  { progress: 80, quality: 71, status: "waiting", title: "Editor review requested" },
  { progress: 100, quality: 88, status: "succeeded", title: "Run finished" },
  { progress: 20, quality: 35, status: "failed", title: "Run failed" },
];

function simulatedEvent(step: Step, count: number): RunEvent {
  const seconds = String(10 + count).padStart(2, "0");
  return {
    id: `sim-${count}`,
    time: `07:01:${seconds}`,
    title: step.title,
    description: `Simulated event ${count + 1}.`,
    status: step.status,
  };
}

export function RunSection() {
  const [step, setStep] = useState(0);
  const [events, setEvents] = useState<readonly RunEvent[]>(runEvents);
  const current = steps[step] ?? steps[0];
  const progress = current?.progress ?? 0;
  const quality = current?.quality ?? 0;
  const status = current?.status ?? "running";
  function advance() {
    const next = (step + 1) % steps.length;
    const nextStep = steps[next];
    setStep(next);
    if (nextStep) {
      setEvents((list) => [...list, simulatedEvent(nextStep, list.length - runEvents.length)]);
    }
  }
  return (
    <ShowcaseSection
      id="run-view"
      title="Run view"
      description="Live event timeline, progress, and node data."
    >
      <div className="grid-2">
        <div className="card panel">
          <h3 className="panel-title">
            Events <span className="live-dot" role="img" aria-label="Live" />
          </h3>
          <RunTimeline events={events} />
        </div>
        <div className="stack">
          <div className="card panel stack">
            <div className="row between">
              <RunStatusBadge status={status} />
              <Button data-variant="secondary" onClick={advance}>
                Simulate next state
              </Button>
            </div>
            <Progress value={progress}>
              <ProgressLabel>Nodes finished</ProgressLabel>
              <ProgressValue />
              <ProgressTrack>
                <ProgressIndicator />
              </ProgressTrack>
            </Progress>
            <Meter value={quality} min={0} max={100}>
              <MeterLabel>Quality score</MeterLabel>
              <MeterValue />
              <MeterTrack>
                <MeterIndicator />
              </MeterTrack>
            </Meter>
          </div>
          <NodeData />
        </div>
      </div>
    </ShowcaseSection>
  );
}

function NodeData() {
  return (
    <div className="grid-2">
      <div className="stack">
        <h4>Input</h4>
        <JsonViewer label="Node input" value={nodeInput} />
      </div>
      <div className="stack">
        <h4>Output</h4>
        <JsonViewer label="Node output" value={nodeOutput} />
      </div>
    </div>
  );
}
