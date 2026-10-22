import { useCallback, useSyncExternalStore } from 'react';
import { readAiEnabled, saveAiEnabled, subscribeAiMode } from '@/lib/ai-mode';

// Включён ли ИИ и как его переключить; значение держится в этом браузере и одинаково во всех местах экрана (общий код — web/src/lib/ai-mode.ts).
// Хук лежит здесь, а не в web/src: у экрана своя копия React, и общий код её не приносит.
export function useAiEnabled(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeAiMode, () => readAiEnabled(), () => true);
  const set = useCallback((next: boolean) => saveAiEnabled(next), []);
  return [on, set];
}
