import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import CaseDemo from "./CaseDemo.vue";
import Layout from "./Layout.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    // Registered globally so pages can use <CaseDemo :case="..." /> without importing it.
    app.component("CaseDemo", CaseDemo);
  },
} satisfies Theme;
