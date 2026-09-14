import * as stylex from "@stylexjs/stylex";

// ancestors whose state styles descendants; a marker must be a named export
export const files = stylex.defineMarker();
export const row = stylex.defineMarker();
export const lifted = stylex.defineMarker();
export const folder = stylex.defineMarker();
export const menuItem = stylex.defineMarker();
export const entry = stylex.defineMarker();
