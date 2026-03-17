/**
 * AlphaOS bare-metal boot entry.
 * Compiled separately and bundled with `pkg` into a native binary.
 */
import { Kernel } from "../src/kernel/Kernel.js";
import { FramebufferBackend } from "../src/drivers/FramebufferBackend.js";

async function main(): Promise<void> {
    const kernel = new Kernel({
        displayWidth:  1024,
        displayHeight: 768,
        memorySize:    256 * 1024 * 1024,
        tickRate:      30,
        debug:         process.env["DEBUG"] === "1",
    });

    const fb = new FramebufferBackend(kernel);

    process.on("uncaughtException", (err: Error) => {
        process.stderr.write(`[PANIC] ${err.message}\n${err.stack ?? ""}\n`);
        process.exit(1);
    });

    process.on("SIGINT",  () => kernel.shutdown(0));
    process.on("SIGTERM", () => kernel.shutdown(0));

    kernel.on("shutdown", ({ exitCode }: { exitCode: number }) => {
        fb.destroy();
        process.stdout.write("\n[AlphaOS] System halted.\n");
        process.exit(exitCode);
    });

    await fb.initialize("/dev/fb0");
    await kernel.boot();

    process.stdout.write("[boot] AlphaOS kernel running in bare-metal mode\n");
}

main().catch((err: unknown) => {
    process.stderr.write(`[boot] Fatal: ${String(err)}\n`);
    process.exit(1);
});
