import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@ui-sdk/react/alert-dialog";

interface DeleteDialogProps {
  readonly name: string | null;
  readonly error: string | null;
  readonly pending: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function DeleteDialog({ name, error, pending, onCancel, onConfirm }: DeleteDialogProps) {
  return (
    <AlertDialog
      open={name !== null}
      onOpenChange={(open, details) => {
        if (open) return;
        if (pending) details.cancel();
        else if (details.returnValue === "confirm") {
          details.cancel();
          onConfirm();
        } else onCancel();
      }}
    >
      <AlertDialogBackdrop />
      <AlertDialogContent>
        <div data-slot="stack">
          <AlertDialogTitle>Delete {name ?? "workflow"}?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes {name ?? "the workflow"}, all of its versions, and all of its runs. You
            cannot undo it.
          </AlertDialogDescription>
          {error === null ? null : (
            <p className="wp-delete-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div data-slot="row" className="wp-dialog-actions">
          <AlertDialogClose disabled={pending}>Cancel</AlertDialogClose>
          <AlertDialogClose data-variant="danger" value="confirm" disabled={pending}>
            {pending ? "Deleting" : "Delete"}
          </AlertDialogClose>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
