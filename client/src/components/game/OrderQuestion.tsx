import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Option {
  id: string;
  text: string;
}

interface OrderQuestionProps {
  options: Option[];
  order: string[];
  onChange: (order: string[]) => void;
  disabled?: boolean;
}

function SortableItem({ id, text, disabled }: { id: string; text: string; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-3 p-4 bg-white/10 border-2 border-white/30 rounded-lg ${
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-move hover:border-azure-light hover:bg-white/15'
      }`}
    >
      <span className="text-white/50 text-xl">☰</span>
      <span className="text-white">{text}</span>
    </div>
  );
}

export function OrderQuestion({ options, order, onChange, disabled }: OrderQuestionProps) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (disabled) return;

    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = order.indexOf(active.id as string);
      const newIndex = order.indexOf(over.id as string);
      onChange(arrayMove(order, oldIndex, newIndex));
    }
  };

  const orderedOptions = order.map((id) => options.find((opt) => opt.id === id)!);

  return (
    <div className="space-y-3">
      <p className="text-sm text-white/70 mb-3">
        ↕️ Ziehen Sie die Antworten in die richtige Reihenfolge
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          {orderedOptions.map((option, index) => (
            <div key={option.id} className="flex items-center gap-3">
              <span className="text-sm font-bold text-white/60 min-w-[1.5rem]">{index + 1}.</span>
              <div className="flex-1">
                <SortableItem id={option.id} text={option.text} disabled={disabled} />
              </div>
            </div>
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
