import { app, Tray, Menu, nativeImage, Notification, BrowserWindow } from 'electron';
import path from 'path';

// Where a notification/tray click should land the user. Mirrors the
// renderer's ChatTarget so App.tsx can navigate straight to the thread.
export type ActivateTarget =
  | { kind: 'channel'; index: number }
  | { kind: 'dm'; nodeNum: number };

export interface NotifyPayload {
  title: string;
  body: string;
  /** Optional thread to open when the user clicks the notification. */
  target?: ActivateTarget;
}

/**
 * Owns the OS-shell surfaces for the app: the menu-bar / system-tray icon,
 * the dock / taskbar unread badge, and native notifications. Kept out of
 * main.ts so the window/IPC wiring there stays readable.
 *
 * The renderer remains the source of truth for "what's unread" and "should
 * we notify" (it knows which thread the user is staring at); this class just
 * renders that state into the OS shell and routes clicks back.
 */
export class SystemIntegration {
  private tray: Tray | null = null;
  private unread = 0;
  private connStatus = 'No device connected';
  /** Set true once the user really wants to exit (tray Quit / Cmd-Q), so the
   *  window-close handler knows to let the close through instead of hiding. */
  private quitting = false;
  /** When true, closing the window hides it to the tray instead of quitting.
   *  Source of truth is the renderer (localStorage), pushed in on mount; this
   *  is the safe default until that arrives. */
  private closeToTray = true;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    /** Forward a notification/tray click target to the renderer. */
    private readonly onActivate: (target: ActivateTarget) => void,
  ) {}

  isQuitting(): boolean { return this.quitting; }
  beginQuit(): void { this.quitting = true; }

  getCloseToTray(): boolean { return this.closeToTray; }
  setCloseToTray(enabled: boolean): void { this.closeToTray = !!enabled; }

  init(): void {
    if (this.tray) return;
    try {
      this.tray = new Tray(this.trayImage());
    } catch (e) {
      console.warn('[sys] could not create tray:', e);
      return;
    }
    this.tray.setToolTip('OpenKB Mesh');
    this.tray.on('click', () => this.toggleWindow());
    // Right-click reliably opens the menu on every platform; on macOS a
    // left-click pops it too via setContextMenu, but we keep the explicit
    // toggle on left-click for Windows/Linux ergonomics.
    this.rebuildMenu();
    console.log('[sys] tray ready');
  }

  /** Resolve the bundled app icon and size it for the tray. */
  private trayImage(): Electron.NativeImage {
    // In dev, __dirname is dist-electron/; assets live at the repo root.
    // Packaged builds copy assets/ into resources/ (electron-builder.yml).
    const find = (name: string) => {
      for (const base of [path.join(__dirname, '../assets'), path.join(process.resourcesPath ?? '', 'assets')]) {
        const img = nativeImage.createFromPath(path.join(base, name));
        if (!img.isEmpty()) return img;
      }
      return null;
    };

    // macOS menu bar: use the monochrome template glyph so it adapts to the
    // light/dark menu bar and isn't a dark square. createFromPath auto-loads
    // the trayTemplate@2x.png sibling for Retina displays.
    if (process.platform === 'darwin') {
      const tmpl = find('trayTemplate.png');
      if (tmpl) {
        tmpl.setTemplateImage(true);
        return tmpl;
      }
    }

    // Windows / Linux (or macOS fallback): the colored app icon at 16px.
    const colored = find('icon.png');
    if (colored) return colored.resize({ width: 16, height: 16 });

    console.warn('[sys] tray icon not found; using empty image');
    return nativeImage.createEmpty();
  }

  // ── Unread badge ──────────────────────────────────────────────────────
  /** Push the unread-message count from the renderer into the OS badge. */
  setUnread(count: number): void {
    const n = Math.max(0, Math.floor(count || 0));
    if (n === this.unread) return;
    this.unread = n;
    // macOS dock + Linux Unity launcher. No-op on Windows (we lean on the
    // tray tooltip + flashFrame there instead).
    try { app.setBadgeCount(n); } catch { /* unsupported platform */ }
    this.refreshTray();
  }

  // ── Connection status (drives tray tooltip/menu) ────────────────────────
  setConnectionStatus(text: string): void {
    if (text === this.connStatus) return;
    this.connStatus = text;
    this.refreshTray();
  }

  private refreshTray(): void {
    if (!this.tray) return;
    const unreadPart = this.unread > 0 ? ` · ${this.unread} unread` : '';
    this.tray.setToolTip(`OpenKB Mesh — ${this.connStatus}${unreadPart}`);
    this.rebuildMenu();
  }

  private rebuildMenu(): void {
    if (!this.tray) return;
    const win = this.getWindow();
    const visible = !!win && win.isVisible();
    const menu = Menu.buildFromTemplate([
      { label: this.connStatus, enabled: false },
      ...(this.unread > 0
        ? [{ label: `${this.unread} unread message${this.unread === 1 ? '' : 's'}`, enabled: false }]
        : []),
      { type: 'separator' },
      {
        label: visible ? 'Hide Window' : 'Show Window',
        click: () => (visible ? this.getWindow()?.hide() : this.showWindow()),
      },
      { type: 'separator' },
      {
        label: 'Quit OpenKB Mesh',
        click: () => { this.beginQuit(); app.quit(); },
      },
    ]);
    this.tray.setContextMenu(menu);
  }

  // ── Window helpers ──────────────────────────────────────────────────────
  showWindow(): void {
    const win = this.getWindow();
    if (!win) return;
    if (!win.isVisible()) win.show();
    if (win.isMinimized()) win.restore();
    win.focus();
    if (process.platform === 'darwin') app.focus({ steal: true });
    win.flashFrame(false);
    this.rebuildMenu();
  }

  private toggleWindow(): void {
    const win = this.getWindow();
    if (!win) return;
    if (win.isVisible() && !win.isMinimized()) win.hide();
    else this.showWindow();
    this.rebuildMenu();
  }

  // ── Native notifications ────────────────────────────────────────────────
  notify(payload: NotifyPayload): void {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: payload.title,
      body: payload.body,
      silent: false,
    });
    n.on('click', () => {
      this.showWindow();
      if (payload.target) {
        try { this.onActivate(payload.target); }
        catch (e) { console.warn('[sys] activate target failed:', e); }
      }
    });
    n.show();

    // If the window isn't focused, draw attention in the taskbar/dock. On
    // Windows flashFrame blinks the taskbar button; on macOS the dock bounces.
    const win = this.getWindow();
    if (win && !win.isFocused()) {
      win.flashFrame(true);
      if (process.platform === 'darwin') app.dock?.bounce('informational');
    }
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
