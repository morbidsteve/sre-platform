import { useState, useCallback, useRef } from 'react';
import { Upload, Package, FileArchive, X, CheckCircle2, AlertCircle, Loader2, Code, Database, Shield, HardDrive, ChevronDown, ChevronRight, Cpu, Globe, Lock } from 'lucide-react';
import type { BundleManifest, BundleUploadResult } from '../types';
import { uploadBundle } from '../api';

interface BundleUploaderProps {
  manifest: BundleManifest | undefined;
  uploadId: string | undefined;
  images: Array<{ name: string; file: string; sizeMB: number }> | undefined;
  sourceIncluded: boolean | undefined;
  onUploadComplete: (result: BundleUploadResult) => void;
  onRemove: () => void;
}

export function BundleUploader({ manifest, uploadId, images, sourceIncluded, onUploadComplete, onRemove }: BundleUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [showYaml, setShowYaml] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.tar.gz') && !file.name.endsWith('.tgz')) {
      setError('File must be a .tar.gz or .tgz archive');
      return;
    }
    if (file.size > 2 * 1024 * 1024 * 1024) {
      setError('File exceeds maximum size of 2GB');
      return;
    }

    setError(null);
    setUploading(true);
    setProgress(0);

    try {
      const result = await uploadBundle(file, setProgress);
      onUploadComplete(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [onUploadComplete]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // Uploaded state — show manifest summary
  if (manifest && uploadId) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <Package className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-100">{manifest.metadata.name}</h3>
                <p className="text-xs text-gray-400">v{manifest.metadata.version} — {manifest.metadata.team}</p>
              </div>
            </div>
            <button onClick={onRemove} className="p-1 text-gray-500 hover:text-gray-300 rounded-lg hover:bg-navy-700">
              <X className="w-4 h-4" />
            </button>
          </div>

          {manifest.metadata.description && (
            <p className="mt-3 text-sm text-gray-400">{manifest.metadata.description}</p>
          )}
          {manifest.metadata.author && (
            <p className="mt-1 text-xs text-gray-500">Author: {manifest.metadata.author}</p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3">
            {/* Images */}
            <div className="rounded-lg border border-navy-700 bg-navy-900 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
                <FileArchive className="w-3.5 h-3.5 text-cyan-400" />
                Images
              </div>
              <div className="mt-1.5 space-y-1">
                {(images || []).map((img) => (
                  <div key={img.file} className="text-xs text-gray-500">{img.name} ({img.sizeMB}MB)</div>
                ))}
              </div>
            </div>

            {/* Source code */}
            <div className="rounded-lg border border-navy-700 bg-navy-900 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
                <Code className="w-3.5 h-3.5 text-cyan-400" />
                Source Code
              </div>
              <div className="mt-1.5">
                {sourceIncluded ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" /> Included{manifest.spec.source?.language ? ` (${manifest.spec.source.language})` : ''}
                  </span>
                ) : (
                  <span className="text-xs text-gray-500">Not included</span>
                )}
              </div>
            </div>
          </div>

          {/* Services */}
          {manifest.spec.services && (
            <div className="mt-3 flex flex-wrap gap-2">
              {manifest.spec.services.database?.enabled && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-navy-700 text-gray-300">
                  <Database className="w-3 h-3" /> PostgreSQL {manifest.spec.services.database.size && `(${manifest.spec.services.database.size})`}
                </span>
              )}
              {manifest.spec.services.redis?.enabled && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-navy-700 text-gray-300">
                  <Database className="w-3 h-3" /> Redis {manifest.spec.services.redis.size && `(${manifest.spec.services.redis.size})`}
                </span>
              )}
              {manifest.spec.services.sso?.enabled && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-navy-700 text-gray-300">
                  <Shield className="w-3 h-3" /> SSO
                </span>
              )}
              {manifest.spec.services.storage?.enabled && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-navy-700 text-gray-300">
                  <HardDrive className="w-3 h-3" /> Storage
                </span>
              )}
            </div>
          )}

          {/* Classification */}
          {manifest.spec.classification && (
            <div className="mt-3">
              <span className="px-2 py-0.5 rounded text-xs font-mono bg-navy-700 text-amber-400">
                {manifest.spec.classification}
              </span>
            </div>
          )}

          {/* Runtime config */}
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-navy-700 bg-navy-900 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                Runtime
              </div>
              <div className="mt-1.5 space-y-0.5 text-xs text-gray-500">
                <div>Port: <span className="text-gray-300">{manifest.spec.app.port || 8080}</span></div>
                <div>Resources: <span className="text-gray-300">{manifest.spec.app.resources || 'small'}</span></div>
                {manifest.spec.app.ingress && <div>Ingress: <span className="text-gray-300">{manifest.spec.app.ingress}</span></div>}
              </div>
            </div>
            <div className="rounded-lg border border-navy-700 bg-navy-900 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
                <Lock className="w-3.5 h-3.5 text-cyan-400" />
                Security
              </div>
              <div className="mt-1.5 space-y-0.5 text-xs text-gray-500">
                <div>Non-root: <span className={manifest.spec.security?.runAsNonRoot === false ? 'text-amber-400' : 'text-emerald-400'}>{manifest.spec.security?.runAsNonRoot === false ? 'No (root)' : 'Yes'}</span></div>
                <div>Read-only FS: <span className={manifest.spec.security?.readOnlyRootFilesystem === false ? 'text-amber-400' : 'text-emerald-400'}>{manifest.spec.security?.readOnlyRootFilesystem === false ? 'No (writable)' : 'Yes'}</span></div>
              </div>
            </div>
            {manifest.spec.services?.storage?.enabled && (
              <div className="rounded-lg border border-navy-700 bg-navy-900 p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-gray-300">
                  <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
                  Storage
                </div>
                <div className="mt-1.5 space-y-0.5 text-xs text-gray-500">
                  <div>Size: <span className="text-gray-300">{manifest.spec.services.storage.size}</span></div>
                  <div>Mount: <span className="text-gray-300">{manifest.spec.services.storage.mountPath}</span></div>
                </div>
              </div>
            )}
          </div>

          {/* Collapsible YAML manifest */}
          <div className="mt-4">
            <button
              onClick={() => setShowYaml(!showYaml)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors"
            >
              {showYaml ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              bundle.yaml
            </button>
            {showYaml && (
              <pre className="mt-2 p-3 rounded-lg bg-navy-950 border border-navy-700 text-xs text-gray-400 overflow-x-auto max-h-64 overflow-y-auto font-mono">
                {JSON.stringify(manifest, null, 2)}
              </pre>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-500">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          Bundle uploaded successfully — ID: {uploadId.slice(0, 12)}...
        </div>
      </div>
    );
  }

  // Uploading state
  if (uploading) {
    return (
      <div className="rounded-xl border border-navy-700 bg-navy-800 p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
          <div className="flex-1">
            <div className="text-sm text-gray-200">Uploading bundle...</div>
            <div className="mt-2 h-2 rounded-full bg-navy-700 overflow-hidden">
              <div className="h-full rounded-full bg-cyan-500 transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-1 text-xs text-gray-500">{progress}%</div>
          </div>
        </div>
      </div>
    );
  }

  // Empty state — dropzone
  return (
    <div className="space-y-2">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          dragOver
            ? 'border-cyan-500 bg-cyan-500/5'
            : 'border-navy-600 bg-navy-800/50 hover:border-navy-500'
        }`}
      >
        <Upload className={`w-8 h-8 mx-auto ${dragOver ? 'text-cyan-400' : 'text-gray-500'}`} />
        <p className="mt-3 text-sm text-gray-300">
          Drag & drop a <code className="text-cyan-400">.bundle.tar.gz</code> file here
        </p>
        <p className="mt-1 text-xs text-gray-500">or click to browse — max 2GB</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".tar.gz,.tgz"
          onChange={handleInputChange}
          className="hidden"
        />
      </div>
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}
    </div>
  );
}
