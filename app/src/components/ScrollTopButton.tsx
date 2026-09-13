import { useEffect, useState } from 'react';

export function ScrollTopButton() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 400);
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    return () => removeEventListener('scroll', onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="回到頂部"
      onClick={() => scrollTo({ top: 0, behavior: 'smooth' })}
      className={`fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30
                  grid h-11 w-11 place-items-center rounded-full border border-line
                  bg-surface text-lg text-ink shadow-lg transition-all
                  ${show ? 'opacity-100' : 'pointer-events-none translate-y-2 opacity-0'}`}
    >
      ↑
    </button>
  );
}
