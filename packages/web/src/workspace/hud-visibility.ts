export interface HudState {
  readonly runMode: boolean;
  readonly editable: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canPaste: boolean;
  readonly hasSelection: boolean;
  readonly selectedCount: number;
  readonly nodeCount: number;
}

export interface HudVisibility {
  readonly undo: boolean;
  readonly redo: boolean;
  readonly copy: boolean;
  readonly paste: boolean;
  readonly duplicate: boolean;
  readonly remove: boolean;
  readonly selectAll: boolean;
  readonly boxTool: boolean;
  readonly history: boolean;
  readonly clipboard: boolean;
  readonly selection: boolean;
}

export function hudVisibility(state: HudState): HudVisibility {
  const edit = state.editable && !state.runMode;
  const nodeSelected = state.selectedCount > 0;
  const undo = edit && state.canUndo;
  const redo = edit && state.canRedo;
  const copy = edit && nodeSelected;
  const paste = edit && state.canPaste;
  const duplicate = edit && nodeSelected;
  const remove = edit && state.hasSelection;
  const selectAll = edit && state.nodeCount > 0 && state.selectedCount < state.nodeCount;
  return {
    undo,
    redo,
    copy,
    paste,
    duplicate,
    remove,
    selectAll,
    boxTool: edit,
    history: undo || redo,
    clipboard: copy || paste || duplicate || remove,
    selection: edit,
  };
}
