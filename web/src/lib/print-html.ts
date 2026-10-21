// Печать готовой страницы без новых окон: она открывается в невидимой рамке, и браузер показывает окно печати (в нём «Сохранить как PDF»). Файлы не скачиваются и никуда не отправляются.
export function printHtml(html: string) {
  document.querySelectorAll("iframe[data-print-frame]").forEach((old) => old.remove());
  const frame = document.createElement("iframe");
  frame.setAttribute("data-print-frame", "");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  const remove = () => setTimeout(() => frame.remove(), 1000);
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return remove();
    win.addEventListener("afterprint", remove);
    win.focus();
    win.print();
  };
  document.body.append(frame);
  frame.srcdoc = html;
}
