import { useEffect, useState } from 'react';

// QR-код для приложения-аутентификатора. Рисуется здесь же, в браузере: секрет никуда не отправляется. Библиотека подгружается только
// когда человек включает двухфакторный вход. Фон белый с полем вокруг в любой теме — иначе камера телефона код не прочтёт.
export function QrCode({ value, size = 176 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setSrc(null);
    setFailed(false);
    import('qrcode')
      .then((qr) => qr.toDataURL(value, { width: size * 2, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }))
      .then((url) => live && setSrc(url))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [value, size]);

  if (failed) return <p className="text-[13px] text-muted-foreground">Не получилось нарисовать QR-код — введите ключ вручную.</p>;
  return src ? (
    <img src={src} width={size} height={size} alt="QR-код для приложения-аутентификатора" className="rounded-md border border-border bg-white" />
  ) : (
    <div style={{ width: size, height: size }} className="animate-pulse rounded-md border border-border bg-secondary" aria-hidden />
  );
}
