<script setup lang="ts">
import { withBase } from "vitepress";
import { ref } from "vue";

defineProps<{ src: string; title: string }>();
const activated = ref(false);
</script>

<template>
  <div class="showcase-demo">
    <p class="showcase-actions">
      <a :href="withBase(src)" target="_blank" rel="noopener">Open in a new tab</a>
    </p>
    <iframe
      v-if="activated"
      :src="withBase(src)"
      :title="title"
      class="showcase-frame"
    />
    <button v-else type="button" class="showcase-start" @click="activated = true">
      Run {{ title }}
    </button>
  </div>
</template>

<style scoped>
.showcase-actions {
  text-align: right;
}
.showcase-frame,
.showcase-start {
  box-sizing: border-box;
  width: 100%;
  height: 640px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
}
.showcase-frame {
  display: block;
}
.showcase-start {
  font: inherit;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  cursor: pointer;
}

@media (max-width: 768px) {
  .showcase-actions a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }

  .showcase-frame,
  .showcase-start {
    height: 100svh;
  }
}
</style>
