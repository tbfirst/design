# Cloudflare Tunnel 接入指南（tbfirst-prod）

本目录用于 Cloudflare Tunnel 容器化接入。Tunnel 让办公室迷你主机**无需公网 IP、无需开端口、无需 ICP 备案**，由 CF 边缘做唯一外部入口并自动签发 HTTPS。

> 完整技术规格见 `.ralph/specs/cloudflare-tunnel.md`，本 README 仅为操作手册。

---

## 关键约定（必读）

- 本项目使用 **Token 模式**，路由（ingress）**全部配在 Cloudflare 控制台的 Public Hostname**，**不在本地任何 `ingress.yml` / `config.yml` 文件**。
- cloudflared 容器与 gateway 容器同处一个 docker network，cloudflared 通过服务名 `gateway` 直连，**不走宿主机端口**。
- gateway 端口绑定 `127.0.0.1:8000:8000`，仅 loopback 监听，不向公网开放。
- HTTPS 证书由 CF 边缘自动签发并续期，迷你主机无需任何证书相关运维。

---

## 5 步上线流程

### 步骤 1 — 准备 Cloudflare 账号 & 域名

1. 注册 Cloudflare 账号（免费版即可满足本场景）。
2. 把目标域名（示例：`yourdomain.com`）的 NS 记录托管到 Cloudflare（在域名注册商处把 NS 改为 CF 给的两条 NS）。
3. 等待 NS 生效（通常 < 1 小时，可用 `dig NS yourdomain.com` 验证）。

### 步骤 2 — 进入 Zero Trust → Networks → Tunnels

1. CF 控制台 → 左侧 **Zero Trust** 入口。
2. 进入后再选 **Networks** → **Tunnels**。
3. 首次进入 Zero Trust 需选 Team name（随便填，仅自用）+ 免费套餐（Free）。

### 步骤 3 — 创建 Tunnel `tbfirst-prod`

1. 点 **Create a tunnel**。
2. Connector type 选 **Cloudflared**（默认）。
3. Tunnel 名字填：`tbfirst-prod`。
4. 进入 **Choose your environment** 页面后，**忽略**下载 cloudflared 客户端的步骤（我们用 Docker 容器跑），直接拉到页面最下方复制 token 字符串（形如 `eyJhIjoi...`，约 200 字符）。

### 步骤 4 — Token 写入 `.env.prod`

1. 在迷你主机 `E:/tbfirst/.env.prod`（或部署目录的 `.env.prod`）追加：

   ```dotenv
   CLOUDFLARE_TUNNEL_TOKEN=eyJhIjoi... # 步骤 3 复制的 token
   ```

2. 占位项已在 `.env.example` 末尾备好，按需替换。
3. **不要** commit 真实 token 到 git；`.env.prod` 默认在 `.gitignore` 里。
4. 启动：`docker compose -f docker-compose.prod.yml --env-file .env.prod up -d cloudflared`。
5. 验证容器状态：`docker logs tbfirst-cloudflared-prod` 应见 `Registered tunnel connection` 字样。

### 步骤 5 — 配置 Public Hostname（路由映射）

1. 回到 CF 控制台 → Tunnel 列表 → 进入 **tbfirst-prod** → **Public Hostname** tab → **Add a public hostname**。
2. 字段填写：
   - **Subdomain**：`tbfirst`（或留空 = 根域名）
   - **Domain**：`yourdomain.com`
   - **Service Type**：`HTTP`
   - **URL**：`gateway:8000` （**注意**：是 docker network 内的服务名，**不是** `localhost:8000`，**不是** `127.0.0.1:8000`）
3. 保存。约 30 秒内即可通过 `https://tbfirst.yourdomain.com` 访问。
4. 如需多域名/灰度，重复 Add 即可（同一 Tunnel 支持多 Public Hostname）。

---

## 常用命令

```bash
# 看 cloudflared 是否成功连上 CF 边缘
docker logs tbfirst-cloudflared-prod | tail -30

# 重启隧道（改 token / network 异常时）
docker compose -f docker-compose.prod.yml restart cloudflared

# 在线状态查询：CF 控制台 → Tunnel → Status 应为 Healthy（绿色）
```

## 常见问题

| 现象 | 排查 |
|---|---|
| Tunnel 状态 `Inactive` | token 错/过期 → CF 控制台重新生成 → 改 `.env.prod` → 重启 cloudflared |
| 域名访问 502 | Public Hostname 里 URL 写错（应为 `gateway:8000`）；或 cloudflared 与 gateway 不同 network |
| 域名访问 404 | 走通了 cloudflared → gateway，但 gateway 内部路由没匹配 → 看 `docker logs tbfirst-gateway-prod` |
| 首字节慢 (>3s) | CF 边缘到办公室链路抖动 → CF 控制台看 connector 延迟 |

更多故障排查与迁移路径见 `.ralph/specs/cloudflare-tunnel.md` §5–§7。
