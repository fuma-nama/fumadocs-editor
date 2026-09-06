import type { StudioConfig, StudioServerConfig } from "./config";

export type { StudioConfig, StudioServerConfig };

export const defineConfig = (config: StudioConfig): StudioConfig => config;

export const defineServerConfig = (config: StudioServerConfig): StudioServerConfig => config;
