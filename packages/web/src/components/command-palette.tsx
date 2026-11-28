import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ui-sdk/react/command";
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog";
import { toast } from "@ui-sdk/react/toast";
import { useEffect, useState } from "react";
import { Icon } from "./icon";

const screens = ["Workflows", "Editor", "Run view", "Inbox", "Triggers", "Versions"];
const actions = ["New workflow", "Run selected workflow", "Cancel running run"];

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.code === "KeyK") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="palette-trigger" data-variant="ghost">
        <Icon name="search" />
        <span>Search or run a command</span>
        <kbd>Ctrl K</kbd>
      </DialogTrigger>
      <DialogBackdrop />
      <DialogContent className="palette-content">
        <DialogTitle className="visually-hidden">Command palette</DialogTitle>
        <Command
          onAction={(value) => {
            setOpen(false);
            toast(`Ran ${value}`);
          }}
        >
          <CommandInput aria-label="Search commands" placeholder="Search screens and actions" />
          <CommandEmpty>No commands found.</CommandEmpty>
          <CommandList>
            <CommandGroup>
              <CommandGroupLabel>Go to</CommandGroupLabel>
              {screens.map((name) => (
                <CommandItem key={name} value={name}>
                  {name}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup>
              <CommandGroupLabel>Actions</CommandGroupLabel>
              {actions.map((name) => (
                <CommandItem key={name} value={name}>
                  {name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
