import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { createUser } from '../../api/admin';
import type { AdminGroup } from '../../types/api';

interface CreateUserFormProps {
  groups: AdminGroup[];
  onCreated: () => void;
  onCancel: () => void;
}

export function CreateUserForm({ groups, onCreated, onCancel }: CreateUserFormProps) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const toggleGroup = (name: string) => {
    setSelectedGroups((prev) =>
      prev.includes(name) ? prev.filter((g) => g !== name) : [...prev, name]
    );
  };

  const handleSubmit = async () => {
    if (!username || !password) {
      alert('Username and password required');
      return;
    }
    setSubmitting(true);
    try {
      const result = await createUser({
        username,
        email: email || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        password,
        groups: selectedGroups,
      });
      if (result.success) {
        onCreated();
      } else {
        alert('Failed to create user');
      }
    } catch (err) {
      alert('Error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-5 max-w-[500px]">
      <h3 className="text-base font-semibold text-text-primary mb-4">Create New User</h3>

      <div className="grid gap-3">
        <div>
          <label className="text-xs text-text-dim block mb-1">Username *</label>
          <input className="form-input !mb-0" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-text-dim block mb-1">First Name</label>
            <input className="form-input !mb-0" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-text-dim block mb-1">Last Name</label>
            <input className="form-input !mb-0" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-xs text-text-dim block mb-1">Email</label>
          <input className="form-input !mb-0" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-text-dim block mb-1">Password *</label>
          <input className="form-input !mb-0" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-text-dim block mb-1">Groups</label>
          <div className="flex flex-wrap gap-1.5">
            {groups.map((g) => (
              <label
                key={g.id}
                className="text-xs flex items-center gap-1.5 bg-surface px-2 py-1 rounded border border-border cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedGroups.includes(g.name)}
                  onChange={() => toggleGroup(g.name)}
                />
                {g.name}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-2 mt-5 justify-end">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Creating...' : 'Create User'}
        </Button>
      </div>
    </div>
  );
}
