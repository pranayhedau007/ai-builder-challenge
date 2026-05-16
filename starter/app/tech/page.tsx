import Link from "next/link";

const WORKFLOWS = [
  {
    href: "/tech/receive",
    title: "Receive",
    desc: "Scan an incoming asset. Creates it if new; idempotent if already received with the same serial.",
  },
  {
    href: "/tech/store",
    title: "Store",
    desc: "Move an asset into storage. Scan asset, then scan storage location.",
  },
  {
    href: "/tech/deploy",
    title: "Deploy",
    desc: "Put an asset into service. Requires a full rack location including rack unit.",
  },
  {
    href: "/tech/transfer",
    title: "Transfer custody",
    desc: "Hand off an asset to another tech or manager. Scan asset, then scan their badge.",
  },
] as const;

export default function TechLandingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Scan workflows</h1>
        <p className="text-gray-500 text-sm mt-1">
          Pick the workflow for what you&apos;re doing. Each page handles one scan
          at a time.
        </p>
      </div>

      <div className="grid gap-3">
        {WORKFLOWS.map((w) => (
          <Link
            key={w.href}
            href={w.href}
            className="flex items-start gap-3 p-4 rounded-lg border hover:border-blue-400 hover:bg-blue-50 transition-colors min-h-[44px]"
          >
            <div>
              <p className="font-semibold text-gray-900">{w.title}</p>
              <p className="text-sm text-gray-500 mt-0.5">{w.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
