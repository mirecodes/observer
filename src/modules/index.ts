import type { Module } from "../observers/observer";
import amiv from "./amiv";
import vis from "./vis";
import woko from "./woko";

// 폴더 이름 → 모듈. 새 모듈은 src/modules/<이름>/ 을 만들고 여기와 cfgs/modules.yml 에 추가한다.
// 켜고 끄는 건 cfgs/modules.yml 에서.
export const MODULES: Record<string, Module<unknown>> = { woko, amiv, vis };
