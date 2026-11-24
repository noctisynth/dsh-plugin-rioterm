# Rio WASM 宿主资源

版本 `0.1.8` 只提供一个固定资源：`/dsh-plugin-rioterm/wasm/0.1.8.wasm`。打包时，将该版本的 `librio_wasm_bg.wasm` 复制成 `lib/rioterm-0.1.8.wasm`，与 ESM 宿主入口 `lib/index.js` 放在一起。无需 CDN、查询令牌或额外端口；WASM 编译仍受当前页面的 CSP 约束。

- 客户端应在 DSH 已认证的同源页面请求资源；有部署前缀时，从应用基址解析相对地址 `dsh-plugin-rioterm/wasm/0.1.8.wasm`。该路由不接收文件路径或 URL 参数。
- HTTP 请求由 DSH `connection.admit` 验证 Host、Origin 和凭据；进程内读取使用调用方已获准的 Peer。只有仍有效的 owner Peer 能读取。
- `GET` 返回 `application/wasm`；`HEAD` 返回同样的元数据而不读取响应体。两者不允许共享缓存、跨源使用或 MIME 嗅探。命名 resource 只支持这两种方法。拒绝或缺文件不会返回本机文件路径。
- `401` 表示缺少有效认证，`403` 表示未被信任或无权读取，`404` 表示该资源未打包或路由未注册。成功下载与页面能否编译 WASM 是两个独立检查；插件不修改页面 CSP。
