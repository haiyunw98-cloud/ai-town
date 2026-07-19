# 灯塔镇 AI Town

灯塔镇是基于 [a16z-infra/ai-town](https://github.com/a16z-infra/ai-town) 的中文化衍生版本。默认世界是一座架空的江南内陆水乡，镇上没有海；中心高塔只是历史公共地标，不承担航海、航标、观潮或海防功能。九名 AI 居民在书院、药庐、旧水码头、卦馆、茶庄、集市、镇公所、工坊和食肆之间工作、买卖、饮食、交友和生活。界面支持中英切换，代理对话语言由部署环境统一配置。

## 已完成的改造

- 默认简体中文界面，可在页面底部切换英文。
- 九名原创居民：林澜、沈砚、唐果、墨七、苏萤、白露、顾潮、阿满、玄微先生。
- 原创灯塔镇地图、江南瓦片和八组四方向人物像素素材。
- Image 2 视觉方向与活动插画，地图运行资产仍由可复现 SVG 生成器输出。
- 常驻「小镇观察」、上海当日对话速报、事实流水账与社会观察日志；已结束的百万金贝寻宝赛只作为折叠的历史公共事件保留。
- 居民自主对话只谈工作、收入、买卖、饮食、衣物、健康、友情、感情和公共生活。旧的雾潮、航路谜团与赛事消息仍作为历史记录保留，但不进入自主记忆或当日实时摘要。
- 当前居民对话、记忆摘要与反思只使用本地 Ollama `gemma4:12b`，不自动切换到 Qwen、OpenAI、Together.ai、DeepSeek 或付费后备。
- 支持 Convex Cloud 与 Docker 自托管 Convex。

## 环境要求

- Node.js 18 或更高版本（建议使用当前 LTS）
- npm
- 以下二选一：Convex 账号，或 Docker Desktop / Docker Engine
- 本地 Ollama `gemma4:12b` 和 `mxbai-embed-large`。所有居民共享同一套模型，不需要每名居民单独部署。

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
npx convex env set OLLAMA_EMBEDDING_MODEL mxbai-embed-large
npx convex env set OLLAMA_EMBEDDING_DIMENSION 1024
```

启动前请先运行 `ollama pull gemma4:12b` 和 `ollama pull mxbai-embed-large`。如果 Convex 运行在云端，它无法直接访问你电脑的 `127.0.0.1`；当前居民路径必须通过安全隧道访问本地 Ollama，配置云端付费提供商不会让居民自动切换过去。

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

通用 Docker 开发前端使用 <http://localhost:5173>，Convex 使用 <http://localhost:3210>，控制台使用 <http://localhost:6791>。Docker 中的 Convex 访问宿主机 Ollama 时使用：

```bash
npx convex env set LLM_PROVIDER ollama
npx convex env set OLLAMA_HOST http://host.docker.internal:11434
```

灯塔镇常驻独立站点使用专用前端端口 `4174` 和 Convex 端口 `3210`：

```bash
./scripts/install-lighthouse-site.sh
./scripts/check-lighthouse-site.sh
```

安装脚本会先构建当前 clone 或 worktree，再启动 `http://localhost:4174/ai-town`，不会使用或占用通用 Vite 开发端口 `5173`。

## 灯塔镇居民模型

当前常驻居民路径会预检 `LLM_PROVIDER=ollama`，并在对话、记忆摘要和反思请求中显式使用 `gemma4:12b`。`OLLAMA_MODEL` 只配置仓库中的其他通用模型调用，不会把居民切换到 Qwen 或其他模型。

```bash
ollama pull gemma4:12b
ollama pull mxbai-embed-large
npx convex env set LLM_PROVIDER ollama
npx convex env set OLLAMA_HOST http://127.0.0.1:11434
npx convex env set OLLAMA_EMBEDDING_MODEL mxbai-embed-large
npx convex env set OLLAMA_EMBEDDING_DIMENSION 1024
```

若 Ollama 不可用、生成失败，或模型返回空内容/旧谜团叙事，最终发送边界会改用当日话题相关的确定性规则文本。超长但其他方面有效的模型输出不会整段换成回退：它会优先保留第一个完整句子，否则按 Unicode 字形簇安全截短。上游通用提供商兼容标识 `LLM_PROVIDER=openai`、`LLM_PROVIDER=together` 和 `LLM_PROVIDER=custom` 仍保留在代码中，但它们不是当前居民配置：居民不会使用这些提供商或付费后备。未来若增加免费云模型，必须通过新的显式配置与实现启用。

日常话题按生计 `60%`、关系 `25%`、公共生活 `15%` 滚动选择。开场、续谈和离开消息的最终上限分别是 `45 / 60 / 35` 个 Unicode 字符，居民生成请求使用 `max_tokens: 120`。观察者若询问大海、潮汐或高塔的航行用途，发送边界会先回答“镇上没有海，这座塔只是地标。”，再用一句短问句回到镇上日常。

## 更换嵌入模型

嵌入模型决定数据库中向量的维度。Convex 编译 schema 时不读取运行时环境变量，因此向量索引维度是 `convex/util/embeddingDimension.ts` 中的静态数值：

```ts
export const EMBEDDING_DIMENSION = 1024;
```

更换嵌入模型时，必须同时修改这个静态数值，并在 Convex 环境中把 `OLLAMA_EMBEDDING_MODEL` 和 `OLLAMA_EMBEDDING_DIMENSION` 设为模型的真实名称与维度。重新构建/部署后，旧记忆向量不能继续使用。

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

## 小镇观察、双日报与历史赛事

页面右侧的常驻页签名为「小镇观察」。自动速报只读取上海时区当日消息，并按“劳动、商业、饮食、照护、友情与关系、公共生活”六类可见事实归纳。若过滤后没有新的日常事实，显示“暂无新的日常记录”。已结束的百万金贝寻宝赛位于当日生活内容之后，以默认折叠的「历史公共事件」展示，不作为居民当前主线。选择「居民详情」仍可查看单个居民及其对话。

「小镇观察」顶部有两个按需导出入口：「导出事实流水账」下载可核对的当日 Markdown；「生成社会观察日志」只把长度受限的当日事实摘要交给本地 Ollama `gemma4:12b` 谨慎扩写。模型失败时仍会下载确定性规则回退报告，不调用付费模型，也不新增报告数据库。

日报来源仅为现有本地消息（messages）、生活事件（lifeEvents）、当前状态、居民资料（profiles）、地点（landmarks）和赛事（events）。它记录可核对的事实，不撰写研究结论，也不根据缺失信息推断原因或动机。

每天上海时间 12:00–14:00，小镇会为九位配置居民创建一次安全活动，并按墙上时间逐阶段追赶进度。暂停或停止的小镇不会创建、推进活动，也不会调用模型；错过窗口会留下“未举行”事实记录。旧的百万金贝寻宝赛没有 `dailyKey`，永久只读归档，不再推进、决策或发奖。

每日活动正常完成时，系统只依据已经持久化的九位参赛者结果结算：参与 10 金贝、进入前四名再得 20 金贝、冠军再得 50 金贝；幂等账本键防止重复发奖。退出比赛的居民安全转入观众席，活动结束后九人都会写入返程生活记录并恢复普通生活。活动主持机构服务尚未接通，结算调用明确传入 `hostServices: null`，不会虚构机构收入或服务消耗。

活动模板与选择规则不依赖模型。只有本机 Ollama 的 `gemma4:12b` 可以改写简短主题和生成公开选择；失败时使用确定性回退。可以手动触发一次当下时刻的活动检查：

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
- 云端 Convex 无法访问 Ollama：不要使用 `127.0.0.1`，为本地 Ollama 配置受限的安全隧道；居民路径不会自动改用云端付费模型。
- 提示嵌入维度不一致：核对 `convex/util/embeddingDimension.ts` 的静态维度和 Convex 环境中的模型/维度，清理旧向量后重新初始化。
- 修改角色但页面未变化：旧世界已经写入数据库，需要显式清理并重新初始化。

## 许可证与署名

本项目保留上游 AI Town 的 MIT 许可证和原作者署名。灯塔镇新增代码与原创 SVG 资产同样按 MIT 许可证发布；视觉资产制作说明见 `public/assets/worlds/lighthouse-town/asset-sources.md`。
