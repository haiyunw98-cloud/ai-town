# 灯塔镇 AI Town

灯塔镇是基于 [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town) 的中文化衍生版本。默认世界是一座架空江南水乡：九名 AI 居民在茶馆、书院、工坊、百草铺、灯笼坊、鱼市、卦馆、码头和中央灯塔之间生活、交谈并形成长期记忆。界面支持中英切换，代理对话语言由部署环境统一配置。

## 已完成的改造

- 默认简体中文界面，可在页面底部切换英文。
- 九名原创居民：林澜、沈砚、唐果、墨七、苏萤、白露、顾潮、阿满、玄微先生。
- 原创灯塔镇地图、江南瓦片和八组四方向人物像素素材。
- Image 2 视觉方向与活动插画，地图运行资产仍由可复现 SVG 生成器输出。
- 内置「灯塔镇百万金贝寻宝赛」以及观察者排行榜、倒计时和本地镇志。
- 日常生活为主线，雾潮与“无海航路”为缓慢展开的谜团暗线。
- 支持 Ollama、OpenAI、Together.ai 和通用 OpenAI-compatible 服务。
- 支持 Convex Cloud 与 Docker 自托管 Convex。

## 环境要求

- Node.js 18 或更高版本（建议使用当前 LTS）
- npm
- 以下二选一：Convex 账号，或 Docker Desktop / Docker Engine
- 一个聊天模型和一个嵌入模型。所有居民共享同一套模型，不需要每名居民单独部署模型。

复制配置模板：

```bash
cp .env.example .env.local
```

`WORLD_LOCALE=zh-CN` 是默认值。设为 `WORLD_LOCALE=en` 会让所有 AI 居民统一使用英文。网页底部的语言按钮只切换当前浏览器的界面和静态文案，不会改变共享世界中其他玩家看到的代理对话。

## 方式一：Convex Cloud

```bash
npm install
npm run dev
```

首次运行会要求登录 Convex。启动完成后访问 <http://localhost:5173>。

模型变量需要写入 Convex 部署环境，而不仅是浏览器的 `.env.local`。例如使用本地 Ollama：

```bash
npx convex env set WORLD_LOCALE zh-CN
npx convex env set LLM_PROVIDER ollama
npx convex env set OLLAMA_HOST http://127.0.0.1:11434
npx convex env set OLLAMA_MODEL gemma4:12b
npx convex env set OLLAMA_EMBEDDING_MODEL mxbai-embed-large
npx convex env set OLLAMA_EMBEDDING_DIMENSION 1024
```

如果 Convex 运行在云端，它无法直接访问你电脑的 `127.0.0.1`。需要使用安全隧道暴露 Ollama，或改用云端模型提供商。

## 方式二：Docker 自托管 Convex

启动前端、后端和控制台：

```bash
docker compose up --build -d
docker compose exec backend ./generate_admin_key.sh
```

把输出的管理密钥写入 `.env.local`：

```dotenv
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
CONVEX_SELF_HOSTED_ADMIN_KEY="替换为管理密钥"
```

初始化并持续同步 Convex 函数：

```bash
npm run predev
npm run dev:backend
```

服务地址：前端 <http://localhost:5173>，Convex <http://localhost:3210>，控制台 <http://localhost:6791>。Docker 中的 Convex 访问宿主机 Ollama 时使用：

```bash
npx convex env set LLM_PROVIDER ollama
npx convex env set OLLAMA_HOST http://host.docker.internal:11434
```

## 模型配置

四种提供商取值如下（实际只保留其中一行）：

```dotenv
LLM_PROVIDER=ollama
LLM_PROVIDER=openai
LLM_PROVIDER=together
LLM_PROVIDER=custom
```

### Ollama：本地 Qwen 或 Gemma

模型标签必须与 `ollama list` 完全一致。本地已经安装 Gemma 12B 时可以直接使用：

```bash
npx convex env set LLM_PROVIDER ollama
npx convex env set OLLAMA_MODEL gemma4:12b
```

切换到 Qwen 示例：

```bash
npx convex env set OLLAMA_MODEL qwen3.5:9b
```

聊天模型不能代替记忆检索所需的嵌入模型。默认使用 `mxbai-embed-large`；也可以改成其他嵌入模型，但必须同步设置其真实维度。

### OpenAI

```bash
npx convex env set LLM_PROVIDER openai
npx convex env set OPENAI_API_KEY '你的密钥'
npx convex env set OPENAI_CHAT_MODEL gpt-4o-mini
npx convex env set OPENAI_EMBEDDING_MODEL text-embedding-3-small
npx convex env set OPENAI_EMBEDDING_DIMENSION 1536
```

### Together.ai

```bash
npx convex env set LLM_PROVIDER together
npx convex env set TOGETHER_API_KEY '你的密钥'
npx convex env set TOGETHER_CHAT_MODEL meta-llama/Llama-3-8b-chat-hf
npx convex env set TOGETHER_EMBEDDING_MODEL togethercomputer/m2-bert-80M-8k-retrieval
npx convex env set TOGETHER_EMBEDDING_DIMENSION 768
```

### LM Studio、vLLM、LocalAI 或其他兼容服务

本地服务可以不设置密钥。程序会把末尾的 `/v1` 自动规范化：

```bash
npx convex env set LLM_PROVIDER custom
npx convex env set LLM_API_URL http://127.0.0.1:1234/v1
npx convex env set LLM_MODEL qwen-local
npx convex env set LLM_EMBEDDING_MODEL text-embedding-local
npx convex env set LLM_EMBEDDING_DIMENSION 1024
```

需要鉴权时再设置 `LLM_API_KEY`。

## 更换嵌入模型

嵌入模型决定数据库中向量的维度。更换模型或维度后，旧记忆向量不能继续使用。

> **危险：下面的命令会永久删除当前 Convex 部署中的全部小镇数据、对话和记忆。先导出需要保留的数据，并确认当前连接的是正确的开发环境。**

```bash
npx convex run testing:wipeAllTables
npx convex run init
```

生产环境必须显式添加 `--prod`，不要把清库操作写入自动启动脚本。

## 修改角色与地图

- 世界设定：`data/worlds/lighthouse-town/manifest.ts`
- 居民资料：`data/worlds/lighthouse-town/characters.ts`
- 地图：`data/worlds/lighthouse-town/map.ts`
- 瓦片与人物生成器：`scripts/generate-lighthouse-assets.mjs`
- 生成后的资产：`public/assets/worlds/lighthouse-town/`

重新生成并验证视觉资产：

```bash
node scripts/generate-lighthouse-assets.mjs
npm run validate:world
```

修改角色或地图后，已有 Convex 世界不会自动被覆盖；请阅读上一节的数据清理风险再重新初始化。

## 观察记录与百万金贝寻宝赛

页面右侧默认打开「赛事直播」。活动尚未创建时，它会显示「灯塔镇镇志」，读取本地 Convex 中已经保存的居民对话；活动开始后显示八人排行榜、金贝数、阶段倒计时、公开采访和淘汰记录。选择「居民详情」仍可查看单个居民及其对话。

「赛事直播」页签顶部的「导出完整日报」按钮会下载当日 Markdown。日报依次包括：日报元数据、全镇事实概览、居民逐人记录、关系记录、机构与地点、活动分类、当日对话、赛事与公共事件、生活记录附录、原始对话附录、数据说明。

日报来源仅为现有本地消息（messages）、生活事件（lifeEvents）、当前状态、居民资料（profiles）、地点（landmarks）和赛事（events）。它记录可核对的事实，不撰写研究结论，也不根据缺失信息推断原因或动机。

首场活动会在八名居民全部初始化后自动公布，也可以手动检查或创建：

```bash
npx convex run events:ensureFirstEvent '{}'
npx convex run events:observerSnapshot '{}'
```

迁移角色或地图前，建议先备份本地观察记录：

```bash
mkdir -p backups
npx convex export --path backups/lighthouse-town-before-migration.zip
```

`backups/` 已被 Git 忽略。当前工作区迁移前的旧五人世界记录保存在 `backups/lighthouse-town-before-eight-residents.zip`，可使用 `npx convex import` 恢复到单独部署中查看。

## 测试

```bash
npm run lint
npm test -- --runInBand
npm run validate:world
npm run build
docker compose config
```

## 常见问题

- `ollama list` 为空：确认模型是否安装在另一个用户、数据目录，或实际由 LM Studio 托管。
- 云端 Convex 无法访问 Ollama：不要使用 `127.0.0.1`，配置安全隧道或云端模型。
- 提示嵌入维度不一致：核对模型真实维度，清理旧向量后重新初始化。
- 修改角色但页面未变化：旧世界已经写入数据库，需要显式清理并重新初始化。

## 许可证与署名

本项目保留上游 AI Town 的 MIT 许可证和原作者署名。灯塔镇新增代码与原创 SVG 资产同样按 MIT 许可证发布；视觉资产制作说明见 `public/assets/worlds/lighthouse-town/asset-sources.md`。
