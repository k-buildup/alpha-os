/**
 * IApp — Application interface
 *
 * Every app implements this. The AppRegistry uses it to manage lifecycle.
 * Open/Closed Principle: adding a new app only requires implementing IApp
 * and registering it — no changes to existing code.
 */

export interface IApp {
    /** Unique app identifier */
    readonly appId: string;

    /** Render the app's content into its window */
    render(winId: number): void;

    /** Called every tick for animation (cursor blink, live updates) */
    tickRender?(): void;

    /** Cleanup when window is destroyed */
    destroy(winId: number): void;

    /** Returns true if this app owns the given window */
    ownsWindow(winId: number): boolean;
}
