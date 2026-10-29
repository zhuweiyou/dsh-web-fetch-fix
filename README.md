# dsh-web-fetch-fix

修复 DSH `web_fetch`：在开了 VPN/TUN（如 Clash fake-ip）的机器上，抓取公网网页会被误判成内网地址而拒绝。

## 用途

开着 TUN/fake-ip 时，`web_fetch` 抓网页会报：

```
Error: URL hostname "xxx" resolves to a non-public IP address
```

装上本插件后即可正常抓取，工具名、参数、其它行为都不变。

## 为什么这样做

Clash 等 TUN 的 fake-ip 会把**公网域名**解析成保留段地址（如 `198.18.0.53`），但 TUN 会把发往这个地址的连接透明路由到真实目标——所以它其实不是内网。官方抓取器 `@deepseek-ai/dsh-web-fetch-http` 里有一段“不是公网 unicast 就拒绝”的 SSRF 判定，把它挡掉了。

因此做法就是：**把官方 `web-fetch-http` 源码原样复制过来，只删掉这段判定**，其余（URL 校验、重定向、解压、charset、大小/超时限制等）完全不动。

## 与官方的差别

源码在 [`web-fetch-http/`](./web-fetch-http/)（基于官方 tag `dsh-v0.2.1-rc.3`）。相对官方只有两处改动：

1. [`src/network.ts`](./web-fetch-http/src/network.ts) 删除两处公网 IP 判定：

```ts
// 删除 1：公网 IP 判定
if (!isPublicIpAddress(entry.address)) {
  throw new WebError(`URL hostname "${hostname}" resolves to a non-public IP address`, 'WEB_BLOCKED_URL')
}
// 删除 2：NAT64 变体
if (translatedIpv4 !== undefined && !isPublicIpAddress(translatedIpv4)) {
  throw new WebError(`URL hostname "${hostname}" resolves through NAT64 to a non-public IPv4 address`, 'WEB_BLOCKED_URL')
}
```

2. [`src/provider.ts`](./web-fetch-http/src/provider.ts) provider id 由 `'http'` 改为 `'web-fetch-fix'`（避免和内置 provider 冲突，并让 `web.fetchProvider` 指向本插件）。

其余代码与官方一致。

## 构建

`npm install && npm run build`（esbuild 自动发现所有 `web-*/src/index.ts`，逐个生成 `web-*/lib/index.js`，DSH 加载的就是这些 JS）。

## 结构 / 扩展

一个仓库 = 一个 bundle，可包含多个被修补的包：每个 `web-*` 目录是一个官方 `packages/web/*` 的原样副本（只改必要几行），产物是 `web-*/lib/index.js`；`package.json` 用 `exports: { "./web-*": "./web-*/lib/index.js" }` 暴露子路径，`cordis.patch.yml` 里每个包一行 `insert`。

**以后再加一个 web 包，只有两步：**
1. 把官方 `packages/web/<name>` 原样复制成 `<name>/`，做你那几行改动；
2. 在 `cordis.patch.yml` 的 `insert` 里加一行：
   ```yaml
   - id: <行 id>
     name: dsh-web-fetch-fix/<name>
   ```
   若该包需要改 `web.*` 的选型（如 searchProvider），把字段并入**同一个** `- id: web` 的 config（不要新开第二个 `- id: web`，会被整体覆盖）。
   之后 `npm run build` 即可，`package.json` 不用改。

