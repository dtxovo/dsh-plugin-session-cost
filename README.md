# dsh-plugin-session-cost

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件：在聊天界面的**输入框下方**显示**当前会话一共花了多少钱**，并且**按峰谷时段分别计价** —— 哪些 token 按高峰价、哪些按空闲价，点开一目了然。

外观和交互**照抄 DSH 原生的用量胶囊**（它旁边那个 `StatsPills`，同一套主题变量、同样的圆角与内边距、同样的弹出面板），所以它会跟着主题一起变，不会显得是外来的。和原生一样：**胶囊里只有图标 + 数值，文字标签留给弹出层标题**。

```
   [原生] 11 轮 168 步 · 222 tok/s   41.6M tok · 缓存命中 99%      🪙 ¥1.09
```

点一下，弹出和原生「Token 用量」同一个模子的面板（这个会话全部落在空闲时段）：

```
🪙 花费                                    ¥1.09
────────────────────────────────────────────────
空闲时段 · 110 次请求
未缓存输入                          187K tok · ¥0.187
缓存读取                          20.77M tok · ¥0.415
输出                                121K tok · ¥0.482
```

如果会话横跨两个时段，会分成两块、各带小计：

```
🪙 花费                                    ¥3.30
────────────────────────────────────────────────
高峰时段 · 3 次请求
未缓存输入                         1.00M tok · ¥2.00
输出                               100K tok · ¥0.800
小计                                           ¥2.80
空闲时段 · 7 次请求
缓存读取                           5.00M tok · ¥0.100
输出                               100K tok · ¥0.400
小计                                           ¥0.500
```

## 峰谷是怎么判定的

DeepSeek 的规则：**高峰时段为北京时间周一至周五 09:00–12:00、14:00–18:00**，其余（含周末、节假日全天）都是空闲时段；空闲价正好是高峰价的一半。

判定依据是**每条请求自己的时间戳**，所以计价必须在 host 端逐条折叠 —— 光看汇总的 token 数是分不出来的。插件的 host 半边读取会话日志里每条 `assistant/message` 的时间，落到对应时段累加。

这个折叠**逐条复刻了官方 `dsh-token-meter` 的 `tokenUsage` 单元**的规则（同一步的后一条用量替换前一条；`llm/retry-started` 清空重试槽位；`assistant/message` 没有 `usage` 时回退到内嵌流里的最后一个 usage chunk），所以 token 总数和 DSH 自带的用量胶囊永远对得上。

## 安装

```powershell
git clone https://github.com/hoebeed/dsh-plugin-session-cost
cd dsh-plugin-session-cost
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

脚本做两件事：把包复制到 `<profile>\plugins\session-cost\`，以及往 `<profile>\cordis.patch.yml` 追加挂载配置（已存在则跳过）。装完 **刷新页面（Ctrl+R）**。

profile 目录按这个顺序确定：`-ProfileDir` 参数 → `$env:DSH_PROFILE_DIR` → `~\.dsh\profiles\desktop`。

> `-ExecutionPolicy Bypass` 是因为 Windows 默认禁止运行未签名的 `.ps1`。如果你的机器已经放开执行策略，直接 `.\install.ps1` 也行；不想跑脚本的话，手工做同样两件事即可。

## 改价格 / 改节假日

编辑 profile 的 `cordis.patch.yml`，保存即生效（配置层被热监听）：

```yaml
- insert:
    - id: session-cost-v2
      name: ./plugins/session-cost/host.js
      config:
        currency: "¥"     # 显示符号
        per: 1000000      # 下面价格都是「每 per 个 token」
        input: 1          # 输入，未命中缓存   ← 空闲价
        cacheRead: 0.02   # 输入，命中缓存     ← 空闲价
        cacheWrite: 0     # 写缓存（DeepSeek 不单独计费）
        output: 4         # 输出               ← 空闲价
        holidays: []      # 北京时间节假日日期，如 ["2026-10-01","2026-10-02"]
        # peak:           # 不写就默认 = 空闲价 × 2
        #   input: 2
        #   cacheRead: 0.04
        #   cacheWrite: 0
        #   output: 8
```

内置默认值是 **DeepSeek `deepseek-flash` 空闲时段刊例价**（元 / 百万 token），抄自官方价格页 2026-10-15：

| | 空闲时段 | 高峰时段 |
|---|---|---|
| 输入（命中缓存） | ¥0.02 | ¥0.04 |
| 输入（未命中缓存） | ¥1 | ¥2 |
| 输出 | ¥4 | ¥8 |

## 改代码后怎么生效

| 改了 | 怎么生效 |
|---|---|
| `client.js`（界面） | 宿主会**自动**重读 bundle 字节（`client-hmr` 每 500ms 轮询文件 mtime），但浏览器要**刷新页面（F5）**。 |
| `host.js`（计价逻辑） | **必须换 entry id**，例如 `session-cost-v2` → `session-cost-v3`，或者重启 DSH。ESM 模块按 URL 缓存，改已有 entry 的 `name` 或内容都不会重新 import。 |

**为什么客户端不能自动热替换**：`client-hmr` 的浏览器半边是这样找目标的 —— `entry.options.name === 包名`。本插件的 loader entry 名字是文件 URL（`./plugins/session-cost/host.js`），不等于包名 `dsh-plugin-session-cost`，于是它找不到、只打一条 warning。字节本身已经更新，F5 就能拿到。

## 样式：为什么一行 CSS 都不注入

两个坑逼出了现在这个做法。

### 1. 注入的 `<style>` 会被别的插件收编

`dsh-client-modules` 的浏览器半边：

```js
function claimStyles(id) {
  for (const el of document.querySelectorAll("style:not([data-plugin])"))
    el.setAttribute("data-plugin", id);   // 没有归属标记的 <style> 被就地认领
}
```

注释原文：*"preset-emitted tags arrive pre-tagged with data-plugin; any untagged tag is claimed for the materializing plugin"*。而 `client-hmr` 重载某个插件时会执行 `removeOwnedStyles(那个插件)`。

**一个没打 `data-plugin` 的 `<style>`，会被下一个加载的插件收编，然后跟着那个插件一起被删掉。** 这个插件踩过一次 —— 胶囊退化成浏览器默认按钮。

### 2. 官方 CSS 引用的主题变量，当前主题里并不存在

`cordis_inspect_query` 查 Theme 只返回 **14 个** token。而原生 `stat-dialog` / `TurnUsagePanel` 的 CSS 引用了一堆**不在其中**的变量：

| 变量 | 在主题里？ |
|---|---|
| `--dsw-specific-menu`（弹出层背景） | ❌ |
| `--dsw-elevation-prominent`（浮起阴影） | ❌ |
| `--dsw-alias-interactive-bg-hover`（悬停底色） | ❌ |
| `--dsw-alias-label-tertiary`（静息文字色） | ❌ |

`var()` 取不到值时，CSS 会**把整条声明作废**：`background` 退回 `transparent`（面板全透），悬停规则什么都不改（没有任何反馈）。所以原样抄原生 CSS，会连这个坑一起抄过来。

### 现在的做法

- **完全不注入 `<style>`**，所有度量走 inline style；
- **悬停用 React 状态**（`onMouseEnter` / `onMouseLeave` / `onFocus` / `onBlur`）而不是 `:hover` —— 选择器依赖样式表，状态不依赖；
- **每个变量都带兜底**：优先用原生那个名字（将来主题补齐就自动对齐原生），取不到就退到确实存在的 token。

| 用途 | 表达式 |
|---|---|
| 面板实底 | `var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base))` |
| 面板菜单色调 | `linear-gradient(var(--dsw-specific-menu, transparent), var(--dsw-specific-menu, transparent))` |
| 浮起阴影 | `var(--dsw-elevation-prominent, 0 10px 30px rgb(0 0 0/.35), 0 0 0 1px var(--dsw-alias-border-l1))` |
| 悬停 / 展开底色 | `var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2))` |
| 静息文字色 | `var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))` |

**面板为什么要两层**：原生弹窗用的是 `background: var(--dsw-specific-menu)`（同一个 `bRhRbq_panel` 类、同一个 `var()`、同样 portal 到 `document.body`），但把它换成 inline 之后就透光了 —— 单个颜色没法叠，取不到值就整条作废。所以改成：底层放一个**必然是实色**的表面 token（`backgroundColor`），菜单色作为**渐变层**压在上面（`backgroundImage`）。菜单色能取到就完全遮住底层、和原生一致；取不到或本身半透明，底层还在，最差也只是"一个纯色面板"而不是"一扇窗户"。

## 已知限制

- **节假日要自己填**：`holidays` 默认是空的。中国法定节假日每年由国务院公布，插件无法推算，需要你按年补。注意调休上班的周末**仍然按空闲价**（官方规则只看周一至周五 + 节假日名单，不看调休）。
- **不区分模型**：整张表只有一套价。你可以中途换模型，插件不会察觉，所有 token 都按同一套单价算。
- **不含推理 token**：`reasoningTokens` 是输出计费的子集，为避免重复计算没有单独相加。
- **是估算不是账单**：只算 token 费用，不含最低消费、阶梯价、汇率、赠送额度等。
- **缓存命中率**是 `命中 / (未命中 + 命中 + 写入)`，只统计输入侧。
- 如果 profile 里没有 `@deepseek-ai/dsh-token-meter`，组件不渲染任何东西（不会报错）。

## 自带回归测试

```powershell
# 客户端半边直接跑本目录的 client.js
node .\check.mjs         # 43 项：渲染、两种时段布局、悬停、降级路径、inline 度量与兜底

# host 半边会 import @deepseek-ai/schemastery 和 zod（由 DSH 提供），
# 所以指向一份已安装的副本跑，或者先把这两个依赖装上
node .\check-host.mjs "%DSH_PROFILE_DIR%\plugins\session-cost\host.js"   # 33 项
```

`check-host.mjs` 断言到分钟级边界（09:00 是高峰、08:59 不是、12:00 不是、18:00 不是、周末不是、节假日名单生效等）。

`check.mjs` 里有三组"防回归"断言，专门盯着这个插件踩过的坑：

1. **原生度量还在**：胶囊对齐**它旁边那个** `StatsPills` 用量胶囊（`border-radius:24px` / `padding:1px 8px` / `gap:6px` / 不设固定高度 / `font-family:inherit` / `font-size:12px` / 13px 图标），面板对齐 `stat-dialog`（`border-radius:12px` / `padding:16px` / `minmax(76px,auto)` 网格）—— 并且断言它们出现在 **inline style 里**；
2. **完全不注入样式表**：`document.head` 上必须一个节点都没多；
3. **悬停走状态不走 CSS**：`onMouseEnter` / `onMouseLeave` / `onFocus` / `onBlur` 四个处理器都在，悬停态的 `background` 必须是带兜底的表达式；静息态必须还是 `background:none`。另外断言面板背景、阴影、文字色三处的兜底写法确实存在。

## License

MIT © 2026 hoebeed
