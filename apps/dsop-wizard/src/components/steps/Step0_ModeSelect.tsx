import { useState } from 'react';
import { Zap, ShieldCheck, Package } from 'lucide-react';

interface Step0Props {
  onSelectMode: (mode: 'full' | 'easy' | 'bundle') => void;
}

export function Step0_ModeSelect({ onSelectMode }: Step0Props) {
  const [selected, setSelected] = useState<'full' | 'easy' | 'bundle' | null>(null);

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-100">How would you like to deploy?</h2>
        <p className="mt-2 text-sm text-gray-400">Choose a deployment path based on your needs.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        {/* Quick Deploy card */}
        <button
          onClick={() => setSelected('easy')}
          className={`text-left rounded-xl border p-6 transition-all ${
            selected === 'easy'
              ? 'border-cyan-500 bg-cyan-500/10 ring-1 ring-cyan-500 shadow-lg shadow-cyan-500/10'
              : 'border-navy-700 bg-navy-800 hover:border-navy-600'
          }`}
        >
          <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
            selected === 'easy' ? 'bg-cyan-500/20' : 'bg-navy-700'
          }`}>
            <Zap className={`w-6 h-6 ${selected === 'easy' ? 'text-cyan-400' : 'text-gray-400'}`} />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-gray-100">Quick Deploy</h3>
          <p className="mt-2 text-sm text-gray-400 leading-relaxed">
            I already have a container image in Harbor that has been scanned and signed.
            Just deploy it to the cluster.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {['Configure', 'Review', 'Deploy'].map((s) => (
              <span key={s} className="px-2 py-0.5 rounded text-xs font-mono bg-navy-700 text-gray-400">{s}</span>
            ))}
          </div>
        </button>

        {/* Full Pipeline card */}
        <button
          onClick={() => setSelected('full')}
          className={`text-left rounded-xl border p-6 transition-all ${
            selected === 'full'
              ? 'border-cyan-500 bg-cyan-500/10 ring-1 ring-cyan-500 shadow-lg shadow-cyan-500/10'
              : 'border-navy-700 bg-navy-800 hover:border-navy-600'
          }`}
        >
          <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
            selected === 'full' ? 'bg-cyan-500/20' : 'bg-navy-700'
          }`}>
            <ShieldCheck className={`w-6 h-6 ${selected === 'full' ? 'text-cyan-400' : 'text-gray-400'}`} />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-gray-100">Full Security Pipeline</h3>
          <p className="mt-2 text-sm text-gray-400 leading-relaxed">
            Run the complete RAISE 2.0 security pipeline: SAST, secrets scanning, CVE analysis,
            SBOM generation, ISSM review, and image signing.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {['Source', 'App Info', 'Detection', 'Security', 'Review', 'Deploy', 'Complete'].map((s) => (
              <span key={s} className="px-2 py-0.5 rounded text-xs font-mono bg-navy-700 text-gray-400">{s}</span>
            ))}
          </div>
        </button>

        {/* Create Bundle card */}
        <button
          onClick={() => setSelected('bundle')}
          className={`text-left rounded-xl border p-6 transition-all ${
            selected === 'bundle'
              ? 'border-cyan-500 bg-cyan-500/10 ring-1 ring-cyan-500 shadow-lg shadow-cyan-500/10'
              : 'border-navy-700 bg-navy-800 hover:border-navy-600'
          }`}
        >
          <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
            selected === 'bundle' ? 'bg-cyan-500/20' : 'bg-navy-700'
          }`}>
            <Package className={`w-6 h-6 ${selected === 'bundle' ? 'text-cyan-400' : 'text-gray-400'}`} />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-gray-100">Create Bundle</h3>
          <p className="mt-2 text-sm text-gray-400 leading-relaxed">
            Package your app for offline transfer to air-gapped environments or vendor handoff.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {['Configure', 'Review', 'Download'].map((s) => (
              <span key={s} className="px-2 py-0.5 rounded text-xs font-mono bg-navy-700 text-gray-400">{s}</span>
            ))}
          </div>
        </button>
      </div>

      {selected && (
        <div className="flex justify-center">
          <button
            onClick={() => onSelectMode(selected)}
            className="px-6 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition-colors"
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
