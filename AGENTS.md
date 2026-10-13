# Repository Guidelines

## Project Structure & Module Organization

本仓库是一个基于 Vite + React 的 XML 格式化工具，并带有 uTools 插件相关配置。

- `src/main.jsx`：React 应用入口。
- `src/xml.js`：XML 解析、格式化、搜索、JSON 互转等纯逻辑，不依赖 React，改动优先落在这里。
- `src/App.jsx`：应用外壳，负责状态管理、文件读写、历史记录与各个面板。
- `src/XmlTree.jsx`：格式化结果的树形视图组件（折叠、搜索高亮）。
- `src/main.css`：全局样式。
- `public/plugin.json`：uTools 插件清单，关键词匹配用 `cmds`，文件匹配用 `type: files` + `match`。
- `public/preload/services.js`：插件预加载服务脚本，向渲染进程暴露 `readFile` / `writeFile` / `writeTextFile` / `writeImageFile`。
- `dist/`：构建输出目录，不应手动编辑。

## Build, Test, and Development Commands

- `npm install`：安装依赖，首次克隆或依赖变更后运行。
- `npm run dev`：启动 Vite 本地开发服务器，用于调试 React UI。
- `npm run build`：生成生产构建到 `dist/`，发布或打包前运行。
- `npm run lint`：按 StandardJS 规则检查代码风格（等价于 `npx standard`）。

## Coding Style & Naming Conventions

项目使用 ES modules、React function components 和 StandardJS 风格：

- 使用 2 空格缩进。
- JavaScript 字符串优先使用单引号。
- 语句末尾不使用分号。
- React 组件使用 PascalCase，普通函数与变量使用 camelCase。
- 与 XML 相关的纯逻辑一律放在 `src/xml.js`，保持为可直接测试的小函数。
- 格式化相关改动必须保留语义：混合内容（文本与子元素交错）不重排、不丢空白，实体转义需可往返。

## Testing Guidelines

当前仓库未配置测试框架或测试脚本。修改 XML 解析、格式化、历史记录、uTools preload 行为时，至少执行：

1. `npm run build`
2. `npm run lint`
3. 手动在开发服务器中验证有效 XML、无效 XML、空输入、CDATA、注释、DOCTYPE、带属性节点、混合内容，以及三种视图（树视图 / 源码 / JSON）与文件打开、另存为、拖拽载入。

如新增测试，建议使用 Vitest，并将测试文件命名为 `*.test.jsx` 或 `*.test.js`，靠近被测模块放置。

## Commit & Pull Request Guidelines

现有提交历史以简短中文说明为主，例如 `添加历史记录功能`、`修改logo`。继续保持：

- 提交信息使用祈使或概括式短句，聚焦一个变更点。
- PR 描述应包含变更摘要、验证命令和用户可见影响。
- UI 变更建议附截图或录屏。
- 涉及插件配置时，说明是否修改了 `public/plugin.json` 或 `public/preload/services.js`。

## Security & Configuration Tips

不要提交本地密钥、账号信息或机器专属路径。处理用户输入的 XML 时，避免引入会执行远程资源或脚本的逻辑；保持解析与展示在浏览器安全边界内完成。
