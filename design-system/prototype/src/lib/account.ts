import { createContext, useContext } from 'react';

// Кто вошёл и как выйти. Контекст лежит отдельно от экрана входа (real/auth.tsx), чтобы боковое меню не зависело от запросов к серверу.
export type Account = { email: string | null; logout: () => void };

export const AccountContext = createContext<Account | null>(null);

/** null — вход не используется (закупки хранятся только в браузере): блока «Выйти» нет. */
export const useAccount = () => useContext(AccountContext);
