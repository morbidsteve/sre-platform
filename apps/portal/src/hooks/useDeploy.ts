import { useState, useCallback } from 'react';
import { createDeploymentPR } from '../api';
import type { DeployResponse } from '../api';

export interface EnvEntry {
  name: string;
  value: string;
  secret: string;
  isSecret: boolean;
}

interface DeployForm {
  appName: string;
  appType: 'web-app' | 'api-service' | 'worker' | 'cronjob';
  image: string;
  port: number;
  team: string;
  resources: 'small' | 'medium' | 'large';
  ingress: string;
  database: boolean;
  databaseSize: 'small' | 'medium' | 'large';
  redis: boolean;
  redisSize: 'small' | 'medium' | 'large';
  sso: boolean;
  storage: boolean;
  env: EnvEntry[];
}

interface ValidationErrors {
  appName?: string;
  image?: string;
  team?: string;
}

const INITIAL_FORM: DeployForm = {
  appName: '',
  appType: 'web-app',
  image: '',
  port: 8080,
  team: '',
  resources: 'small',
  ingress: '',
  database: false,
  databaseSize: 'small',
  redis: false,
  redisSize: 'small',
  sso: false,
  storage: false,
  env: [],
};

export function useDeploy() {
  const [form, setForm] = useState<DeployForm>(INITIAL_FORM);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DeployResponse | null>(null);

  const setField = useCallback(<K extends keyof DeployForm>(key: K, value: DeployForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear error when field is edited
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }, []);

  const addEnv = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      env: [...prev.env, { name: '', value: '', secret: '', isSecret: false }],
    }));
  }, []);

  const removeEnv = useCallback((index: number) => {
    setForm((prev) => ({
      ...prev,
      env: prev.env.filter((_, i) => i !== index),
    }));
  }, []);

  const setEnvField = useCallback((index: number, field: keyof EnvEntry, value: string | boolean) => {
    setForm((prev) => ({
      ...prev,
      env: prev.env.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    }));
  }, []);

  const validate = useCallback((): boolean => {
    const newErrors: ValidationErrors = {};

    if (!form.appName) {
      newErrors.appName = 'App name is required';
    } else if (!/^[a-z][a-z0-9-]*$/.test(form.appName)) {
      newErrors.appName = 'Must be kebab-case (lowercase letters, numbers, hyphens)';
    }

    if (!form.image) {
      newErrors.image = 'Container image is required';
    } else if (!form.image.startsWith('harbor.')) {
      newErrors.image = 'Image must be from Harbor registry (harbor.*)';
    } else if (form.image.endsWith(':latest')) {
      newErrors.image = 'The :latest tag is not allowed — pin a specific version';
    }

    if (!form.team) {
      newErrors.team = 'Team is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [form.appName, form.image, form.team]);

  const submit = useCallback(async () => {
    if (!validate()) return;

    setSubmitting(true);
    setResult(null);

    const envMapped = form.env
      .filter((e) => e.name.trim())
      .map((e) => e.isSecret
        ? { name: e.name, secret: e.secret }
        : { name: e.name, value: e.value }
      );

    const response = await createDeploymentPR({
      appName: form.appName,
      appType: form.appType,
      image: form.image,
      port: form.port,
      team: form.team,
      resources: form.resources,
      ingress: form.ingress || undefined,
      database: form.database ? { enabled: true, size: form.databaseSize } : undefined,
      redis: form.redis ? { enabled: true, size: form.redisSize } : undefined,
      sso: form.sso || undefined,
      storage: form.storage || undefined,
      env: envMapped.length > 0 ? envMapped : undefined,
    });

    setSubmitting(false);
    setResult(response);
  }, [form, validate]);

  const reset = useCallback(() => {
    setForm(INITIAL_FORM);
    setErrors({});
    setResult(null);
  }, []);

  return { form, setField, addEnv, removeEnv, setEnvField, submit, submitting, result, reset, errors };
}
