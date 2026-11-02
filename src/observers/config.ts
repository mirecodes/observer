// scripts/build-config.mjs 가 cfgs/*.yml 과 src/modules/*/cfg.yml 을 검증해서 만든 파일
import raw from "../../gen/config.json";

export interface ModuleSettings {
  enabled: boolean;
  notify: boolean; // false 면 새 항목 알림만 끈다. 감지·점검 요청은 계속
  staleDays?: number; // 이 기간 새 항목이 없으면 점검 요청
  cfg: Record<string, unknown>; // 모듈의 cfg.yml
}

export interface Config {
  notifier: {
    provider: "ntfy" | "pushover";
    ntfy: { server: string };
    pushover?: { sound?: string };
  };
  health: { failuresBeforeAlert: number; realertHours: number };
  maxSingleAlerts: number;
  modules: Record<string, ModuleSettings>;
}

export const CONFIG = raw as Config;
