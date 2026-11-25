// Replaced with compiled, scoped Tailwind CSS by tsdown. No browser compiler or CSS request.
declare const __RIO_UI_CSS__: string;

/** One stylesheet per plugin activation, shared by every guide and terminal in this document. */
export function installUiStyles(): () => void {
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-plugin-rioterm';
  tag.dataset.pluginCss = 'dsh-plugin-rioterm/terminal-ui';
  tag.textContent = __RIO_UI_CSS__;
  document.head.appendChild(tag);
  return () => tag.remove();
}
