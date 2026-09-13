/** 收藏星號。aria-pressed 讓螢幕報讀器知道目前狀態。 */
export function FavButton({
  code, active, onToggle,
}: { code: string; active: boolean; onToggle: (code: string) => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${active ? '取消收藏' : '加入收藏'} ${code}`}
      onClick={() => onToggle(code)}
      className={`grid h-8 w-8 place-items-center rounded-full text-base leading-none
                  transition-colors hover:bg-hover
                  ${active ? 'text-star' : 'text-faint'}`}
    >
      {active ? '★' : '☆'}
    </button>
  );
}
