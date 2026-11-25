import { createAppearance } from './plugin/appearance.ts';
import type { ClientContext } from './plugin/context.ts';
import { createPreferenceEditor } from './plugin/preferences.ts';
import { registerSettingsPage } from './plugin/settings-page.ts';
import { registerTerminalSidebar } from './plugin/sidebar.ts';
import { installUiStyles } from './plugin/ui-styles.ts';
import { RioSessions } from './session/registry.ts';

export const inject = [
  'slots',
  'locale',
  'sidebarRightTabs',
  'sidebarRight',
  'remote',
  'remote.terminal',
  'configForms',
  'theme',
];

/** DSH client entry: one session registry per window; no page or PTY is mounted here. */
export function apply(ctx: ClientContext): void {
  const sessions = new RioSessions(ctx.remote.terminal, () => localStorage);
  ctx.effect(
    () => () => sessions.dispose(),
    'dsh-plugin-rioterm: release attachments',
  );
  ctx.effect(installUiStyles, 'dsh-plugin-rioterm: scoped UI stylesheet');
  const editor = createPreferenceEditor(ctx.configForms);
  const appearance = createAppearance(ctx, editor);
  registerSettingsPage(ctx, editor, appearance.hostFonts);
  registerTerminalSidebar(ctx, sessions, appearance);
}
