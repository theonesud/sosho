import {
  Timeline,
  TimelineConnector,
  TimelineDescription,
  TimelineItem,
  TimelineMarker,
  TimelineTime,
  TimelineTitle,
} from "@ui-sdk/react/timeline";
import { useRef } from "react";
import { cssVars } from "../css-vars";
import type { RunEvent } from "../types";
import { RunStatusBadge } from "./run-status-badge";

interface RunTimelineProps {
  readonly events: readonly RunEvent[];
}

export function RunTimeline({ events }: RunTimelineProps) {
  const staggered = useRef(events.length);
  return (
    <Timeline aria-label="Run events" className="run-timeline">
      {events.map((event, index) => (
        <TimelineItem
          key={event.id}
          data-status={event.status}
          style={cssVars({ "--index": index < staggered.current ? index : 0 })}
        >
          <TimelineMarker />
          <TimelineConnector />
          <TimelineTitle>
            {event.title} <RunStatusBadge status={event.status} />
          </TimelineTitle>
          <TimelineTime dateTime={`2026-11-27T${event.time}`}>{event.time}</TimelineTime>
          <TimelineDescription>{event.description}</TimelineDescription>
        </TimelineItem>
      ))}
    </Timeline>
  );
}
