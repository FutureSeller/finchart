<script setup lang="ts">
/**
 * Mounts one case onto the site — it takes the `CaseModule` from
 * `apps/examples/src/cases/*.ts` as-is, with no wrapper.
 *
 * Four things the shell (cases.html) used to provide behind the scenes are
 * supplied here instead:
 * ① Theme CSS scoping (the `.dark` rules below — same values as
 *    src/theme.css, only the selector differs; the two apps have different
 *    DOM, so one file couldn't cover both)
 * ② Dark-mode switching — `requestRender()` rather than a remount, so
 *    whatever was drawn isn't thrown away
 * ③ An activation overlay — before a tap or click it doesn't swallow
 *    wheel/touch, so it never blocks the page from scrolling. Only places
 *    that pass `autostart` (somewhere the chart is the destination itself,
 *    like the homepage, rather than the middle of a long document) skip the
 *    overlay and activate on mount.
 * ④ A dispose net — always called on unmount
 */
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from "vue";
import type { CaseModule } from "../../../examples/src/cases/case";

const props = defineProps<{ case: CaseModule; autostart?: boolean }>();

const stage = useTemplateRef<HTMLDivElement>("stage");
const activated = ref(false);

let dispose: (() => void) & { requestRender?(): void } = () => {};
let observer: MutationObserver | null = null;

function activate(): void {
  if (activated.value || !stage.value) return;
  activated.value = true;
  dispose = props.case.mount(stage.value);

  // The dark toggle flips <html class="dark"> (VitePress's built-in switch)
  // — core doesn't take that as far as a re-render. If a case didn't wire up
  // requestRender, it keeps the old theme until the next interaction (a drag
  // or a zoom). That isn't a bug, it's that case's choice — which is why the
  // contract makes it an optional field.
  observer = new MutationObserver(() => dispose.requestRender?.());
  observer.observe(document.documentElement, { attributeFilter: ["class"] });
}

onMounted(() => {
  if (props.autostart) activate();
});

onBeforeUnmount(() => {
  observer?.disconnect();
  dispose();
});
</script>

<template>
  <div class="case-demo">
    <button
      v-if="!activated"
      type="button"
      class="case-demo-overlay"
      @click="activate"
    >
      Tap or click to run — this won't block scrolling
    </button>
    <div ref="stage" class="case-demo-stage" />
  </div>
</template>

<style scoped>
.case-demo {
  position: relative;
  /* The overlay is absolute, so it doesn't hold the document flow open —
     without min-height, overflow:hidden clips the 200px overlay down to this
     container's collapsed height (nearly zero). */
  min-height: 200px;
  margin: 16px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
}

.case-demo-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  min-height: 200px;
  font: inherit;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: none;
  cursor: pointer;
}

.case-demo-stage {
  padding: 12px;
}

/* Dark values for --chart-* — the same values as
   apps/examples/src/theme.css (that file is the single source of truth; the
   selector is rewritten here only because the DOM differs). No machine
   holds the two together: style-vars.test.ts skips .vitepress and reads no
   .vue, so a value that changes there has to be carried here by hand. */
:global(.dark) .case-demo-stage {
  --chart-grid: #1e293b;
  --chart-pane-divider: #334155;
  --chart-label: #94a3b8;
  --chart-crosshair: #475569;
  --chart-candle-up: #22c55e;
  --chart-candle-down: #f87171;
  --chart-histogram-up: #22c55e;
  --chart-histogram-down: #f87171;
  --chart-tooltip-back: rgba(226, 232, 240, 0.92);
  --chart-tooltip: #0f172a;
  --chart-legend: #cbd5e1;
  --chart-watermark: rgba(148, 163, 184, 0.1);
  --chart-drawing: #818cf8;
}
</style>
