# 慢慢走

一本从出发计划逐渐长成旅行回忆的个人轻手账网站。

第一册是南京。打开地图上的南京或书架上的封面，可以选出想去的地方、安排每天的计划，并在旅行时补上照片和随记。

## 开始使用

在项目根目录使用 Node.js 24 运行，无需安装第三方依赖。

```powershell
npm start
```

在浏览器打开 [本机手账](http://127.0.0.1:4173)。终端保持运行即可使用，按 Ctrl+C 停止。下次启动会打开同一本手账。数据和照片保存在 `local-data/slow-travel/journal.sqlite`，该目录已从 Git 中排除。

1. 翻开南京册，在「出发前的计划」中查看 15 个参考地点，标出想去或待定的地方，也可以手动添加。
2. 写下某一天想做的事，完成后勾选。在「旅行记录」中按天添加地点、感受和 JPEG、PNG 或 WebP 照片。
3. 下次旅行在书架选择「新建一册」。每一册独立保留计划和日记。
4. 从「备份」下载包含照片的 JSON 文件。恢复前确认备份来源，恢复会以备份内容替换当前手账，并使以前的只读链接失效。

本机和线上版各自保存数据；可以用完整备份在两者之间迁移。已打开的旧页面遇到其他页面的新修改时，会提示重新读取。

## 隐私与存储

本机版默认仅监听回环地址。若自行提供 HTTPS 反向代理，需要显式设置 `SLOW_TRAVEL_HOST`、`SLOW_TRAVEL_ORIGIN`、`SLOW_TRAVEL_OWNER_KEY`；密钥至少 32 个字符。可通过 `SLOW_TRAVEL_PORT` 和 `SLOW_TRAVEL_DATA_DIR` 设置端口及数据目录。

Sites 版本使用登录身份隔离个人手账，文字存入 D1，照片存入 R2。初始站点仅站主可访问。只读分享生成一份当时的日记快照，只包含选中旅行的基本资料、日记和照片。后续修改需要重新生成快照。接收方还需具备站点本身的访问权限。

单张照片最大 8 MiB。本机一份手账的已引用照片合计上限为 64 MiB，线上版为 20 MiB。导入前会检验照片与日记的引用关系。

## 开发

```powershell
npm test
npm run build
```

网页源文件在 `slow-travel/dist/`。南京初始内容独立保存在 `slow-travel/dist/content/book.json`，主题样式在 `slow-travel/dist/styles.css`。本机服务、共享数据校验与线上适配分别在 `slow-travel/server/` 和 `slow-travel/hosted/`。构建生成的根目录 `dist/` 不纳入版本管理。

## 项目资料

- [设计说明](docs/superpowers/specs/2026-10-31-slow-travel-design.md)
- [第一阶段实施计划](docs/superpowers/plans/2026-10-31-slow-travel-first-milestone.md)
- [南京攻略素材及来源说明](docs/research/2026-10-31-nanjing-xiaohongshu-materials.md)
- [结构化素材](slow-travel/content/nanjing-materials.json)
- [地图来源](docs/research/travel-atlas-map.md)

南京候选地点提取自四篇第三方存档。日期和实际经历由使用者填写，出行前需核对当时的场馆公告。南京封面是专为本项目生成的意象插画。

## 版本管理

使用 Git 保存代码、设计说明和经整理的参考资料。文本文件统一使用 LF；Windows 批处理文件使用 CRLF。

环境变量、数据库和本地上传目录已列入忽略规则。个人原始照片和私密旅行记录可存放在 `private/` 或 `local-data/`，不纳入版本库。
