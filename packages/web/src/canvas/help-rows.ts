export interface HelpRow {
  readonly action: string;
  readonly keys: readonly string[];
  readonly text?: string;
  readonly run: boolean;
}

export const HELP_ROWS: readonly HelpRow[] = [
  { action: "Pan", keys: ["Drag"], run: true },
  { action: "Zoom", keys: ["Wheel"], run: true },
  { action: "Select or expand a node", keys: ["Click"], run: true },
  { action: "Add to selection", keys: ["shift+Click"], run: false },
  { action: "Box select", keys: ["shift+Drag"], run: false },
  { action: "Select all", keys: ["mod+a"], run: false },
  { action: "Copy", keys: ["mod+c"], run: false },
  { action: "Paste", keys: ["mod+v"], run: false },
  { action: "Duplicate", keys: ["mod+d"], run: false },
  { action: "Delete", keys: ["delete"], run: false },
  { action: "Undo, redo", keys: ["mod+z", "mod+shift+z"], run: false },
  { action: "Collapse or clear", keys: ["escape"], run: true },
  { action: "Connect from the plus", keys: ["Drag"], run: false },
  { action: "Add a node with the plus", keys: ["Click"], run: false },
  { action: "Fit the graph", keys: [], text: "Fit button", run: true },
];

export function helpRows(runMode: boolean): readonly HelpRow[] {
  return runMode ? HELP_ROWS.filter((row) => row.run) : HELP_ROWS;
}
