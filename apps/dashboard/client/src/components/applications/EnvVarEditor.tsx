import React from 'react';
import { Plus, X } from 'lucide-react';

interface EnvVar {
  name: string;
  value: string;
}

interface EnvVarEditorProps {
  envVars: EnvVar[];
  onChange: (envVars: EnvVar[]) => void;
}

export function EnvVarEditor({ envVars, onChange }: EnvVarEditorProps) {
  const addRow = () => {
    onChange([...envVars, { name: '', value: '' }]);
  };

  const removeRow = (index: number) => {
    onChange(envVars.filter((_, i) => i !== index));
  };

  const updateRow = (index: number, field: 'name' | 'value', val: string) => {
    const updated = envVars.map((env, i) =>
      i === index ? { ...env, [field]: val } : env
    );
    onChange(updated);
  };

  return (
    <div>
      {envVars.map((env, i) => (
        <div key={i} className="flex items-center gap-2 mb-2">
          <input
            type="text"
            placeholder="VARIABLE_NAME"
            value={env.name}
            onChange={(e) => updateRow(i, 'name', e.target.value)}
            className="flex-1 px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
          <input
            type="text"
            placeholder="value"
            value={env.value}
            onChange={(e) => updateRow(i, 'value', e.target.value)}
            className="flex-1 px-3 py-2 bg-surface border border-border rounded-[var(--radius)] text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => removeRow(i)}
            className="p-2 text-text-dim hover:text-red transition-colors"
            title="Remove"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="flex items-center gap-1 text-sm text-text-dim hover:text-accent transition-colors font-mono"
      >
        <Plus className="w-3 h-3" />
        Add Variable
      </button>
    </div>
  );
}
