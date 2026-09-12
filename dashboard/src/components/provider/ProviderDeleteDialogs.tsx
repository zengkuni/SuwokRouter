import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RippleButton } from "@/components/animate/ripple-button";
import { type AvailableProvider, type Connection } from "@/lib/connections-api";

type ProviderDeleteDialogsProps = {
  deleteId: string | null;
  bulkDeleteIds: string[] | null;
  bulkDeleting: boolean;
  deleteProvider: AvailableProvider | null;
  connections: Connection[];
  onCloseDelete: () => void;
  onDeleteConnection: () => void | Promise<void>;
  onCloseBulkDelete: () => void;
  onDeleteSelectedConnections: () => void | Promise<void>;
  onCloseProvider: () => void;
  onRemoveProvider: (provider: AvailableProvider) => void;
};

export function ProviderDeleteDialogs({
  deleteId,
  bulkDeleteIds,
  bulkDeleting,
  deleteProvider,
  connections,
  onCloseDelete,
  onDeleteConnection,
  onCloseBulkDelete,
  onDeleteSelectedConnections,
  onCloseProvider,
  onRemoveProvider,
}: ProviderDeleteDialogsProps) {
  const providerConnections = deleteProvider
    ? connections.filter((connection) => connection.provider === deleteProvider.id)
    : [];

  return (
    <>
      <Dialog open={Boolean(deleteId)} onOpenChange={(open) => !open && onCloseDelete()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete connection?</DialogTitle>
            <DialogDescription>Removes this key / session.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <RippleButton variant="outline" onClick={onCloseDelete}>
              Cancel
            </RippleButton>
            <RippleButton
              variant="destructive"
              onClick={onDeleteConnection}
            >
              Delete
            </RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(bulkDeleteIds)}
        onOpenChange={(open) => {
          if (!open && !bulkDeleting) onCloseBulkDelete();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Delete {bulkDeleteIds?.length ?? 0} selected connections?
            </DialogTitle>
            <DialogDescription>
              This will remove the selected keys or sessions. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <RippleButton
              variant="outline"
              disabled={bulkDeleting}
              onClick={onCloseBulkDelete}
            >
              Cancel
            </RippleButton>
            <RippleButton
              variant="destructive"
              disabled={bulkDeleting}
              onClick={onDeleteSelectedConnections}
            >
              {bulkDeleting ? "Deleting…" : "Delete"}
            </RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteProvider)}
        onOpenChange={(open) => {
          if (!open) onCloseProvider();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {deleteProvider?.name}?</DialogTitle>
            <DialogDescription>
              {providerConnections.length > 0 ? (
                <>
                  This provider has <strong>{providerConnections.length} connection(s)</strong> that
                  will also be deleted:
                  <ul className="mt-2 list-disc pl-4 text-xs">
                    {providerConnections.map((connection) => (
                      <li key={connection.id}>{connection.name || connection.id}</li>
                    ))}
                  </ul>
                </>
              ) : (
                "This will remove the provider from the list."
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <RippleButton variant="outline" onClick={onCloseProvider}>
              Cancel
            </RippleButton>
            <RippleButton
              variant="destructive"
              disabled={!deleteProvider}
              onClick={() => {
                if (deleteProvider) onRemoveProvider(deleteProvider);
              }}
            >
              Remove
            </RippleButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
