// cfgs/*.yml + src/modules/*/cfg.yml → gen/config.json
// Workers 는 실행 중에 파일을 못 읽으므로 빌드 때 합쳐서 번들에 넣는다.
// wrangler deploy/dev (wrangler.jsonc build.command), vitest, typecheck 전에 실행된다.
// 잘못된 설정이면 throw → 배포가 멈춘다.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { parse } from "yaml";

const root = new URL("..", import.meta.url);
const path = (p) => new URL(p, root);
const read = (p) => parse(readFileSync(path(p), "utf8")) ?? {};

function check(ok, msg) {
  if (!ok) throw new Error(`config: ${msg}`);
}
const posInt = (v) => Number.isInteger(v) && v > 0;

const mods = read("cfgs/modules.yml");
const notifier = read("cfgs/notifier.yml");

check(["ntfy", "pushover"].includes(notifier.provider), "cfgs/notifier.yml provider must be ntfy or pushover");
check(/^https?:\/\//.test(notifier.ntfy?.server ?? ""), "cfgs/notifier.yml ntfy.server must be an http(s) URL");
check(posInt(mods.health?.failuresBeforeAlert), "cfgs/modules.yml health.failuresBeforeAlert must be a positive integer");
check(posInt(mods.health?.realertHours), "cfgs/modules.yml health.realertHours must be a positive integer");
check(posInt(mods.maxSingleAlerts), "cfgs/modules.yml maxSingleAlerts must be a positive integer");

const dirs = readdirSync(path("src/modules/"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const listed = Object.keys(mods.modules ?? {});
for (const name of listed) check(dirs.includes(name), `cfgs/modules.yml lists "${name}" but src/modules/${name}/ does not exist`);

const modules = {};
for (const name of dirs) {
  const m = mods.modules?.[name];
  check(m, `src/modules/${name}/ is not listed under modules in cfgs/modules.yml`);
  check(typeof m.enabled === "boolean", `modules.${name}.enabled must be true or false`);
  check(m.notify === undefined || typeof m.notify === "boolean", `modules.${name}.notify must be true or false`);
  check(m.staleDays === undefined || posInt(m.staleDays), `modules.${name}.staleDays must be a positive integer`);
  const cfgFile = `src/modules/${name}/cfg.yml`;
  modules[name] = { enabled: m.enabled, notify: m.notify ?? true, staleDays: m.staleDays, cfg: existsSync(path(cfgFile)) ? read(cfgFile) : {} };
}

const out = `${JSON.stringify({ notifier, health: mods.health, maxSingleAlerts: mods.maxSingleAlerts, modules }, null, 2)}\n`;
mkdirSync(path("gen/"), { recursive: true });
const target = path("gen/config.json");
// 내용이 같으면 안 쓴다 (wrangler dev 감시 루프 방지)
if (!existsSync(target) || readFileSync(target, "utf8") !== out) writeFileSync(target, out);
