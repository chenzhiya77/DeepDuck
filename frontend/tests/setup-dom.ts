/**
 * Global setup for the rstest `dom` project (happy-dom).
 *
 * happy-dom does not implement ResizeObserver, which Radix ScrollArea,
 * react-resizable-panels and echarts all rely on to measure content — Radix's
 * `useResizeObserver` calls `new ResizeObserver(...)` unguarded inside a layout
 * effect, so any dom test that renders those components throws without a stub.
 * A no-op stub is enough for render-level assertions.
 *
 * Idempotent: the per-file stubs that guard with `??=` or
 * `if (!("ResizeObserver" in globalThis))` simply skip once this runs first.
 */
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {
      /* no-op stub */
    }
    unobserve() {
      /* no-op stub */
    }
    disconnect() {
      /* no-op stub */
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
}

export {};
