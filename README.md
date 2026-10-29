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

`npm install && npm run build`（esbuild 生成 `web-fetch-http/lib/index.js`，DSH 加载的是这个 JS）。
