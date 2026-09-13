/* 深淺色主題。開頁時的套用在 index.html 的行內腳本就做完了（避免白畫面閃一下），
   這裡只負責使用者按下切換鈕之後的事。 */

import { useCallback, useEffect, useState } from 'react';
import { applyTheme, loadTheme, saveTheme, type ThemeChoice } from '../lib/storage';

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(loadTheme);

  useEffect(() => {
    applyTheme(choice);
    saveTheme(choice);
  }, [choice]);

  const isDark = choice === 'dark'
    || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const toggle = useCallback(() => {
    setChoice(isDark ? 'light' : 'dark');
  }, [isDark]);

  return { choice, isDark, toggle };
}
