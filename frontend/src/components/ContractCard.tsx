import Link from "next/link";
import formatCurrency, { firstNonEmptyText, extractCurrencyLikeText, extractTimelineLikeText, parseNumber } from "@/lib/formatters/number";

interface Contract {
  contract_id: string;
  title: string;
  description: string;
  budget: string;
  deadline: string;
  status: string;
  posted_by_name?: string;
  industry?: string;
  poster_verified?: boolean;
}

export default function ContractCard({ contract }: { contract: Contract }) {
  const budgetDisplay = firstNonEmptyText(contract.budget, extractCurrencyLikeText(contract.description)) || contract.budget || "TBD";
  const deadlineDisplay = firstNonEmptyText(contract.deadline, extractTimelineLikeText(contract.description)) || contract.deadline || "TBD";
  const budgetNumber = parseNumber(budgetDisplay);

  return (
    <Link href={`/contracts/${contract.contract_id}`} className="block group">
      <div className="card !p-0 overflow-hidden hover:border-[var(--primary)]/20 transition-all">
        <div className="flex items-stretch">
          {/* Status accent bar */}
          <div className={`w-1 shrink-0 ${contract.status === "open" ? "bg-[var(--primary)]" : contract.status === "closed" ? "bg-gray-400" : "bg-amber-500"}`} />

          <div className="flex-1 px-5 py-4">
            {/* Title + Status */}
            <div className="flex items-center gap-2.5 mb-1.5">
              <h3 className="font-semibold text-[var(--foreground)] text-[15px] group-hover:text-[var(--primary)] transition-colors truncate">
                {contract.title}
              </h3>
              <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded shrink-0 ${
                contract.status === "open" ? "bg-[var(--primary-light)] text-[var(--primary)]"
                  : contract.status === "closed" ? "bg-gray-500/10 text-gray-400"
                  : "bg-amber-500/10 text-amber-500"
              }`}>
                {contract.status}
              </span>
            </div>

            {/* Description */}
            <p className="text-sm text-[var(--muted)] line-clamp-2 leading-relaxed mb-3">{contract.description}</p>

            {/* Meta row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-[var(--surface)] border border-[var(--divider)] min-w-0">
                <svg className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                <span className="font-semibold text-[var(--foreground)] truncate">
                  {budgetNumber > 0 ? formatCurrency(budgetNumber) : budgetDisplay}
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-[var(--surface)] border border-[var(--divider)] min-w-0 text-[var(--muted)]">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                </svg>
                <span className="truncate">{deadlineDisplay}</span>
              </div>
              {contract.industry && (
                <div className="flex items-center px-2.5 py-2 rounded-lg bg-[var(--primary-light)] min-w-0">
                  <span className="text-[var(--primary)] font-medium truncate">{contract.industry}</span>
                </div>
              )}
              {contract.posted_by_name && (
                <div className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-[var(--surface)] border border-[var(--divider)] min-w-0 text-[var(--muted)]">
                  <span className="truncate">{contract.posted_by_name}</span>
                  {contract.poster_verified && (
                    <svg className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

