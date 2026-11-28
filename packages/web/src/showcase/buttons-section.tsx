import { Button } from "@ui-sdk/react/button";
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { Toggle } from "@ui-sdk/react/toggle";
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarSeparator } from "@ui-sdk/react/toolbar";
import { Icon } from "../components/icon";
import { ShowcaseSection } from "./showcase-section";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function ButtonsSection() {
  return (
    <ShowcaseSection
      id="buttons"
      title="Buttons and toggles"
      description="Actions, pressed states, and compact choice controls."
    >
      <div className="row">
        <Button data-variant="primary">
          <Icon name="run" />
          Run workflow
        </Button>
        <Button data-variant="secondary">Save draft</Button>
        <Button data-variant="ghost">Cancel</Button>
        <Button data-variant="danger">
          <Icon name="trash" />
          Delete
        </Button>
        <Button data-variant="secondary" aria-label="Refresh runs">
          <Icon name="refresh" />
        </Button>
        <Button data-variant="primary" onClick={() => wait(2000)}>
          <span className="spinner" aria-hidden="true" />
          Click to load
        </Button>
        <Button data-variant="secondary" disabled>
          Disabled
        </Button>
      </div>
      <div className="row">
        <Toggle>
          <Icon name="bolt" />
          Pin
        </Toggle>
        <SegmentedControl aria-label="Run filter" defaultValue="all">
          <SegmentedControlIndicator />
          <SegmentedControlItem value="all">All</SegmentedControlItem>
          <SegmentedControlItem value="active">Active</SegmentedControlItem>
          <SegmentedControlItem value="failed">Failed</SegmentedControlItem>
        </SegmentedControl>
        <Toolbar aria-label="Canvas tools">
          <ToolbarGroup aria-label="History">
            <ToolbarButton aria-label="Undo">
              <Icon name="arrowDown" />
            </ToolbarButton>
            <ToolbarButton aria-label="Redo">
              <Icon name="arrowUp" />
            </ToolbarButton>
          </ToolbarGroup>
          <ToolbarSeparator />
          <Toggle aria-label="Bold note">
            <Icon name="bold" />
          </Toggle>
          <ToolbarButton>Fit view</ToolbarButton>
        </Toolbar>
      </div>
    </ShowcaseSection>
  );
}
