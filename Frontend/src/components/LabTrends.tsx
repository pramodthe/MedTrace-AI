import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import type { LabTrend } from '@/lib/types';

interface LabTrendsProps {
  labs: LabTrend[];
}

export function LabTrends({ labs }: LabTrendsProps) {
  return (
    <section className="clinical-panel flex h-full min-h-[360px] flex-col overflow-hidden">
      <div className="border-b border-border bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="clinical-section-title">Temporal Lab Trends</h2>
          <span className="clinical-chip border-blue-200 bg-blue-50 text-primary">Evidence linked</span>
        </div>
      </div>
      <div className="flex-1 overflow-x-auto p-4">
        {labs.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-xs text-slate-500">
            No lab values detected in Zep memory yet.
          </p>
        ) : (
          <>
            <table className="w-full text-left">
              <thead className="border-b border-slate-100 text-[11px] uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="pb-2 font-semibold">Metric</th>
                  <th className="pb-2 font-semibold">Value</th>
                  <th className="hidden pb-2 font-semibold sm:table-cell">Range</th>
                  <th className="pb-2 font-semibold">Trend</th>
                </tr>
              </thead>
              <tbody className="text-xs">
                {labs.map((lab) => (
                  <tr
                    key={lab.test}
                    className="border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50/80"
                  >
                    <td className="py-3">
                      <p className="font-semibold text-slate-800">{lab.test}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">{lab.date ?? ''}</p>
                    </td>
                    <td className="py-3">
                      <span
                        className={`${
                          lab.status === 'High' ? 'text-red-600 font-bold' : 'text-slate-700'
                        }`}
                      >
                        {lab.latest}
                      </span>
                      {lab.previous && (
                        <p className="mt-0.5 font-mono text-[10px] text-slate-400">Prev {lab.previous}</p>
                      )}
                    </td>
                    <td className="hidden py-3 font-mono text-[11px] text-slate-500 sm:table-cell">
                      {lab.range ?? '-'}
                    </td>
                    <td
                      className={`py-3 flex items-center gap-1.5 ${
                        lab.trend === 'Worsening'
                          ? 'text-red-500'
                          : lab.trend === 'Improving'
                            ? 'text-emerald-500'
                            : 'text-slate-500'
                      }`}
                    >
                      {lab.trend === 'Worsening' ? (
                        <TrendingUp size={14} className="text-red-400" />
                      ) : lab.trend === 'Improving' ? (
                        <TrendingDown size={14} className="text-emerald-400" />
                      ) : (
                        <Minus size={14} />
                      )}
                      <span className="font-medium">{lab.trend}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {labs[0] && (
              <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                <p className="text-[11px] font-medium leading-5 text-blue-900">
                  Latest {labs[0].test} = {labs[0].latest}
                  {labs[0].previous ? `, previously ${labs[0].previous}` : ''} ({labs[0].trend.toLowerCase()}
                  ).
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
