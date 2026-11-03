# Render 免费多人测试版

目标网址：https://connection-1mko.onrender.com 。此为用户提供的现有网址，不代表本项目已经部署到此处。当前环境访问该域名被出站代理拦截，尚未读取线上页面。

## 使用范围

所有手机访问同一个 HTTPS 网站，可以使用各自移动数据，无需同一 Wi-Fi。需部署真实 Node.js **Web Service**，不是单文件模拟 HTML，也不是 Static Site。

免费方案不创建收费磁盘或数据库。本地 SQLite 只用于联机测试；服务休眠、重启、替换容器或重新部署后，不保证保留房间、消息和身份。页面会显示临时存储提示。正式游戏如需可靠恢复，应另行接入持久数据库，目前尚未完成。

免费服务可能在闲置后休眠，第一次访问需等待唤醒，并受 Render 当前免费额度与资源限制约束。不要承诺全天在线，也不使用保活工具绕过平台限制。

## 更新已有 Web Service，尽量保留原网址

1. 确认服务连接本项目的 GitHub 仓库、分支和根目录；目录中应有 `server.js`、`package.json`、`Dockerfile` 与 `public/`。目标仓库为 `Mila-Levi/AI-Learning`，部署分支为 `main`。不要覆盖仓库原有未知修改。
2. 在 Render 核对这个服务的仓库、分支和 Root Directory。
3. **Docker Runtime**：使用根目录 Dockerfile，无需安装依赖或自定义启动命令。
4. **Node Runtime**：Build Command 填 `node --version`，Start Command 填 `npm start`；设置 `NODE_VERSION=24`，在构建日志确认实际 Node 版本为 24 或更新版本（需要内置 SQLite）。本项目无第三方依赖。
5. Environment 中设置 `HOST=0.0.0.0`、`DATA_DIR=/tmp/lake-chase`、`EPHEMERAL_STORAGE=true`。保留 Render 注入的 `PORT`，不要写死端口。
6. Health Check Path 填 `/health`，保持单实例，部署最新代码。
7. 日志应出现 `Lake Chase listening on port ...`，再访问实际 HTTPS 地址。

如果当前是 **Static Site**，需要新建 Web Service，使用新服务实际生成的网址。原静态站点不能直接执行此 Node 后端。

## 新服务的 Blueprint

仓库根目录 `render.yaml` 定义一个免费 Docker Web Service，可通过 Blueprint 导入 Git 仓库。它不会自动修改已有服务或沿用原网址；已有 Web Service 优先使用上述更新方式。

## 不同网络下的验收

1. 电脑或第一部手机打开网站，主持人建房。
2. 复制邀请链接给另一手机，另一手机使用移动数据打开并以不同昵称加入。
3. 两端分别发公开消息，应自动互相收到，不需要刷新。
4. 指定成员私发；验证其他成员不可见需要第三个普通玩家会话。主持人可审计全部私信，不能充当无关玩家。
5. 主持人确认感染，玩家手机的身份与公告同步变化。
6. 若页面顶部可以随意切换所有玩家身份，那仍是模拟版，不能据此验证联机。

`/health` 应返回 `ok:true`、`app:"lake-chase"`；免费测试配置下还应有 `storage:"temporary"`。健康检查通过不代替多人功能测试。主持人先不要关闭标签页，本版尚未支持身份找回和转交。

当前支持消息、身份同步和主动设备位置共享；高德地图、技能卡、正式游戏计时、后台连续定位、可靠数据恢复尚未实现。先测试消息与感染。

## 助理环境的联网检查

已保存网络草稿，加入 `connection-1mko.onrender.com` 和 `render.com`。保存草稿不代表运行时能访问：需要在环境设置中保存/应用网络变更，并按产品提示发布环境后重新验证。这只影响助理访问，不改变 Render 网站，也不是网站故障的证据。
