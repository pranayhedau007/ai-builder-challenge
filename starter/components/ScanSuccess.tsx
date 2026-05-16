interface ScanSuccessProps {
  // "success" = green (new action completed)
  // "neutral" = blue (idempotent — nothing changed, all is well)
  variant?: "success" | "neutral";
  title: string;
  assetName: string;
  assetTag: string;
  detail: string;
  // Shown when the primary scan succeeded but a write-back to fac/finance failed
  warningText?: string;
  onReset: () => void;
}

export function ScanSuccess({
  variant = "success",
  title,
  assetName,
  assetTag,
  detail,
  warningText,
  onReset,
}: ScanSuccessProps) {
  const isNeutral = variant === "neutral";

  return (
    <div
      className={`rounded-2xl p-8 space-y-5 text-center ${
        isNeutral
          ? "bg-blue-50 border-2 border-blue-200"
          : "bg-green-50 border-2 border-green-200"
      }`}
    >
      <div
        className={`text-6xl leading-none ${isNeutral ? "text-blue-500" : "text-green-500"}`}
        aria-hidden="true"
      >
        {isNeutral ? "●" : "✓"}
      </div>

      <div className="space-y-1">
        <h2
          className={`text-3xl font-bold ${isNeutral ? "text-blue-900" : "text-green-900"}`}
        >
          {title}
        </h2>
        <p className="text-lg font-medium text-gray-900">{assetName}</p>
        <p className="text-sm font-mono text-gray-500">{assetTag}</p>
      </div>

      <p
        className={`text-base leading-relaxed ${isNeutral ? "text-blue-800" : "text-green-800"}`}
      >
        {detail}
      </p>

      {warningText && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          {warningText}
        </p>
      )}

      <button
        type="button"
        onClick={onReset}
        className="w-full py-4 rounded-xl bg-gray-900 text-white font-semibold text-lg min-h-[52px]"
      >
        Scan another
      </button>
    </div>
  );
}
