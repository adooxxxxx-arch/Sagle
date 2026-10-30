import { FolderPlus, Layers } from 'lucide-react';
import { useState } from 'react';
import { useLibrary } from '../../store/library.ts';
import { Button, Input, Modal } from '../ui/index.tsx';

export function CollectionPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (id: string) => void }) {
  const collections = useLibrary((s) => s.collections);
  const create = useLibrary((s) => s.createCollection);
  const [name, setName] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Add to collection" width={400}>
      <div className="flex flex-col gap-1">
        {collections.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              onPick(c.id);
              onClose();
            }}
            className="flex items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] hover:bg-hover"
          >
            <Layers className="size-4 text-fg-3" />
            <span className="flex-1 truncate">{c.name}</span>
            <span className="text-[11.5px] text-fg-3">{c.items.length}</span>
          </button>
        ))}
        {collections.length === 0 && <p className="px-2 py-2 text-[12.5px] text-fg-3">No collections yet. Create one below.</p>}
      </div>
      <form
        className="mt-3 flex gap-2 border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const id = create(name.trim());
          setName('');
          onPick(id);
          onClose();
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New collection name" aria-label="New collection name" />
        <Button type="submit" icon={<FolderPlus className="size-3.5" />} disabled={!name.trim()}>
          Create
        </Button>
      </form>
    </Modal>
  );
}
