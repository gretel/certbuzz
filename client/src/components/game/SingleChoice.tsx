interface Option {
  id: string;
  text: string;
}

interface SingleChoiceProps {
  options: Option[];
  selected: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  eliminatedAnswers?: string[]; // For buzzer mode - crossed out answers
}

export function SingleChoice({ options, selected, onChange, disabled, eliminatedAnswers = [] }: SingleChoiceProps) {
  return (
    <div className="space-y-3">
      {options.map((option) => {
        const isEliminated = eliminatedAnswers.includes(option.id);

        return (
          <label
            key={option.id}
            className={`flex items-center p-4 border-2 rounded-lg cursor-pointer transition-all ${
              isEliminated
                ? 'border-red-400/50 bg-red-500/10 opacity-50 cursor-not-allowed'
                : selected === option.id
                  ? 'border-cb-accent bg-cb-primary/20'
                  : 'border-white/30 bg-white/10 hover:border-white/50 hover:bg-white/15'
            } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <input
              type="radio"
              name="single-choice"
              value={option.id}
              checked={selected === option.id}
              onChange={() => !disabled && !isEliminated && onChange(option.id)}
              disabled={disabled || isEliminated}
              className="w-5 h-5 text-cb-primary focus:ring-cb-primary accent-cb-accent"
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
