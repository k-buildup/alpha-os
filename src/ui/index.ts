/**
 * UI Design System — barrel export
 */

export { Theme, Fonts, Spacing, SemanticColors, type ThemePalette } from "./Theme.js";
export { renderButton, hitTestButton, type ButtonSpec, type ButtonVariant } from "./components/Button.js";
export { renderToggle, hitTestToggle, type ToggleSpec } from "./components/Toggle.js";
export { openModal, showConfirm, showConflict, type ModalConfig, type ModalButton } from "./components/Modal.js";
export { renderScrollbar, type ScrollbarSpec } from "./components/Scrollbar.js";
export { renderSidebar, hitTestSidebar, DEFAULT_BOOKMARKS, type SidebarItem, type SidebarSpec } from "./components/Sidebar.js";
export { renderBreadcrumb, type BreadcrumbSpec } from "./components/Breadcrumb.js";
export { renderStatusBar, type StatusBarSpec } from "./components/StatusBar.js";
export { renderIconGrid, iconGridHitTest, type IconTile, type IconGridSpec } from "./components/IconGrid.js";
