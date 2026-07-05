# Velo 开发日志

---

# v0.2.0 — FFmpeg 路径配置

## 目标

实现首次启动时引导用户设置 FFmpeg 路径，为后续视频裁剪功能打基础。

## 设计思路

### 整体架构

项目分为两层：**Rust 后端**（`src-tauri/src/`）和**前端**（`src/`），通过 Tauri 的 `invoke` 机制通信，类似前后端调 API。

### 文件职责划分

遵循"一个文件一个功能"原则，避免单文件过长、职责混乱：

#### Rust 后端

| 文件 | 职责 |
|------|------|
| `main.rs` | 程序入口，不做任何业务逻辑 |
| `lib.rs` | 注册模块和命令，是"胶水层" |
| `config.rs` | 配置管理：读写 `~/.velo/config.json`，提供 `get_ffmpeg_path` / `set_ffmpeg_path` 命令 |

#### 前端

| 文件 | 职责 |
|------|------|
| `main.ts` | 入口路由：判断是否已配置 → 决定显示哪个页面 |
| `setup.ts` | 设置页：浏览选择 ffmpeg.exe、保存路径 |
| `home.ts` | 主页：后续视频裁剪功能的入口（当前为占位） |

### 为什么这么设计

1. **config.rs 独立出来**：配置管理是独立功能，后续增加更多配置项（如默认输出目录）只需改这一个文件
2. **setup.ts 和 home.ts 分离**：设置页只在首次启动出现，主页是日常使用界面，两者生命周期不同，不应耦合
3. **main.ts 只做路由**：它不关心页面怎么渲染，只决定"该显示谁"，职责清晰

### 关键技术点

- **配置存储位置**：使用 `dirs::config_dir()` 获取系统配置目录（Windows 下为 `%APPDATA%`），配置不会因程序移动而丢失
- **文件选择对话框**：使用 `@tauri-apps/plugin-dialog` 的 `open()` 弹出系统原生文件选择器
- **路径验证**：Rust 端在保存前检查文件是否存在，防止无效路径

### 新增依赖

| 依赖 | 用途 |
|------|------|
| `dirs` (Rust) | 获取跨平台的用户配置目录 |
| `tauri-plugin-dialog` (Rust + npm) | 系统原生文件选择对话框 |

---

# v0.3.0 — 视频裁剪功能

## 目标

实现核心功能：用户选择视频文件，输入起始时间和持续时间，调用 FFmpeg 完成裁剪，并在界面上实时显示 FFmpeg 的输出日志。

## 设计思路

### 新增文件

只新增了一个文件 `ffmpeg.rs`，修改了两个已有文件。

`ffmpeg.rs` 独立于 `config.rs`，专门负责"调用 FFmpeg 执行任务"。这样做的好处是：后续如果要加更多 FFmpeg 功能（转码、合并、提取音频等），都只在这个文件里扩展，不会影响配置管理和 UI 层。

### 实时输出的实现方式

这是本次最关键的设计决策。

普通的命令调用（Tauri 的 invoke）是"请求-响应"模式——前端发一个请求，等 Rust 返回一个结果。但 FFmpeg 裁剪可能持续数秒甚至数分钟，用户需要看到实时进度，不能干等。

解决方案是 **Tauri 事件机制**：

- Rust 端启动 FFmpeg 子进程后，在新线程中逐行读取它的输出
- 每读到一行就通过事件推送给前端（类似 WebSocket 的推送模式）
- 前端监听这个事件，实时追加到日志区域

这样 invoke 调用负责"启动任务并等待最终结果"，事件负责"中间过程的实时反馈"，各司其职。

### FFmpeg 的输出特点

FFmpeg 的进度信息输出在 stderr 而不是 stdout，这是它的特殊设计。所以 Rust 端同时捕获了 stdout 和 stderr，统一推送给前端。

### 前端页面的职责边界

`home.ts` 只负责：渲染表单、收集用户输入、调用后端命令、显示日志。它不关心 FFmpeg 怎么被调用、配置存在哪里。

### 用户操作流程

1. 选择输入视频文件（弹出系统文件选择器）
2. 填写起始时间，对应 FFmpeg 的 `-ss` 参数
3. 填写持续时间，对应 FFmpeg 的 `-t` 参数
4. 选择输出保存路径（弹出系统保存对话框）
5. 点击"开始裁剪"，按钮变为禁用状态
6. 日志区域实时滚动显示 FFmpeg 输出
7. 完成后显示成功或失败信息，按钮恢复

### 参数顺序的考量

FFmpeg 的 `-ss` 参数放在 `-i` 之前，是"输入层面的快速定位"，FFmpeg 会直接跳到目标位置附近再精确定位，速度远快于放在 `-i` 之后的逐帧扫描方式。

---

# v0.4.0 — UI 重构：侧边栏导航 + Tailwind/DaisyUI

## 目标

将单页面结构重构为"侧边栏 + 内容区"布局，引入 Tailwind CSS 和 DaisyUI 替换 Pico CSS，为后续功能扩展（转码、合并等）提供可扩展的导航框架。同时将设置功能（FFmpeg 路径、背景图）统一到独立的设置页。

## 设计思路

### 为什么换掉 Pico CSS

Pico CSS 适合简单页面的快速美化，但它不支持侧边栏、导航面板等布局组件。随着功能增加，需要更灵活的样式方案。

Tailwind CSS 提供原子化的工具类，可以精细控制任何布局。DaisyUI 在 Tailwind 基础上提供现成的组件（卡片、按钮组、导航等），两者结合既灵活又高效。

Tailwind 在构建时会 tree-shake，只打包实际用到的样式，对最终体积影响极小。

### 布局架构

整个界面分为两个区域：

- **左侧 sidebar**：固定 56px 宽的图标导航栏，半透明深色背景
- **右侧 content**：可滚动的内容区域，半透明浅色背景

这种布局参考了桌面工具类应用的常见模式，侧边栏提供快速导航，内容区专注当前功能。

### 新增文件

| 文件 | 职责 |
|------|------|
| `sidebar.ts` | 侧边栏组件：渲染图标按钮、管理选中状态、触发页面切换回调 |
| `settings.ts` | 设置页：整合 FFmpeg 路径配置和背景图设置 |

### 文件职责变化

| 文件 | 变化 |
|------|------|
| `main.ts` | 从简单路由升级为布局控制器：管理侧边栏 + 内容区的协作 |
| `home.ts` | 去掉了背景图按钮（移到设置页），保持只做视频裁剪 |
| `setup.ts` | 仅用于首次启动引导，完成后不再出现 |

### 导航机制

侧边栏通过回调函数通知 `main.ts` 用户点了哪个按钮，`main.ts` 根据页面名称调用对应的渲染函数。这样侧边栏不需要知道有哪些页面的具体实现，只负责"用户点了什么"。

后续添加新页面只需三步：侧边栏加一个按钮、写一个新的页面文件、在 `main.ts` 的导航函数里加一个分支。

### 首次启动的特殊处理

如果用户未配置 FFmpeg 路径，侧边栏会被隐藏，全屏显示引导设置页。完成配置后侧边栏才出现，进入正常的导航模式。这避免了用户在未配置时就能进入功能页面导致出错。

### 依赖变化

| 操作 | 依赖 |
|------|------|
| 新增 | `tailwindcss`、`@tailwindcss/vite`、`daisyui` |
| 移除 | `@picocss/pico` |

---

# v0.4.1 — 默认输出分辨率设置

## 目标

在设置页面添加默认输出分辨率选项，用户可以预设常用分辨率，裁剪视频时自动应用。

## 设计思路

### 功能定位

分辨率设置属于"用户偏好"，所以放在设置页而不是裁剪页。裁剪时自动读取已保存的默认值，用户无需每次手动指定。选择"原始"则不做任何缩放，保持源视频分辨率。

### 预设分辨率列表

提供了常用的几档分辨率供用户选择：

| 分辨率 | 说明 |
|--------|------|
| 原始 | 不缩放，保持源视频尺寸 |
| 1920x1080 | 1080p 全高清 |
| 1600x900 | 常见笔记本屏幕分辨率 |
| 1280x720 | 720p 高清 |
| 854x480 | 480p 标清 |
| 640x360 | 360p 低分辨率 |

### 实现方式

配置层新增 `default_resolution` 字段，存储在同一个 `config.json` 中。FFmpeg 端通过 `-vf scale=宽:高` 滤镜实现缩放。如果分辨率为空则不添加任何滤镜参数。

### 交互细节

设置页使用下拉选择框，切换后自动保存，无需额外点击"保存"按钮。减少操作步骤，体验更流畅。

---

# v0.4.2 — 窗口尺寸预设

## 目标

在设置页面添加窗口尺寸选择，用户可以在常用尺寸间切换，选择后窗口立即调整大小，下次启动也会自动恢复。

## 设计思路

### 功能定位

窗口尺寸是"用户偏好"，和默认分辨率一样放在设置页。与输出分辨率不同，这个选项控制的是 Velo 应用窗口本身的大小，而不是视频的输出分辨率。两者是独立的设置项。

### 预设尺寸列表

| 尺寸 | 说明 |
|------|------|
| 默认 | 800x600，程序内置默认值 |
| 1600x900 | 大屏幕，适合高分辨率显示器 |
| 1280x720 | 中等尺寸，适合大多数笔记本 |
| 1024x768 | 经典 4:3 比例 |
| 800x600 | 紧凑尺寸 |

### 实现方式

配置层新增 `window_size` 字段，存储格式为 `"宽x高"`（如 `"1280x720"`）。前端通过 Tauri 的窗口 API（`getCurrentWindow().setSize()`）实现即时调整。

### 两个生效时机

1. **设置页切换时**：选择后立即调整窗口大小，所见即所得
2. **程序启动时**：`main.ts` 在初始化阶段读取已保存的尺寸并应用，确保每次打开都是用户上次选择的大小

### 与输出分辨率的关系

v0.4.1 的"默认输出分辨率"控制的是 FFmpeg 输出视频的画面尺寸。v0.4.2 的"窗口尺寸"控制的是 Velo 应用窗口的大小。两者互不影响，各自独立存储和读取。

---

# v0.5.0 — 裁剪进度条

## 目标

在视频裁剪过程中显示实时进度条，让用户清楚知道当前进度和剩余工作量，取代之前只能看原始日志的体验。

## 设计思路

### FFmpeg 默认输出的问题

FFmpeg 的进度信息（帧数、fps、当前时间）默认输出在 stderr，并且使用 `\r`（回车）不断覆盖同一行。之前的 `BufReader::lines()` 按换行符分割，所以读到的是 FFmpeg 启动时的头部信息，而不是实时的进度更新。

### 解决方案：-progress pipe:1

给 FFmpeg 添加 `-progress pipe:1` 参数后，FFmpeg 会将进度信息以 key=value 格式逐行输出到 stdout，每组数据以 `progress=continue` 结尾。关键字段是 `out_time_us`，表示当前已处理到的时间点（微秒）。

这样 stdout 负责进度数据（结构化、可解析），stderr 负责日志信息（原始输出），职责清晰分离。

### 进度百分比的计算

用户输入的持续时间（duration）就是总时长。将它转换为微秒后，用 `out_time_us / total_us * 100` 即可得到百分比。Rust 端计算好百分比后通过 `ffmpeg-progress` 事件推送给前端，前端只需更新进度条的值。

### 时间格式解析

用户可能输入 `10`（秒）、`1:30`（分:秒）、`1:02:30`（时:分:秒）等格式，所以 Rust 端实现了一个 `parse_duration_ms` 函数，支持这三种格式的解析。

### 前端进度条

使用 DaisyUI 的 `progress` 组件，放在日志区上方。旁边显示百分比数字。裁剪开始时重置为 0%，完成时由 Rust 端推送 100%。

---

# v0.5.1 — FFmpeg 状态摘要 + UI 细节优化

## 目标

将 FFmpeg 的原始日志输出替换为结构化的状态摘要行，只显示用户关心的关键信息。同时优化裁剪过程中的多个 UI 细节。

## 设计思路

### 状态摘要替代日志堆积

之前的日志区会把 FFmpeg 的每一行输出都追加显示，信息冗杂且大部分用户看不懂。新方案从 `-progress` 的结构化数据中提取关键字段（time、frame、fps、speed、bitrate、size），拼成一行状态摘要，实时覆盖显示。

这样用户只看到一行简洁的状态信息，而不是一大片滚动的日志。

### 进度区按需显示

进度条和状态行在未开始裁剪时没有意义，用 Tailwind 的 `hidden` class 隐藏整个区域，点击"开始裁剪"后才显示。裁剪完成后保持显示，用户还能看到最终状态。

### 加载动画优化

DaisyUI 的 `loading` class 直接加在按钮上会导致 spinner 继承按钮的字体大小，全宽按钮里显得过大。改为在按钮文字前插入一个独立的 `loading-sm` spinner 元素，大小可控。

### Windows 兼容性

添加了 `CREATE_NO_WINDOW` flag（`0x08000000`）防止 FFmpeg 子进程在 Windows 上弹出控制台窗口。同时恢复了 stderr 的推送，确保 FFmpeg 报错时用户能看到错误信息。

---

# v0.6.0 — 自定义图标 + 标题修正 + 构建优化

## 目标

将窗口标题从小写 "velo" 改为首字母大写 "Velo"，支持自定义应用图标，消除 Vite 构建时的动态导入警告。

## 设计思路

### 窗口标题

`tauri.conf.json` 中的 `title` 字段控制窗口标题栏显示的文字。作为产品名称，首字母大写更规范。

### 自定义图标

Tauri 打包时从 `src-tauri/icons/` 目录读取图标文件，嵌入到最终的 exe 中。需要的文件包括：

| 文件 | 尺寸 | 用途 |
|------|------|------|
| 32x32.png | 32x32 | 任务栏小图标 |
| 128x128.png | 128x128 | 通用图标 |
| 128x128@2x.png | 256x256 | 高分屏图标 |
| icon.ico | 多尺寸合一 | Windows exe 图标 |
| icon.icns | 多尺寸合一 | macOS 图标 |

只需准备一张 1024x1024 的 PNG 源图，运行 `npm run tauri icon` 即可自动生成所有尺寸。

注意：开发模式下（`tauri dev`）窗口标题栏图标不会更新，只有 build 后的 exe 才会使用自定义图标，这是 Windows 的行为。

### 消除 Vite 动态导入警告

`@tauri-apps/api/window` 和 `@tauri-apps/api/dpi` 在 `settings.ts` 中已经被静态导入，但 `main.ts` 里用了 `await import()` 动态导入。Vite 检测到同一个模块既有静态导入又有动态导入时会发出警告，因为动态导入不会把模块拆成单独的 chunk。

解决方式：将 `main.ts` 和 `settings.ts` 中的动态导入统一改为顶部静态导入。

---

# v0.7.0 — 功能扩展：视频合并 + 逐帧提取 + 可折叠侧边栏 + 关于页 + 输入缓存

## 目标

大幅扩展 Velo 的功能面：新增视频合并和逐帧提取两大功能页面，重构侧边栏为可展开/收起的图标导航栏，在设置页增加"关于"信息，并为所有页面实现通用的输入缓存机制。同时新增帧率控制选项。

## 新增功能

### 视频合并（merge.ts + ffmpeg.rs）

使用 FFmpeg 的 concat demuxer 实现多视频无损合并：

- 支持多文件选择，可上下移动调整顺序，可删除
- 使用 `-f concat -safe 0 -c copy` 参数组合，stream copy 模式不重新编码，速度极快
- Rust 端在系统临时目录创建 `velo_concat_list.txt` 文件列表供 concat demuxer 读取，任务完成后自动清理
- 复用 `run_ffmpeg_cmd` 通用执行器，进度条和状态行与裁剪页一致

### 逐帧提取（frames.ts + ffmpeg.rs）

将视频帧导出为图片序列：

- 支持可选的起始时间和持续时间（不填则提取整个视频）
- 提取帧率下拉选项：原始（全部帧）/ 1 / 2 / 5 / 10 / 24 / 30 fps，使用 `-vf fps=N` 滤镜
- 输出格式可选：PNG / JPG / BMP
- 输出为文件夹，图片命名为 `frame_00001.png` 格式（5位序号）
- 复用通用 FFmpeg 执行器和事件机制

### 帧率控制（home.ts + ffmpeg.rs）

裁剪页面新增帧率下拉选项（原始 / 15 / 24 / 30 / 60 / 120），对应 FFmpeg 的 `-r` 参数。放在起始时间和持续时间同一行的三列网格中，不额外占用空间。

### 可折叠侧边栏（sidebar.ts + styles.css）

侧边栏从固定图标栏升级为可展开/收起的导航栏：

- 顶部汉堡菜单按钮控制展开/收起，采用与导航按钮相同的 HTML 结构确保图标对齐
- 收起时只显示 24px 图标，展开时显示图标 + 文字标签
- CSS transition 实现平滑的宽度过渡动画（56px ↔ 160px，0.2s）
- 所有按钮使用 `flex-start` + `padding-left: 10px` 固定图标位置，动画过程中图标不跳动
- 导航配置 `NAV_ITEMS` 数组化，新增页面只需添加一项

### 关于信息（settings.ts）

设置页采用双栏布局：左栏设置项，右栏关于卡片：

- 应用图标（来自 `public/icon.png`）、名称、版本号（v0.7.0）、作者（TSK-Glofy）
- GitHub 链接按钮，使用 `@tauri-apps/plugin-opener` 的 `openUrl` 打开浏览器

### 输入缓存机制

所有页面（裁剪、合并、逐帧提取）实现模块级缓存：

- 裁剪页和逐帧提取页使用通用 `Record<string, string>` + `querySelectorAll("input[id], select[id]")` 自动发现和恢复所有表单元素
- 合并页缓存文件列表和输出路径
- 页面切换时数据不丢失，关闭程序自动释放

### 播放与定位（home.ts + merge.ts）

裁剪和合并完成后显示两个操作按钮：

- "播放视频"：使用 `openPath` 调用系统默认播放器
- "打开输出文件夹"：使用 `revealItemInDir` 在文件管理器中定位输出文件

## 后端重构

### FFmpeg 通用执行器（ffmpeg.rs）

提取 `run_ffmpeg_cmd` 共享函数，被裁剪、合并、逐帧提取三个命令复用：

- 启动 FFmpeg 子进程
- stderr 转发到前端事件
- stdout 解析 `-progress` key=value 输出，提取 frame、fps、bitrate、speed、out_time、total_size
- 输出大小自动格式化（B / KB / MB）
- 计算进度百分比并推送 `ffmpeg-progress` 事件

## 权限配置

`capabilities/default.json` 新增：

| 权限 | 用途 |
|------|------|
| `core:window:allow-set-size` | 前端调整窗口大小 |
| `opener:allow-open-path` + scope `**` | 允许打开任意路径的文件 |

## 版本号统一更新

| 文件 | 字段 |
|------|------|
| `package.json` | `version: "0.7.0"` |
| `src-tauri/Cargo.toml` | `version = "0.7.0"` |
| `src-tauri/tauri.conf.json` | `version: "0.7.0"` |
| `src/settings.ts` | 关于卡片显示 v0.7.0 |

---

# v0.8.0 — 输出格式转换 + 视频旋转 + 默认输出文件夹 + UI 统一

## 目标

为裁剪页面增加输出格式选择和视频旋转功能，新增"仅复制（不重新编码）"模式，在设置中增加默认输出文件夹配置，并统一所有页面的间距和布局。

## 新增功能

### 输出格式转换（home.ts + ffmpeg.rs）

裁剪页面新增输出格式下拉菜单，支持 MP4、MKV、AVI、MOV、WebM、FLV、MPEG-TS 格式互转：

- FFmpeg 根据输出文件扩展名自动选择容器格式，无需额外参数
- 默认选项"与源文件相同"保持原格式
- 输出文件名的 placeholder 会随格式选择动态更新扩展名

### 仅复制模式（home.ts + ffmpeg.rs）

编码区域改为勾选框"仅复制（不重新编码）"：

- 勾选后使用 FFmpeg `-c copy` 参数，跳过编解码过程，速度极快
- 勾选时输出格式下拉框变灰禁用（因为 `-c copy` 的格式转换依赖编解码器兼容性，不能保证成功）
- 勾选时忽略分辨率、帧率、旋转等需要重新编码的参数
- 默认不勾选

### 视频旋转（home.ts + ffmpeg.rs）

裁剪参数行扩展为四列网格，新增旋转下拉菜单：

- 向左 90°：FFmpeg `-vf transpose=2`
- 向右 90°：FFmpeg `-vf transpose=1`
- 180°：FFmpeg `-vf hflip,vflip`
- 旋转滤镜与分辨率缩放滤镜自动合并为逗号分隔的 `-vf` 参数链

### 默认输出文件夹（config.rs + settings.ts + home.ts）

设置页新增"默认输出文件夹"配置卡片：

- 默认路径为 exe 同级目录
- 裁剪时若未勾选"输出到原目录"，输出文件将保存到此文件夹
- 输出方式从"手动浏览选择路径"简化为"文件名 + 目标文件夹"的模式

### 输出文件名重构（home.ts）

裁剪页输出方式从浏览对话框改为直接输入文件名：

- 文件名输入框始终显示，placeholder 动态提示如 `video-new.mp4`
- 勾选"输出到原目录"时使用源文件所在目录，否则使用默认输出文件夹
- 移除了"浏览保存路径"的对话框

## UI 修复与优化

### 间距统一

所有页面（裁剪、合并、逐帧提取）的 card-body 统一使用 `gap-4` 控制子元素间距：

- 之前"输入文件"标签与输入框的间距由 label 自身 padding 控制，而"起始时间"等标签与输入框的间距由 `mt-4` 控制，导致两者不一致
- 现在每个逻辑分组用 `<div>` 包裹（label + 控件），card-body 的 `gap-4` 确保分组间距一致

### 设置页排序调整

设置项重新排序为更合理的顺序：

1. FFmpeg 路径
2. 默认输出分辨率
3. 默认输出文件夹
4. 窗口尺寸
5. 自定义背景

### 裁剪页布局调整

- 第一行参数从三列改为四列（起始时间、持续时间、帧率、旋转）
- 第二行：输出文件名、输出格式、编码（从左到右）
- "输出到原目录"勾选框移到第二行下方

## 后端变更

### ffmpeg.rs

- `trim_video` 新增 `rotation` 和 `codec_mode` 参数
- 重新编码模式下，`-vf` 滤镜链支持多个滤镜合并（scale + transpose/hflip/vflip）
- 仅复制模式下跳过所有滤镜

### config.rs

- `AppConfig` 新增 `default_output_dir: Option<String>` 字段
- 新增 `get_default_output_dir` / `set_default_output_dir` 命令
- 未配置时默认返回 exe 同级目录

## 版本号统一更新

| 文件 | 字段 |
|------|------|
| `package.json` | `version: "0.8.0"` |
| `src-tauri/Cargo.toml` | `version = "0.8.0"` |
| `src-tauri/tauri.conf.json` | `version: "0.8.0"` |
| `src/settings.ts` | 关于卡片显示 v0.8.0 |

---

# v0.9.0 — 国际化（i18n）+ 页面缓存

## 目标

为 Velo 添加中英双语支持，用户可在设置页面切换界面语言。同时将页面切换机制从"销毁重建"改为"显示/隐藏"，解决切换页面时丢失进度和输入状态的问题。

## 新增功能

### 国际化框架（i18n.ts）

新增 `src/i18n.ts` 模块，实现轻量级的前端 i18n 方案：

- 维护中文（zh）和英文（en）两套翻译表，共 100+ 条翻译键
- 提供三个函数：`t(key)` 获取翻译文本、`getLang()` 获取当前语言、`setLang(lang)` 设置语言
- 翻译键按页面分组命名（如 `trim.title`、`merge.start`、`settings.saved`），结构清晰

### 语言选择器（settings.ts + config.rs）

设置页最顶部新增"语言"卡片：

- 下拉菜单提供"中文"和"English"两个选项
- 切换后立即保存到后端配置，300ms 后自动刷新页面以应用新语言
- 程序启动时从 `config.json` 读取保存的语言设置，在渲染任何 UI 之前完成语言初始化

### 页面缓存机制（main.ts）

将页面切换从"销毁 DOM 并重新渲染"改为"显示/隐藏"模式：

- 每个页面（截取、合并、逐帧提取）拥有独立的 `<div>` 容器，只初始化一次
- 切换页面时仅切换 `display: none / block`，DOM、事件监听、进度状态全部保留
- 设置页例外：每次进入都重新渲染，确保显示最新配置
- 解决了之前切换页面时截取进度丢失、输入框清空的问题

## 前端文件变更

所有前端文件中的硬编码中文字符串替换为 `t()` 函数调用：

| 文件 | 变更内容 |
|------|---------|
| `i18n.ts` | 新增，翻译表和语言管理函数 |
| `main.ts` | 启动时加载语言设置；页面容器缓存机制 |
| `sidebar.ts` | 导航标签、菜单文字 i18n 化 |
| `home.ts` | 截取页面所有 UI 文本 i18n 化 |
| `merge.ts` | 合并页面所有 UI 文本 i18n 化 |
| `frames.ts` | 逐帧提取页面所有 UI 文本 i18n 化 |
| `settings.ts` | 设置页 i18n 化 + 新增语言选择器 |
| `setup.ts` | 首次引导页 i18n 化 |

## 后端变更

### config.rs

- `AppConfig` 新增 `language: Option<String>` 字段
- 新增 `get_language` / `set_language` 命令
- 未配置时默认返回 `"zh"`

### lib.rs

- 注册 `get_language` 和 `set_language` 命令

## 设计决策

### 为什么用页面刷新而不是动态更新

语言切换后直接 `window.location.reload()` 刷新整个应用，而不是逐个更新 DOM 元素。原因：

1. 所有页面的 HTML 模板在 `renderXxx()` 函数中用模板字符串生成，`t()` 调用嵌入在模板中
2. 要动态更新就需要给每个文本节点加 `id` 再逐一替换，代码复杂度大幅增加
3. 语言切换是低频操作，用户不会频繁切换，300ms 的刷新延迟完全可以接受

### 为什么不用第三方 i18n 库

项目体量小（7 个页面文件），翻译条目约 100 条，一个简单的 `Record<Lang, Record<string, string>>` 结构完全够用。引入 i18next 等库会增加不必要的依赖和复杂度。

## 版本号统一更新

| 文件 | 字段 |
|------|------|
| `package.json` | `version: "0.9.0"` |
| `src-tauri/Cargo.toml` | `version = "0.9.0"` |
| `src-tauri/tauri.conf.json` | `version: "0.9.0"` |
| `src/settings.ts` | 关于卡片显示 v0.9.0 |

---

# v0.10.0 — 后台任务系统 + 任务列表窗口

## 目标

把"按按钮 → 阻塞等 FFmpeg → 完事"的同步流程，换成"提交任务 → 立刻返回 → 独立窗口看进度 → 崩了能恢复"。同时让 Trim/Merge/Frames 三个页面共享同一套任务底座，并把多并发、可重试、可取消、可预览这些常见需求一次性补齐。

## 整体架构

新增四个 Rust 模块组成任务子系统：

```
task_types.rs  ── 共享数据类型（TaskRequest/Summary/Detail/Metrics/Event）
jobs.rs        ── JSONL 事件日志 + 内存注册表 + 调度器 + Tauri 命令
ffmpeg.rs      ── 在原 trim/merge/frames 之外新增 build_task_command + run_ffmpeg_task
preview.rs     ── 单实例守卫的预览抽帧
```

前端新增 `taskApi.ts` / `taskFormat.ts` / `taskList.ts` 三件套，加一个二级窗口 `?window=task-list` 路由。

## 关键设计决策

### 1. JSONL 事件日志 + 启动回放

任务状态不是直接存当前快照，而是**每个事件追加一行 JSON** 到 `<安装目录>/jobs/jobs.jsonl`：

```json
{"type":"taskCreated","taskId":"task_20260617_153022_a7f3","kind":"trim",...}
{"type":"taskStarted","taskId":"task_20260617_153022_a7f3",...}
{"type":"taskProgress","taskId":"...","metrics":{...},...}
{"type":"taskCompleted","taskId":"...",...}
```

**为什么**：
- append-only 文件不需要锁，崩了也不会写半行 JSON
- 启动时回放整个日志重建内存状态；replay 时若发现某任务还卡在 `Running` 而进程已不在，自动标记 `Interrupted` —— 自然就有了崩溃恢复语义
- 不依赖任何外部数据库，零运维

### 2. 注册表 + 调度器 + 真线程

`TaskRegistry` 是 `Arc<Mutex<...>>` 共享状态，含：
- `tasks: HashMap<id, TaskDetail>` —— 所有任务
- `queue: VecDeque<id>` —— 等待跑的
- `running: HashMap<id, RunningTask>` —— 跑着的（含 `cancel_requested` 标志）
- `max_concurrent_jobs` —— 并发上限（1~4 clamp）

调度逻辑刻意简单：`schedule_ready_tasks(app, registry)` 在并发上限内 `pop_startable_task_ids()`，对每个 id 起一个 `std::thread::spawn`，跑完后**递归调度**下一批。没有用 tokio runtime，因为 FFmpeg 是阻塞 IO + 进程 wait，原生线程反而最直白。

### 3. FFmpeg 命令构建器分层

旧的 `trim_video` / `merge_videos` / `extract_frames` 三个 Tauri 命令保留没动，新代码走另一条路：

```
build_trim_command / build_merge_command / build_frames_command
        ↓ 都返回 BuiltFfmpegTask { args, total_us, primary_input, output, ... }
build_task_command(ffmpeg_path, &TaskRequest)
        ↓
run_ffmpeg_task(app, registry, task_id)
```

**为什么分两层**：构建参数和执行进程职责完全不同，分开后单测可以只测参数构造（不需要真的有 FFmpeg）。`ProgressParser` 也是同样的考虑 —— 把 stdout 解析抽出来纯函数化，单测覆盖速率/帧/百分比计算。

### 4. 预览抽帧：单实例守卫

每次任务的进度事件触发时（约每秒），后台 spawn 一个独立 FFmpeg 进程：

```
ffmpeg -ss <当前时间> -i <输入> -vf scale=320:-1 -frames:v 1 preview.jpg
```

`PreviewState` 用 `Arc<Mutex<HashSet<task_id>>>` 守卫：**上一帧没抽完就跳过这次请求**。这避免了进度风暴时几十个 ffmpeg 同时抽帧把 CPU 打满。抽好后 emit `task-preview-updated` 给前端，前端原地刷新 `<img>`。

### 5. 二级窗口而不是模态对话框

任务列表是独立窗口（`WebviewWindowBuilder` + `?window=task-list` URL 参数）：

- 主窗口可以继续提交新任务，不阻塞
- 重启 app 后任务窗口手动开（或主窗口自动重开），数据从 JSONL 重建
- `main.ts` 在 DOMContentLoaded 时检测 URL 参数走两套不同的初始化分支，共享同一份 `index.html` + bundle

### 6. 重试的两条策略

失败任务点 Retry，如果输出文件还在，弹窗问：
- 「是」→ `useOriginal`：复用原路径，覆盖
- 「否」→ `useNumberedFallback`：自动生成 `old_file(2).mp4`（已有 `old_file(1).mp4` 时跳到 2）

重试**复用同一个 task_id** —— 历史进度被清空，重新 `Pending` 入队。前端的卡片选中状态因此能保持不变。

### 7. 崩溃恢复

启动主窗口时调 `list_interrupted_tasks`，非空就弹 ask 对话框；选「是」批量 `retry_interrupted_tasks` 全部用 `useOriginal` 策略入队 + 打开任务列表窗口。

## 重要文件清单

### Rust 后端

| 文件 | 职责 |
|------|------|
| `task_types.rs` | TaskKind / State / Request / Metrics / Summary / Detail / Event / RetryOutputPolicy |
| `jobs.rs` | JSONL append/replay + TaskRegistry + 调度器 + 8 个 Tauri 命令 |
| `preview.rs` | build_preview_args + PreviewState + request_preview（单实例守卫） |
| `ffmpeg.rs` | 新增 build_task_command 系列 + run_ffmpeg_task + ProgressParser |
| `paths.rs` | `<install>/jobs/`, `<install>/preview/` 等路径辅助（v0.9.x 已有） |

### 前端

| 文件 | 职责 |
|------|------|
| `taskApi.ts` | Tauri 命令的 TS 包装（createTask/listTasks/retryTask/...） |
| `taskFormat.ts` | 日期、状态 class、metric 占位符等纯格式化函数 |
| `taskList.ts` | 任务列表窗口渲染器；监听 task-progress/completed/failed/preview-updated 事件 |
| `main.ts` | 路由 `?window=task-list`；启动时弹崩溃恢复对话框 |
| `home.ts` / `merge.ts` / `frames.ts` | 改成调 createTask + openTaskListWindow，删除页内进度条 |

### 测试

| 文件 | 内容 |
|------|------|
| `cargo test` | jobs replay / scheduler / retry / next_available_output / interrupted_summaries 等 31 个 |
| `tests/task-format.test.mjs` | 前端格式化函数单测 |
| `tests/task-list-render.test.mjs` | 检查 styles.css 含必要 class 名 |
| `tests/source-pages-task-api.test.mjs` | 检查三个源页面都改成了 createTask 路径 |

## 数据布局（v0.9.x 已立，v0.10 才真用上）

```
<install root>/
├─ config/
│   ├─ config.json      用户配置
│   └─ install.json     安装时种入的 locale
├─ jobs/
│   ├─ jobs.jsonl       事件日志
│   └─ logs/
│       └─ <task_id>.log  每个任务的 stderr 全量
├─ preview/
│   └─ <task_id>.jpg    最新预览帧
└─ pic/
    └─ background/      用户导入的背景图
```

所有数据都在安装目录内，便于绿色版/便携使用。

## 已知遗留

- 旧的 `trim_video` / `merge_videos` / `extract_frames` Tauri 命令仍保留但前端不再调用，下版本可清理
- 老的 `ffmpeg-status` / `ffmpeg-progress` 事件名后端仍 emit（兼容旧代码），但前端已不监听
- 取消任务的 `cancel_requested` 标志已写入 `RunningTask`，但 `run_ffmpeg_task` 中尚未周期性检查并 kill 子进程 —— 当前 cancel_task 只是标记，没真正终止 FFmpeg
- 安装器层面的 locale 种入（Task 12）尚未完成

## 版本号统一更新

| 文件 | 字段 |
|------|------|
| `package.json` | `version: "0.10.0"` |
| `src-tauri/Cargo.toml` | `version = "0.10.0"` |
| `src-tauri/tauri.conf.json` | `version: "0.10.0"` |
| `src/settings.ts` | 关于卡片显示 v0.10.0 |

---

# v0.10.1 — 任务流交互修复 + 默认窗口尺寸

## 目标

v0.10 把后台任务系统铺好后，实测发现几个交互坑：取消按钮点了不真停 FFmpeg、点击 Start 跳到任务页时选中的是上次失败的旧任务、默认窗口太小、Settings 灰色提示文字啰嗦。一次性修掉。

## 关键改动

### 1. 取消真正能停 FFmpeg

v0.10 里 `cancel_task` 只是把 `RunningTask.cancel_requested` 置 true，但 `run_ffmpeg_task` 从不读这个 flag —— 子进程照跑。

修复：把 `run_ffmpeg_task` 末尾的 `child.wait()` 换成 200ms 间隔的 `try_wait()` 轮询循环，每轮顺便锁 registry 读 `cancel_requested(&task_id)`：

```rust
let status = loop {
    match child.try_wait() {
        Ok(Some(s)) => break s,
        Ok(None) => {
            if registry.lock().ok().map(|r| r.cancel_requested(&task_id)).unwrap_or(false) {
                let _ = child.kill();
                let _ = child.wait();
                finish_task_cancelled(&app, &registry, &task_id);
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        Err(e) => { ... }
    }
};
```

新增 `finish_task_cancelled` 负责 append `TaskCancelled` 事件、改状态、`mark_finished`、emit `task-cancelled` 给前端。前端 `taskList.ts` 新增对应监听。

顺带处理"取消还在 queue 里的 Pending 任务"——`request_cancel` 改返回 `CancelOutcome` 枚举：`Signaled` / `Dequeued { cancelled_at }` / `NotFound`。Dequeued 路径在 `cancel_task` 命令里直接 append 事件 + emit。

### 2. 创建任务后焦点要落在新任务上

bug：进入 Tasks 页 `renderTaskList` 里有

```ts
if (selectedTaskId === null || !tasks.some(t => t.id === selectedTaskId)) {
  selectedTaskId = tasks[0]?.id ?? null;
}
```

如果上次访问 Tasks 页时点过某个失败任务，`selectedTaskId` 保留指向那条旧任务，且新建任务后它仍在列表中 —— 条件不满足，焦点不动，右面板继续显示旧失败任务。

修复：引入 `pendingFocusTaskId` 模块变量 + 导出 `focusTaskOnNextRender(id)`。`openTaskListWindow(taskId?)` 接受可选 id，通过 `CustomEvent` detail 传到 main.ts，main.ts 调 `focusTaskOnNextRender`，下次 `renderTaskList` 优先消费这个 id：

```ts
if (pendingFocusTaskId && tasks.some(t => t.id === pendingFocusTaskId)) {
  selectedTaskId = pendingFocusTaskId;
  pendingFocusTaskId = null;
} else if (selectedTaskId === null || !tasks.some(...)) {
  selectedTaskId = tasks[0]?.id ?? null;
}
```

home.ts / merge.ts / frames.ts 拿 `createTask` 返回的 `summary.id` 传给 `openTaskListWindow(summary.id)`。

### 3. 默认窗口 1280×720

`tauri.conf.json` 主窗口 `width: 800 / height: 600` → `1280 / 720`。Welcome / Setup / Tasks 等所有页面共享这一个主窗口，所以同步生效。

### 4. Settings 删提示行

页面里 6 个 `<p class="text-sm opacity-70 mb-2">${t("settings.xxxHint")}</p>` 全部删除（语言、默认分辨率、默认输出目录、默认选项、并发数、窗口尺寸）。i18n 里对应的 `xxxHint` key 暂留不影响显示。

`#bg-current`（显示当前背景图路径）保留 —— 这是动态状态而非解释文字。

## 版本号统一更新

| 文件 | 字段 |
|------|------|
| `package.json` | `version: "0.10.1"` |
| `src-tauri/Cargo.toml` | `version = "0.10.1"` |
| `src-tauri/tauri.conf.json` | `version: "0.10.1"` |
| `src/settings.ts` | 关于卡片显示 v0.10.1 |

---

# v0.11.0 — 拖拽剪辑范围 + 视频转 GIF + 预览偏移修复

## 目标

把"手填 -ss/-t"升级为"拖时间轴、看画面选范围"，新增视频转 GIF 功能，并修掉任务预览图在起始时间非 0 时错位的老 bug。时间输入同时统一为 HH:MM:SS 格式。

## 新增功能

### 1. 时间输入规范化（timeFormat.ts）

新增 `src/timeFormat.ts`，提供四个函数：

- `hmsToSeconds(str)`：解析 `SS` / `MM:SS` / `HH:MM:SS`（可带小数），非法返回 null，逻辑与 Rust 端 `parse_duration_us` 对齐
- `secondsToHms(sec)`：格式化为 `HH:MM:SS`，有小数秒时保留（毫秒级取整避免浮点尾巴）
- `attachTimeNormalizer(el, cache)`：失焦时校验 + 规范化 + 写回页面输入缓存，非法加 `input-error` 样式
- `isInvalidTimeInput(el)`：提交前校验（非空但解析失败才拦截）

截取、逐帧提取、GIF 三个页面共用，提交任务时非法输入会标红并提示。

### 2. 剪辑范围选择器（rangeSelector.ts）

新增可复用组件 `createRangeSelector({host, inputPath, onRangeChange})`，三个页面共用：

- **双滑块时间轴**：自绘轨道 + 两个手柄（pointer 事件 + setPointerCapture），点轨道空白处自动抓最近的手柄；拖动时实时回调 `onRangeChange(start, end)`
- **双向同步**：拖手柄 → 起始/持续时间输入框自动填 `HH:MM:SS`；手动改输入框失焦 → `setRange()` 反向更新滑块和画面。持续时间留空表示"到结尾"（`setRange` 用 Infinity，内部 clamp 到视频总长）
- **画面预览两种模式**：
  - `video` 模式：`<video muted preload="metadata">` + `convertFileSrc`，拖动时设 `currentTime` 画面即时跟随。用的是 WebView2（Edge 内核）自带解码器，mp4/webm/mkv 都能播，**不打包任何播放器、安装包体积零增加**
  - `frame` 模式：video 元素触发 `error`（AVI/FLV/WMV 等不支持的封装/编码）时自动降级——隐藏 video 显示 `<img>`，时长走新命令 `get_video_duration`，拖动经 200ms 防抖调 `generate_scrub_frame` 抽单帧显示，右上角挂"FFmpeg 抽帧预览"角标
- **预览大小档位**：时间轴下方 25%/50%/75%/100% 四个按钮，按宽度百分比缩放画面，选择存 localStorage（`velo-preview-size`），三页共享、重启保留
- **生命周期**：`destroy()` 清空 video src 并 `load()` 释放解码器；换文件时整个重建

### 3. 视频转 GIF（全链路）

- `task_types.rs`：`TaskKind::Gif` + `TaskRequest::Gif { input, output, start, duration, fps, width }`
- `ffmpeg.rs`：`build_gif_command`，滤镜链为

  ```
  fps={fps|10},scale={width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse
  ```

  两阶段调色板（palettegen 先统计全片颜色生成 256 色板，paletteuse 再映射）比 GIF 默认抖动质量高得多；宽度留空则跳过 scale。start/duration 的解析与 trim 共用新抽出的 `resolve_start_duration`（start 空默认 0，duration 空 probe 总长减 start）
- `jobs.rs`：`kind_for_request` / `title_for_request` / `output_for_request` / 重试改名逻辑各加 Gif 分支
- 前端 `gif.ts` 仿 home.ts：帧率下拉（5-25，默认 10）、宽度下拉（原始/320/480/640/800，默认 480）、输出名自动补 `.gif`；sidebar/main.ts/taskApi/i18n 同步注册
- 任务进度、预览图、取消、重试全部复用现有任务管线，零额外代码

### 4. 抽帧辅助命令（preview.rs + paths.rs）

- `get_video_duration(input) -> f64`：包装 `probe_video_duration`（ffprobe 优先，ffmpeg stderr 兜底），返回秒
- `generate_scrub_frame(input, seconds) -> String`：复用 `build_preview_args` 抽一帧到 preview 目录，文件名 `scrub_{输入路径hash}.jpg`（DefaultHasher）——放 preview 目录意味着设置页"清理缓存 → Preview 截图"顺带就能清掉

## 关键修复

### 任务预览图忽略 -ss 偏移

**根因**：ffmpeg `-progress` 输出的 `out_time` 是相对**输出流**的时间（从 0 开始），而预览抽帧直接拿它对**原始输入**做 `-ss`。起始时间设为 3 分钟时，剪到第 10 秒，预览显示的却是原片第 10 秒的画面。

**修复**：`BuiltFfmpegTask` 新增 `preview_offset_us` 字段（trim/frames/gif 取 start 的微秒值，merge 为 0），`run_ffmpeg_task` 请求预览时计算 `offset + parse_duration_us(out_time)` 再格式化为秒字符串传入。用 testsrc2 测试视频验证：请求 5.5 秒，抽出帧的烧录时间码正好 `00:00:05.500`。

### CSS 层叠层的坑：无层级样式压过 Tailwind 工具类

"正在读取视频..."加载提示在预览就绪后隐藏不掉。原因：Tailwind v4 的 `.hidden` 在 `@layer utilities` 里，而 styles.css 里自定义的 `.rs-status { display: flex }` 是**无层级**样式——按 CSS Cascade Layers 规则，无层级永远赢过有层级，与选择器优先级、书写顺序都无关。改为 JS 直接设 `style.display = "none"`。

**教训**：自定义 CSS 与 Tailwind 工具类同时控制一个属性时，要么自定义规则也放进 `@layer`，要么别指望用工具类去覆盖。

## 文件清单

| 文件 | 动作 |
|------|------|
| `src/timeFormat.ts` | 新增：时间解析/格式化/输入规范化 |
| `src/rangeSelector.ts` | 新增：双滑块 + video/抽帧双模式预览组件 |
| `src/gif.ts` | 新增：GIF 页面 |
| `src/home.ts` / `frames.ts` | 集成范围选择器 + 时间规范化 |
| `src/sidebar.ts` / `main.ts` / `taskApi.ts` / `i18n.ts` | GIF 页注册 + range/gif 文案 |
| `src/styles.css` | rs-* 组件样式 |
| `src-tauri/src/ffmpeg.rs` | preview_offset_us + resolve_start_duration + build_gif_command + 测试 |
| `src-tauri/src/preview.rs` | get_video_duration / generate_scrub_frame 命令 |
| `src-tauri/src/task_types.rs` / `jobs.rs` | Gif 任务类型及分支 |
| `src-tauri/src/paths.rs` | scrub_file 路径辅助 |
| `src-tauri/src/lib.rs` | 注册 2 个新命令 |

## 体积实测

release 版 velo.exe：10.60 MB → 10.48 MB（无新增依赖；`<video>` 是 WebView2 系统能力）。前端 bundle JS +13 KB。

## 版本号统一更新

| 文件 | 字段 |
|------|------|
| `package.json` | `version: "0.11.0"` |
| `src-tauri/Cargo.toml` | `version = "0.11.0"` |
| `src-tauri/tauri.conf.json` | `version: "0.11.0"` |
| `src/settings.ts` | 关于卡片显示 v0.11.0 |
