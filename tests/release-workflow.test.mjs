import fs from "node:fs";

// 对 .github/workflows/release.yml 的结构性断言。
//
// 这些不是单元测试 —— workflow 的真实行为只能在 GitHub 上验证。它们是回归闸门：
// 每一条都对应一条终审查出的、本地跑不出来的失败路径，防的是「以后有人把守卫
// 删掉」。刻意不引入 YAML 解析依赖，按 step 边界切开做文本断言。
//
// 失败时收集全部问题再一起报，而不是撞到第一条就中止 —— 这样拿它去跑一个旧版
// 文件时，能一次看清所有被违反的不变量。
// 可用 WORKFLOW_FILE 指定别的文件（用来验证修复前的版本确实是红的）。

const file = process.env.WORKFLOW_FILE
  ? new URL(process.env.WORKFLOW_FILE, `file://${process.cwd().replace(/\\/g, "/")}/`)
  : new URL("../.github/workflows/release.yml", import.meta.url);
// 行尾必须归一后再断言。core.autocrlf=true 意味着任何一次检出（本地切分支、
// CI 的 actions/checkout）都可能把这个文件写成 CRLF，那样行首锚点会全部失配，
// 发版流水线就会在「跑 node 测试」这一步直接挂掉 —— 这个 bug 是在本地把分支
// 合进 main 之后被合并后测试抓到的，checkout 当场就把它转成了 CRLF。
// 这里只归一内存里的副本用于断言，不改动文件本身。
const yaml = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

const steps = yaml.split(/\n      - /).slice(1).map((s) => "      - " + s);
check(steps.length >= 10, `step 切分异常，只切出 ${steps.length} 段`);
for (const step of steps) {
  const first = step.split("\n")[0];
  check(/^      - (name|uses|run):/.test(first), `step 边界切错了：${first}`);
}

const stepWith = (needle) => steps.find((s) => s.includes(needle));
const before = (step, needle) => (step ? step.slice(0, step.indexOf(needle)) : "");

function runBodyOf(step) {
  const marker = "\n        run: |\n";
  const i = step.indexOf(marker);
  return i === -1 ? null : step.slice(i + marker.length);
}

// --- workflow 本身必须能被 GitHub 解析 ---
// ${{ }} 在 YAML 的任何位置都会被求值，shell 注释里也会；一个空表达式就让整个
// 文件解析失败，而本地的 tab 检查和 YAML 解析都发现不了。
const exprs = [...yaml.matchAll(/\$\{\{(.*?)\}\}/gs)].map((m) => m[1].trim());
check(exprs.length > 0, "一个表达式都没有，切分大概出错了");
check(exprs.every((e) => e !== ""), "YAML 里有空表达式，workflow 会解析失败");
check(!/\t/.test(yaml), "YAML 里有 tab 缩进");

// --- 只有手动触发：普通 commit 不碰 CI ---
check(/^on:\n  workflow_dispatch:/m.test(yaml), "触发器不是单独的 workflow_dispatch");
check(!/^  push:/m.test(yaml), "不该有 push 触发器");
check(!/^  pull_request:/m.test(yaml), "不该有 pull_request 触发器");

// --- 注入面：run: 正文里不许出现表达式插值，一律经 env 传入 ---
for (const step of steps) {
  const body = runBodyOf(step);
  if (body) check(!/\$\{\{/.test(body), `run: 正文里有表达式插值：${body.slice(0, 80).replace(/\n/g, " ")}`);
}

// --- C1：gh release delete 必须被就地的 draft + mode 双重守卫 ---
// 前置校验里那次 isDraft 检查和这个 delete 之间隔着三次 Tauri 构建（十几分钟），
// 期间用户完全可能去把上一个草稿点了 Publish。检查必须和它守护的动作相邻。
const deleteStep = stepWith("gh release delete");
check(!!deleteStep, "找不到删除 Release 的步骤");
const beforeDelete = before(deleteStep, "gh release delete");
check(/isDraft/.test(beforeDelete), "删除 Release 之前没有就地复查 isDraft —— 可能删掉已发布的 Release");
check(/MODE/.test(beforeDelete), "删除 Release 之前没有检查 MODE");

// --- I2：发版闸门必须跑 cargo test（spec §2 / §8.3 明文要求）---
// 本地实测 38 个 Rust 测试，覆盖 config.rs 与 paths.rs —— 正是「发版把用户数据
// 搞丢」这条反目标所保护的文件。
check(/cargo test/.test(yaml), "发版流水线没有跑 cargo test");

// --- I3：报错要把用户指向正确动作，而不是「手动删 tag」---
// 最自然的用法就是先跑 draft、看完满意、再用 publish 发出去。此时正确动作是
// 去网页点 Publish，不是删 tag 重来。
// 注意：step 名上方的注释在切分后会归到上一个 step，所以这里按首行锚定，
// 不能用 includes 搜步骤名。
const precheck = steps.find((s) => s.startsWith("      - name: 发布前置校验"));
check(!!precheck, "找不到发布前置校验步骤");
check(/点一下 Publish/.test(precheck || ""), "publish 撞上已有草稿时，没给出「去网页点 Publish」的指引");
check(/draft 模式重跑可以自动补齐/.test(precheck || ""), "tag 存在但没有 Release 时，没给出「重跑 draft 补齐」的指引");

// --- I4：tag 的 force-push 要有 mode 守卫，且 tag 已指向本次 commit 时不重写 ---
// git tag -f -a 每次都生成新的 annotated tag 对象，ref 的 SHA 会变 —— 哪怕
// commit 没变，已 fetch 过它的人下次也得 --force。
const tagStep = stepWith("git push --force");
check(!!tagStep, "找不到打 tag 的步骤");
const beforeForce = before(tagStep, "git push --force");
check(/MODE/.test(beforeForce), "force-push tag 之前没有 MODE 守卫");
check(/rev-parse/.test(beforeForce), "没有比对 tag 当前指向，无变化时也会重写 tag 对象");

// --- I5：三种模式都把安装包挂到运行记录上 ---
// 否则「建 Release 这一步失败」会让十几分钟的构建成果凭空消失。
const uploadStep = stepWith("actions/upload-artifact");
check(!!uploadStep, "找不到 upload-artifact 步骤");
check(
  !/if: inputs\.mode == 'build-only'/.test(uploadStep || ""),
  "upload-artifact 仍限定在 build-only，建 Release 失败时产物会丢",
);

if (failures.length) {
  console.error(`release-workflow: ${failures.length} 条不变量被违反：`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("release-workflow tests passed");
