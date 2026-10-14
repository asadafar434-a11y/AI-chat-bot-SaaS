import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from '../lib/icons';
import { IconButton, cx } from './ui';

// Поле пароля с глазиком: нажали — пароль виден, нажали ещё раз — снова точки. Это обычный input (тип меняется между password и text),
// поэтому подпись, autoComplete и менеджер паролей работают как раньше. Встроенный глазик Edge прячет index.css — иначе их было бы два.
export function PasswordInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input {...rest} type={shown ? 'text' : 'password'} className={cx(className, 'pr-11')} />
      <div className="absolute inset-y-0 right-2 flex items-center">
        <IconButton label={shown ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={shown} align="end" onClick={() => setShown((v) => !v)}>
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </IconButton>
      </div>
    </div>
  );
}
