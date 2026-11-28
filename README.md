# Rio Terminal · DeepSeek Harness

English | [中文](README.zh.md)

Use an interactive terminal in the right sidebar of DeepSeek Harness (DSH), launching a shell in the current session's working directory. Rio terminal runs alongside DSH's built-in terminal and does not take over the Agent's terminal.

- Supports keyboard input, paste, text selection, scrolling, and searching terminal output.
- Restores the still-running terminal after switching tabs or refreshing the page.
- Configurable fonts, colors, padding, and DOM / Canvas renderers.
- Bundles the terminal engine with the plugin—nothing is downloaded from a CDN at runtime.

> **Execution permissions:** This is a user terminal operated directly by you. Commands run on the machine hosting DSH with the privileges of the system user running DSH, bypassing the Agent's approval flow. When connected to a remote DSH instance, commands do not run on the computer running your browser.

## Installation

Requires a DSH instance with working terminal support and a browser or DSH desktop client that supports WebAssembly. The page's security policy must allow running the WebAssembly module bundled with the plugin.

In DSH, open **Plugins → Add plugin** and enter `dsh-plugin-rioterm` to install. For the `web` profile, you can also run:

```sh
dsh plugin --profile web add dsh-plugin-rioterm
```

Follow the installation prompt to enable or restart DSH, then select **+ → Rio terminal** in the right sidebar.

## Getting Started

After opening a Rio tab, wait for the shell prompt to appear and start typing commands. If **Start shell** is shown, click it to begin.

- **Switching tabs or refreshing the page:** Restores the same terminal as long as the DSH backend is still running and the original shell has not exited. By default, switching back to a tab automatically focuses it.
- **Resizing:** Automatically fits the panel size by default. When making the panel taller, earlier scrollback history may reappear at the top—history is not discarded to pin the prompt's position.
- **Closing a tab:** Requests termination of that tab's shell; merely collapsing the sidebar does not terminate it.
- **Opening links:** Hold `⌘` (macOS) or `Ctrl` and click a detected link, then confirm the target URL to open it. A plain click does not open links.

Keyboard controls for full-screen terminal applications such as Vim are supported. Mouse clicks and drags are not currently forwarded to terminal applications.

### Finding Terminal Output

Press `⌘F` (macOS) or `Ctrl+Shift+F` inside the terminal to open find. Plain `Ctrl+F` remains reserved for the shell or terminal applications.

| Action         | Shortcut      |
| -------------- | ------------- |
| Next match     | `Enter`       |
| Previous match | `Shift+Enter` |
| Close find     | `Esc`         |

Search is case-sensitive and performs a literal match against the current tab's screen and retained scrollback history (regular expressions are not supported). Matches wrap around from end to start; `2 / 5` indicates the 2nd match out of 5, and counts above 1,000 display as `1000+`. Find does not search other tabs or discarded history, and never sends your query to the shell.

The search icon is hidden by default. To open find with a mouse, turn on **Rio terminal settings → Interaction → Always show the search icon**; this does not change the keyboard shortcuts.

### Disconnection and Read-Only Mode

When disconnected, the existing screen output remains visible, but input is temporarily disabled. Once the connection recovers, a visible tab that was previously writable attempts to reconnect to the original shell; hidden tabs reconnect when shown again. You can also click **Reconnect**—this does not start a new shell or resend unconfirmed input from before the disconnect.

When another window controls the same terminal, the current window can only view output and search. To type, click **Take input control**. Read-only windows do not automatically take over after a disconnect.

If the DSH backend has restarted, the shell has exited, or the original process can no longer be recovered, open a new terminal manually. The plugin never silently creates a replacement shell.

## Settings

Open **Plugins → Installed plugins → Rio terminal**. Settings apply only to Rio tabs and do not affect DSH's built-in terminal.

Dropdowns, toggles, and color pickers save automatically and immediately; font, numeric, and color text fields save roughly 600 ms after you stop typing or when the field loses focus. Invalid values are not saved. The font and color sections provide live previews without needing to open a terminal first.

Modified options can be individually reverted with **Reset to default** to inherit their default values again; **Restore defaults…** in the header asks for confirmation. Changing display settings does not start a new shell or reconnect open terminals.

| Setting             | Description                                                                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Font & size         | Independently inherit the terminal settings from **DSH Settings → General → More font settings**. Changing only the size does not lock the font family; clearing a field resumes inheritance. Uses local fonts only and never downloads fonts. |
| Colors              | Text, background, cursor, selection, and the 16 ANSI colors can each be overridden independently; resetting one does not affect the others.                                                                                            |
| Renderer            | Defaults to DOM, with Canvas available. Canvas supports cursor shape and predictive local echo; prediction is off by default and only shows placeholders for unconfirmed input—actual characters still come from shell output.         |
| Terminal padding    | Top, right, bottom, and left can each be set from 0 to 64 px (defaults: 16 / 8 / 8 / 8); set all to 0 for edge-to-edge display.                                                                                                       |
| Auto-focus & sizing | Automatically focuses the terminal when opening or switching back to its tab and fits available space by default. Both can be turned off independently; turning off auto-fit preserves the host grid dimensions.                       |
| Keyboard & links    | Configure **Use Alt as Meta** and toggle plain-text URL recognition.                                                                                                                                                                   |
| Scrollback history  | Leave blank to inherit the limit provided by DSH; `0` keeps no history. A new limit takes effect the next time a screen is created or restored and does not immediately clear existing history.                                        |

### Default Colors and Bold Text

Personal overrides take precedence over Rio presets configured in the DSH profile; without overrides, colors inherit as follows:

| Color                               | Default source                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| Text, background                    | DSH interface primary text and base background colors, adapting to theme changes.     |
| Cursor                              | The text color currently used by Rio.                                                 |
| Selected text, selection background | System selection colors provided by the browser.                                      |
| 16 ANSI colors                      | Defaults to the **Rio default** palette; **DSH built-in terminal** is also available. |

To make bold directory names in `ls` look closer to the built-in terminal, set **ANSI palette** to **DSH built-in terminal** and keep **Use bright colors for bold text → Follow palette**. With **Rio default**, bold text is weighted without shifting color by default; you can also choose **Always on** or **Always off**. This only affects the 8 base ANSI foreground colors, not backgrounds or truecolor, and visual parity between the two terminals is not guaranteed.

Text and background colors can be edited at the top of **Terminal colors**; cursor and selection colors are under **Customize cursor and selection**. The color picker supports RGB, HEX, and opacity, plus screen color picking where supported by the platform. 3- and 6-digit HEX values are opaque, while 4- and 8-digit values include opacity. Press `Esc` to discard uncommitted HEX text without undoing an already saved selection.

## Troubleshooting

- **Unable to load the terminal engine:** View the technical details, check your connection, and click **Retry**. If the message says the engine could not be started, fix the underlying error and reload the entire DSH window—not just the terminal tab. Do not disable the page's security policy to work around this.
- **Terminal is visible but ignores input:** Check whether it is disconnected or in read-only mode, and follow the prompt to reconnect or take input control.
- **Original terminal is missing after refresh:** Recovery requires the original DSH backend and shell to still be alive. After a backend restart, open a new terminal manually.
- **Find shortcut conflicts with another binding:** Enable **Always show the search icon** and click the magnifying glass icon instead.

## Feedback & Third-Party Components

When reporting an issue, please include your DSH and plugin versions, operating system, steps to reproduce, and any error details shown in the UI. Remove credentials and private information from terminal output before sharing screenshots or logs. Report issues in [GitHub Issues](https://github.com/noctisynth/dsh-plugin-rioterm/issues); source code and release history are in the [project repository](https://github.com/noctisynth/dsh-plugin-rioterm).

This plugin is an independent DSH extension powered by the Rio terminal engine and does not imply official endorsement by the Rio project. Licensed under the [MIT License](LICENSE); licenses and notices for third-party components are provided in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).
