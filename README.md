# IPHealth · 代理池 IP 健康度检测工具

一个 Windows x64 桌面工具：**导入代理 / 代理链接 → 批量测速、测延迟、测 IP 健康度、查 IP 归属地**。

界面基于 Electron，代理协议由内置的 [mihomo](https://github.com/MetaCubeX/mihomo)（Clash.Meta）内核驱动，
每个节点自动分配一个本地监听端口，检测请求真实经过该节点发出，结果可复现。

![主界面](docs/screenshot.png)

<details>
<summary>导入面板 / 节点详情</summary>

![导入面板](docs/screenshot-import.png)

![节点详情](docs/screenshot-detail.png)

</details>

---

## 功能

| 模块 | 说明 |
| --- | --- |
| 多格式导入 | 单条添加、批量链接、订阅地址、文件导入（拖入 .txt/.yaml/.json/.conf） |
| 多协议支持 | VMess / VLESS / Trojan / Shadowsocks / SSR / Hysteria / Hysteria2 / TUIC / AnyTLS / SOCKS5 / HTTP / WireGuard |
| 延迟检测 | 先预热再 3 次采样，输出平均延迟与抖动；同时给出 TCP 握手延迟 |
| 测速 | 通过节点真实下载指定数据量，换算 Mbps（测速源可切换） |
| IP 归属地 | 出口 IP、国家/地区/城市、ISP、ASN、IP 类型（住宅 / 机房 / 移动 / 代理） |
| IP 健康度 | 0–100 分综合评分，含 DNSBL 黑名单查询、代理特征识别 |
| 结果管理 | 排序、筛选、搜索、多选删除、详情抽屉（含健康度扣分依据）、CSV / JSON / TXT 导出 |
| 并发调度 | 可配置并发数与超时，实时进度与逐条结果回填，可随时停止 |
| 容错 | 单个节点配置非法时二分定位并剔除，不影响整批检测 |
| 界面 | 明暗双主题（工具栏太阳图标切换），设置与节点列表本地持久化 |

## 支持的导入格式

工具会自动识别内容格式，无需手动选择：

- **代理链接**：`vmess://` `vless://` `trojan://` `ss://` `ssr://` `hysteria://` `hysteria2://` `hy2://` `tuic://` `anytls://` `socks5://` `socks://` `http://` `https://`
- **纯文本代理**：`host:port`、`host:port:user:pass`、`user:pass@host:port`
- **Clash / Clash.Meta 配置**：`proxies:` YAML（支持 ws-opts / grpc-opts / reality / plugin 等嵌套字段）
- **sing-box 配置**：`outbounds:` JSON
- **SIP008**：Shadowsocks 官方订阅 JSON（`servers:`）
- **Surge / Loon / Shadowrocket**：`名称 = ss, host, port, encrypt-method=..., password=...`
- **Quantumult X**：`shadowsocks=host:port, method=..., password=..., tag=...`
- **Base64 订阅**：整段 Base64（自动解码，支持多层）
- **订阅链接**：自动携带 Clash 客户端 UA，兼容 Clash / V2Ray / 通用 Base64 订阅

> 若 Clash 配置里只有 `proxy-providers`（远程 provider），工具会提示改用 provider 的订阅链接导入。

## 健康度评分

满分 100，扣分项：

| 维度 | 扣分 |
| --- | --- |
| 出口 IP 被识别为代理/VPN | −32 |
| 出口 IP 属于机房/IDC | −22 |
| 同时命中代理 + 机房 | −45 |
| DNSBL 黑名单（Spamhaus / SpamCop / s5h / UCEPROTECT） | 每条 −12，最多 −30 |
| 延迟 > 2000ms / > 1000ms / > 500ms | −18 / −10 / −5 |
| 速度 < 0.5 / 2 / 8 Mbps | −14 / −8 / −3 |
| 归属地查询失败 | −10 |

等级：**优秀** ≥85、**良好** ≥70、**一般** ≥50、**较差** <50。

## 使用

1. 下载 `IPHealth-<版本>-win-x64-portable.exe` 双击运行（单文件免安装，内置内核，首次启动会解压到临时目录）；
   或下载 `IPHealth-<版本>-win-x64.zip` 解压后运行 `IPHealth.exe`。
2. 点击 **导入代理** → 选择导入方式（批量链接 / 订阅地址 / 单条添加 / 文件导入）。
3. 点击 **全面检测**，或从下拉菜单选择「仅测延迟 / 延迟+速度 / 延迟+IP 健康度」。
4. 检测完成后可按延迟、速度、健康度排序，导出 CSV/JSON。

快捷键：`Ctrl+I` 导入，`Ctrl+Enter` 执行导入，`Esc` 关闭弹层。

## 设置项

- 并发数（默认 8）、延迟超时（8s）、测速数据量（10MB）、测速超时（20s）
- 测速源：Cloudflare / Cachefly / OVH / Tele2
- 深度健康检测：开启后额外查询 DNSBL（更准，但更慢）
- 延迟检测地址、取 IP 地址：可自定义，留空使用默认

## 从源码构建

```bash
npm install
npm run fetch-core     # 下载 mihomo 内核到 vendor/mihomo.exe
npm start              # 开发运行
npm run dist           # 打包 → dist/IPHealth-<版本>-win-x64.zip
npm run dist:exe       # 用 NSIS 生成单文件便携 exe（需安装 NSIS）
```

> 打包说明：默认关闭代码签名与 exe 资源改写（`signAndEditExecutable: false`），
> 以避免在无证书环境下拉取 winCodeSign；exe 图标与版本信息由 NSIS 脚本写入。

自检脚本：

```bash
node scripts/test-parser.js   # 21 种导入格式解析测试
node scripts/test-config.js   # 生成的 mihomo 配置合法性校验
node scripts/test-runner.js   # 调度/失败处理端到端测试
```

## 技术架构

```
electron/main.js        主进程：窗口、IPC、订阅拉取
electron/lib/parser.js  多格式解析 → 统一节点模型
electron/lib/core.js    mihomo 配置生成与进程管理（每节点一个 mixed listener）
electron/lib/tester.js  延迟 / 测速 / 取 IP（HTTP CONNECT 隧道）
electron/lib/geo.js     归属地批量查询、DNSBL、健康度评分
electron/lib/runner.js  分批 + 并发调度，流式回传结果
renderer/               界面（原生 HTML/CSS/JS，无框架）
vendor/mihomo.exe       代理内核（打包时放入 resources/core）
```

## 说明

- 工具只做「检测」，不提供任何代理线路，也不修改系统代理设置。
- 检测过程会真实向测试目标发起下载，请留意流量消耗（默认单节点 10MB）。
- 内核缺失时窗口右上角会显示「内核缺失」，执行 `npm run fetch-core` 或重新下载发行版即可。

## License

MIT
