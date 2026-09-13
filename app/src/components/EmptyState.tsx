export function EmptyState({ title, hint, icon = '🔍' }:
  { title: string; hint: string; icon?: string }) {
  return (
    <div className="py-14 text-center text-muted">
      <span aria-hidden="true" className="mb-2 block text-4xl opacity-50">{icon}</span>
      <h3 className="mb-1 text-base font-bold text-ink">{title}</h3>
      <p className="text-sm">{hint}</p>
    </div>
  );
}
