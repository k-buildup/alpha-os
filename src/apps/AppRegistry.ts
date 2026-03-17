/**
 * AppRegistry — Application coordinator
 *
 * Replaces the monolithic AppManager with a thin registry that:
 * - Owns instances of all apps (composition over inheritance)
 * - Delegates tickRender to each app
 * - Provides convenience launchers
 * - Coordinates theme changes across all apps
 *
 * Open/Closed: New apps implement IApp and register here — no changes to existing apps.
 */

import type { IApp } from "./IApp.js";
import type { KernelServices } from "../services/KernelServices.js";
import { ClipboardService } from "../services/ClipboardService.js";
import { Theme } from "../ui/Theme.js";

import { isProtectedPath } from "../services/FileService.js";

// Apps
import { DesktopApp } from "./DesktopApp.js";
import { FileExplorerApp } from "./FileExplorerApp.js";
import { TextEditorApp } from "./TextEditorApp.js";
import { SettingsApp } from "./SettingsApp.js";
import { SystemInfoApp } from "./SystemInfoApp.js";
import { AllAppsLauncher } from "./AllAppsLauncher.js";
import { SaveAsDialog } from "./SaveAsDialog.js";

export class AppRegistry {
    readonly theme = new Theme();
    readonly clipboard: ClipboardService;

    // App instances
    readonly desktop:      DesktopApp;
    readonly fileExplorer:  FileExplorerApp;
    readonly textEditor:   TextEditorApp;
    readonly settings:     SettingsApp;
    readonly systemInfo:   SystemInfoApp;
    readonly allApps:      AllAppsLauncher;
    private readonly saveAs: SaveAsDialog;

    /** All registered apps for iteration */
    private readonly apps: IApp[];

    constructor(private readonly svc: KernelServices) {
        this.clipboard    = new ClipboardService(svc);

        this.desktop      = new DesktopApp(svc, this.theme, this);
        this.fileExplorer = new FileExplorerApp(svc, this.theme, this);
        this.textEditor   = new TextEditorApp(svc, this.theme, this.clipboard);
        this.settings     = new SettingsApp(svc, this.theme);
        this.systemInfo   = new SystemInfoApp(svc, this.theme);
        this.allApps      = new AllAppsLauncher(svc, this.theme, this);
        this.saveAs       = new SaveAsDialog(svc, this.theme, this.clipboard);

        // Wire up cross-app dependencies
        this.textEditor.setSaveAsOpener((winId) => this.openSaveAsFor(winId));
        this.settings.setOnThemeChanged(() => this.rerenderAll());

        this.apps = [
            this.desktop,
            this.fileExplorer,
            this.textEditor,
            this.settings,
            this.systemInfo,
            this.allApps,
        ];
    }

    // ─── Tick ────────────────────────────────────────────────────────────────

    tickRender(): void {
        for (const app of this.apps) {
            app.tickRender?.();
        }
    }

    // ─── Launchers (called by apps, dock, context menus) ─────────────────────

    openFileExplorer(path?: string): number {
        return this.fileExplorer.open(path);
    }

    openTextEditor(filePath: string): number {
        return this.textEditor.openFile(filePath);
    }

    openNewTextEditor(dirPath?: string): number {
        return this.textEditor.newFile(dirPath);
    }

    openSettings(): number {
        return this.settings.open();
    }

    openSystemInfo(): number {
        return this.systemInfo.open();
    }

    openAllApps(): void {
        this.allApps.open();
    }

    openTerminal(): void {
        this.svc.attachTerminal(-1); // -1 = create new
    }

    private openSaveAsFor(editorWinId: number): void {
        const st = this.textEditor.getEditorState(editorWinId);
        if (!st) return;
        this.saveAs.open(
            editorWinId,
            st.lines,
            st.path,
            (savedPath) => {
                st.path = savedPath;
                st.modified = false;
                const win = this.svc.getWindow(editorWinId);
                if (win) win.title = savedPath.split("/").pop() ?? savedPath;
                this.textEditor.render(editorWinId);
            },
        );
    }

    // ─── Desktop wiring ──────────────────────────────────────────────────────

    renderDesktop(winId: number): void {
        this.desktop.render(winId);
    }

    handleDesktopClick(x: number, y: number, _dbl: boolean): void {
        this.desktop.handleClick(x, y);
    }

    handleDesktopSelect(x: number, y: number, ctrl: boolean, shift: boolean): void {
        this.desktop.handleSelect(x, y, ctrl, shift);
    }

    deleteDesktopSelected(): void {
        this.desktop.deleteSelected();
    }

    desktopBuildContextMenu(x: number, y: number) {
        return this.desktop.buildContextMenu(x, y);
    }

    // ─── File Explorer wiring ────────────────────────────────────────────────

    get feState(): Map<number, unknown> {
        // Backward-compatible accessor for renderer drag-and-drop
        return this.fileExplorer["state"] as Map<number, unknown>;
    }

    feBuildContextMenu(winId: number, lx: number, ly: number) {
        return this.fileExplorer.buildContextMenu(winId, lx, ly);
    }

    feHandleDrop(fromWinId: number, toWinId: number, entryIdx: number): void {
        this.fileExplorer.unifiedDrop({
            srcKind: "fe", srcWinId: fromWinId, srcIdx: entryIdx,
            srcPath: "", toWinId, dropRowVi: -1,
        });
    }

    unifiedDrop(msg: {
        srcKind: "fe" | "desktop"; srcWinId: number; srcIdx: number;
        srcPath: string; toWinId: number; dropRowVi: number;
    }): void {
        // For desktop drag: collect which items are selected so FE can move all of them
        const desktopSelectedIndices: number[] | undefined =
            msg.srcKind === "desktop"
                ? [...(this.desktop["selectedSet"] as Set<number>)]
                : undefined;

        this.fileExplorer.unifiedDrop({ ...msg, desktopSelectedIndices });

        // Re-render desktop if it was involved
        if (msg.srcKind === "desktop" || msg.toWinId === -1) {
            this.desktop.clearSelection();
            const did = this.desktop["winId"] as number;
            if (did >= 0) this.desktop.render(did);
        }
    }

    // ─── Editor wiring ───────────────────────────────────────────────────────

    get edState(): Map<number, unknown> {
        return this.textEditor["state"] as Map<number, unknown>;
    }

    pasteText(winId: number, text: string): void {
        // Try clipboard service first (for InputField pastes)
        if (this.clipboard.resolvePaste(winId, text)) return;
        // Otherwise paste into text editor
        this.textEditor.pasteText(winId, text);
    }

    _editorSelectAll(winId: number): void { this.textEditor.selectAll(winId); }
    _editorCopy(winId: number): void { this.textEditor.copySelection(winId); }
    _saveEditorPublic(winId: number): void { this.textEditor.savePublic(winId); }
    _saveEditorAs(winId: number): void { this.openSaveAsFor(winId); }

    /** Backward-compatible alias for simulator/main.js */
    newTextFile(dirPath?: string): number { return this.openNewTextEditor(dirPath); }
    /** Backward-compatible alias */
    openTextViewer(filePath: string): number { return this.openTextEditor(filePath); }

    _isProtected(path: string): boolean {
        return isProtectedPath(path);
    }

    _newTerminal(): void { this.openTerminal(); }

    // ─── Theme change: re-render all open windows ────────────────────────────

    private rerenderAll(): void {
        // Sync shell dark mode
        this.svc.setShellDarkMode(this.theme.isDark);

        // Re-render all apps
        for (const app of this.apps) {
            for (const win of this.svc.listWindows()) {
                if (app.ownsWindow(win.id)) {
                    app.render(win.id);
                }
            }
        }

        // Re-render shell sessions
        this.svc.rerenderShellSessions();
    }
}
