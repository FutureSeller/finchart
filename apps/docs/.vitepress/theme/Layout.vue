<script setup lang="ts">
/**
 * Puts the live demo directly under the hero, ahead of the feature cards —
 * a chart that actually works before any of the copy (see h6s.slash.page).
 * VPHome's `home-hero-after` slot is exactly that spot.
 *
 * The width has to match the hero and the features. VitePress's
 * `.container` is a Vue scoped style, so borrowing the class name alone
 * does nothing (every component gets its own `data-v-*` hash) — hence the
 * same values are duplicated here: responsive outer padding of 24/48/64px
 * with an inner max-width of 1152px.
 */
import DefaultTheme from "vitepress/theme";
import * as homeDemo from "../../../examples/src/cases/home-demo";

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #home-hero-after>
      <div class="home-live-demo-outer">
        <div class="home-live-demo-inner">
          <CaseDemo :case="homeDemo" autostart />
        </div>
      </div>
    </template>
  </Layout>
</template>

<style scoped>
.home-live-demo-outer {
  /* The hero's 64px bottom padding exists to make room for the button row.
     With the buttons gone it leaves the text floating above the chart, so
     pull it back up. */
  margin-top: -40px;
  padding: 0 24px;
}
.home-live-demo-inner {
  max-width: 1152px;
  margin: 0 auto;
}

@media (min-width: 640px) {
  .home-live-demo-outer {
    padding: 0 48px;
  }
}

@media (min-width: 960px) {
  .home-live-demo-outer {
    padding: 0 64px;
  }
}
</style>
