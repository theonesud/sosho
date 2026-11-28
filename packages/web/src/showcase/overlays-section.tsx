import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@ui-sdk/react/alert-dialog";
import { Button } from "@ui-sdk/react/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import {
  Drawer,
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "@ui-sdk/react/drawer";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@ui-sdk/react/hover-card";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@ui-sdk/react/popover";
import { toast } from "@ui-sdk/react/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import { Icon } from "../components/icon";
import { JsonViewer } from "../components/json-viewer";
import { NodeKindBadge } from "../components/node-kind-badge";
import { nodeInput } from "./mock";
import { ShowcaseSection } from "./showcase-section";

const secondary = { "data-variant": "secondary" } as const;

export function OverlaysSection() {
  return (
    <ShowcaseSection
      id="overlays"
      title="Overlays"
      description="Floating layers use glass. They sit above the page and stay apart from it."
    >
      <DialogRow />
      <PopupRow />
    </ShowcaseSection>
  );
}

function DialogRow() {
  return (
    <div className="row">
      <Dialog>
        <DialogTrigger render={<Button {...secondary} />}>Dialog</DialogTrigger>
        <DialogBackdrop />
        <DialogContent className="dialog-body">
          <DialogTitle>Rename workflow</DialogTitle>
          <DialogDescription>
            The name changes in all lists. Versions keep their number.
          </DialogDescription>
          <div className="row end">
            <DialogClose render={<Button data-variant="ghost" />}>Cancel</DialogClose>
            <DialogClose render={<Button data-variant="primary" />}>Save</DialogClose>
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog>
        <AlertDialogTrigger render={<Button data-variant="danger" />}>
          <Icon name="trash" />
          Delete workflow
        </AlertDialogTrigger>
        <AlertDialogBackdrop />
        <AlertDialogContent className="dialog-body">
          <AlertDialogTitle>Delete Daily digest?</AlertDialogTitle>
          <AlertDialogDescription>
            All 12 versions and the run history are deleted. This cannot be undone.
          </AlertDialogDescription>
          <div className="row end">
            <AlertDialogClose render={<Button data-variant="ghost" />}>Cancel</AlertDialogClose>
            <AlertDialogClose value="confirm" render={<Button data-variant="danger" />}>
              Delete forever
            </AlertDialogClose>
          </div>
        </AlertDialogContent>
      </AlertDialog>
      <Drawer side="right">
        <DrawerTrigger render={<Button {...secondary} />}>Node inspector</DrawerTrigger>
        <DrawerBackdrop />
        <DrawerContent className="drawer-body">
          <DrawerTitle>Summarize</DrawerTitle>
          <DrawerDescription>
            <NodeKindBadge kind="llm" />
          </DrawerDescription>
          <JsonViewer label="Node input" value={nodeInput} />
          <DrawerClose render={<Button data-variant="secondary" />}>Close</DrawerClose>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function PopupRow() {
  return (
    <div className="row">
      <Popover>
        <PopoverTrigger render={<Button {...secondary} />}>Popover</PopoverTrigger>
        <PopoverContent className="popup-body">
          <PopoverTitle>Run options</PopoverTitle>
          <PopoverDescription>Start from the last version with default input.</PopoverDescription>
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger render={<Button {...secondary} />}>Tooltip</TooltipTrigger>
        <TooltipContent>Fork the run from this node</TooltipContent>
      </Tooltip>
      <HoverCard>
        <HoverCardTrigger href="#workflows">Hover card: Daily digest</HoverCardTrigger>
        <HoverCardContent className="popup-body">
          <strong>Daily digest</strong>
          <p className="muted">10 nodes, version 12, last run 12 minutes ago.</p>
        </HoverCardContent>
      </HoverCard>
      <Button
        {...secondary}
        onClick={() => toast.info("Run queued", { description: "run_8f3a21" })}
      >
        Show toast
      </Button>
    </div>
  );
}
