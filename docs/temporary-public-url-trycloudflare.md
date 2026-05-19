# 临时公开预览（trycloudflare）

目标：把 `public/` 的静态前端临时公开给别人访问 **UI**，不暴露本机 `server.js` 的 `/api/state` 写接口（避免写坏本地 JSON 数据）。

## 前置条件

- 已安装 Node.js（运行构建脚本用）
- 已安装 `cloudflared`

macOS 安装 `cloudflared`：

```bash
brew install cloudflared
```

## 启动步骤

在项目根目录执行。

### 1) 生成 / 更新 `public/`（推荐）

```bash
node scripts/build-public.js
```

### 2) 本地启动一个只服务 `public/` 的静态服务器

任选一个方案（都可以）。

方案 A：Python（macOS 通常自带）

```bash
python3 -m http.server 4175 --directory public
```

方案 B：Node（一次性运行，不需要全局安装）

```bash
npx http-server public -p 4175
```

确认本地可访问：打开 `http://localhost:4175`。

### 3) 打开临时隧道，生成公网 URL

新开一个终端窗口执行：

```bash
cloudflared tunnel --url http://localhost:4175
```

你会在终端里看到类似下面的输出，并得到临时 URL：

- `Your quick Tunnel has been created! Visit it at ...`
- `https://xxxxx.trycloudflare.com`

把这个 `https://*.trycloudflare.com` 发给别人即可访问。

## 停止 / 关闭

- 在运行静态服务器的终端里按 `Ctrl+C`
- 在运行 `cloudflared tunnel ...` 的终端里按 `Ctrl+C`

两者都停掉后，临时 URL 就会失效。

## 常见问题

### `Error unmarshaling QuickTunnel response ... 500 Internal Server Error`

这通常 **不是你本机服务没起来**，而是 `trycloudflare.com` 的 quick tunnel 接口临时返回了非 JSON 的错误页（500/限流等），`cloudflared` 解析失败就会报：

- `failed to unmarshal quick Tunnel: invalid character ...`

可行的处理方式：

1) 升级 `cloudflared`（有些版本会打印更明确的错误响应，方便判断是服务端问题）

```bash
brew upgrade cloudflared
cloudflared --version
```

2) 直接重试（这类错误常常是 Cloudflare 侧短暂波动/限流，等 1-5 分钟再试）

```bash
cloudflared tunnel --url http://localhost:4175
```

3) 如果你只是想“临时发一个公网 URL”且不强依赖 Cloudflare，改用一个备用方案（更稳）

```bash
npx localtunnel --port 4175
```

它会输出一个 `https://*.loca.lt` 的 URL，转发到本机 `4175` 端口。

### 打印了 URL，但浏览器打不开

终端通常会提示 “it may take some time to be reachable”。等几十秒到几分钟再试。

### Mac 熄屏后 URL 访问不了

如果 Mac 进入睡眠，本地静态服务和隧道都会断开。需要让 Mac “可熄屏但不睡眠”：

```bash
caffeinate -dimsu
```

保持这个命令窗口运行；退出按 `Ctrl+C`。

### `cloudflared` 正常，但访问是 502/Bad Gateway

通常是本地 `http://localhost:4175` 没有成功启动或端口不对。先确保你在本机能打开 `http://localhost:4175`。

