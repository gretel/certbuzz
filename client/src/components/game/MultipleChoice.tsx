interface Option {
  id: string;
  text: string;
}

interface MultipleChoiceProps {
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
  eliminatedAnswers?: string[]; // For buzzer mode - crossed out answers
}

export function MultipleChoice({ options, selected, onChange, disabled, eliminatedAnswers = [] }: MultipleChoiceProps) {
  const handleToggle = (id: string) => {
    if (disabled || eliminatedAnswers.includes(id)) return;

    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-white/70 mb-3">
        ✓ Wählen Sie alle zutreffenden Antworten
      </p>
      {options.map((option) => {
        const isEliminated = eliminatedAnswers.includes(option.id);

        return (
          <label
            key={option.id}
            className={`flex items-center p-4 border-2 rounded-lg cursor-pointer transition-all ${
              isEliminated
                ? 'border-red-400/50 bg-red-500/10 opacity-50 cursor-not-allowed'
                : selected.includes(option.id)
                  ? 'border-cb-accent bg-cb-primary/20'
                  : 'border-white/30 bg-white/10 hover:border-white/50 hover:bg-white/15'
            } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <input
              type="checkbox"
              value={option.id}
              checked={selected.includes(option.id)}
              onChange={() => handleToggle(option.id)}
              disabled={disabled || isEliminated}
              className="w-5 h-5 text-cb-primary focus:ring-cb-primary rounded accent-cb-accent"
            />
            <span className={`ml-3 ${isEliminated ? 'line-through text-red-400' : 'text-white'}`}>
              {option.text}
              {isEliminated && <span className="ml-2 text-red-400">❌</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}
