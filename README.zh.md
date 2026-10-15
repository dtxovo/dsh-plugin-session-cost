# dsh-plugin-session-cost

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件：显示**当前会话已经花了多少钱**，并按 DeepSeek 的**峰谷时段**分别计价。

![花费胶囊与展开面板](docs/screenshot.png)

[English](README.md) | **中文**

## 它显示什么

输入框下方多一颗胶囊，就在 DSH 自带的用量胶囊旁边：

```
   [自带] 12 轮 191 步 · 226 tok/s   51.5M tok · 缓存命中 99.6%        (¥) ¥2.75
```

点开是明细。全程落在同一时段的会话只有一块：

```
(¥) 花费                                          ¥1.09
───────────────────────────────────────────────────────
空闲时段 · 110 次请求
未缓存输入                              187K tok · ¥0.187
缓存读取                              20.77M tok · ¥0.415
输出                                    121K tok · ¥0.482
```

横跨两个时段的会话会分成两块，各带小计：

```
(¥) 花费                                          ¥3.30
───────────────────────────────────────────────────────
高峰时段 · 3 次请求
未缓存输入                             1.00M tok · ¥2.00
输出                                    100K tok · ¥0.800
小计                                              ¥2.80
空闲时段 · 7 次请求
缓存读取                               5.00M tok · ¥0.100
输出                                    100K tok · ¥0.400
小计                                              ¥0.500
```

数字是**整个会话**的累计，不是当前加载的窗口：翻页、压缩上下文、恢复会话都不会让它变少，重试过的模型请求也不会被重复计费。

## 安装

```powershell
git clone https://github.com/jxh020496-cmd/dsh-plugin-session-cost
cd dsh-plugin-session-cost
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

脚本做两件事：把包复制到 `<profile>\plugins\session-cost\`，以及往 `<profile>\cordis.patch.yml` 追加挂载配置（已存在则跳过）。装完 **刷新页面（Ctrl+R）**。

profile 目录按这个顺序确定：`-ProfileDir` 参数 → `$env:DSH_PROFILE_DIR` → `~\.dsh\profiles\desktop`。

`-ExecutionPolicy Bypass` 是因为 Windows 默认禁止运行未签名的 `.ps1`。如果你的机器已经放开执行策略，直接 `.\install.ps1` 也行。macOS / Linux 上装了 PowerShell 7 之后，手工做同样两步即可。

## 改价格 / 改节假日

编辑 profile 的 `cordis.patch.yml`，保存即生效（配置层被热监听），之后刷新页面让浏览器拿到新单价：

```yaml
- insert:
    - id: session-cost-v2
      name: ./plugins/session-cost/host.js
      config:
        currency: "¥"     # 显示符号
        per: 1000000      # 下面四个价格都是「每 per 个 token」
        input: 1          # 未命中缓存的输入   ← 空闲价
        cacheRead: 0.02   # 命中缓存的输入     ← 空闲价
        cacheWrite: 0     # 缓存写入（DeepSeek 不单独计费）
        output: 4         # 输出               ← 空闲价
        holidays: []      # 北京时间节假日，如 ["2026-10-01", "2026-10-02"]
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

**请对照你自己的账单核实。** 第三方中转不会按这个价格计费，而且这张表只有 `deepseek-flash`。

## 已知限制

- **节假日要自己填**：`holidays` 默认是空的。中国法定节假日每年由国务院公布，插件无法推算，需要按年补。调休上班的周末**仍然按空闲价** —— 官方规则只看周一至周五加节假日名单。
- **只有一套单价，不区分模型**：中途换模型插件不会察觉，所有 token 都按同一套单价算。
- **不含推理 token**：`reasoningTokens` 是输出计费的子集，加上去会重复计算。
- **是估算不是账单**：只算 token 费用，不含最低消费、阶梯价、汇率、赠送额度。
- **峰谷时段写死**：北京时间周一至周五 09:00–12:00、14:00–18:00。

数字背后的设计取舍，以及这个插件绕过的 DSH 内部机制，都在 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)（英文）。

## 开发

```powershell
node .\check.mjs         # 43 项：测试客户端半边，默认测 ./client.js
node .\check-host.mjs "<profile>\plugins\session-cost\host.js"   # 33 项：测试 host 半边
```

`check.mjs` 除了 Node 什么都不需要：它用一个只覆盖组件实际用到的那几个 API 的 React 替身把客户端半边渲染出来。

`check-host.mjs` 要 import host 半边，而后者从自己所在位置解析 `@deepseek-ai/schemastery` 和 `zod` —— 这两个由 DeepSeek Harness 提供。所以指向一份已安装的副本跑（通常是这种情况），或者先把这两个依赖装上。不带参数直接跑时它会明确告诉你该怎么做，而不是静默失败。

## License

MIT © 2026 jxh020496-cmd
