# reader/ — 本机笔记阅读、编辑与表格预览

> L2 | 父级：[AGENTS.md](../AGENTS.md)

- `files.rs`：授权根内的文件边界；通过 O_NOFOLLOW 逐层打开目录，拒绝隐藏文件、链接和特殊文件，限制笔记8 MB、图片32 MB。
- `edit.rs`：唯一 Markdown 写入边界；核对内容 SHA-256、路径和文件身份，拒绝硬链接/只读文件，通过同目录临时文件原子替换，保留权限、BOM和原换行类型；不提供新建、删除或重命名。
- `index.rs`：Markdown 全文索引、链接消歧/反链与表格文件名目录；保存后增量更新正文和反链，刷新时检测外部修改；索引只在内存，128 MB正文/十万文件上限。
- `spreadsheet.rs`：Calamine/CSV 按需解析 XLSX/XLS/XLSM/XLSB/ODS/CSV/TSV，返回工作表和100行分页；XLSX/XLSB流式读取，压缩包展开预算128 MB；不执行公式、宏或外链，不写表格。输入32 MB，最多十万行/512列/200工作表。
- `http.rs`：独立127.0.0.1端口与凭证、Host/Origin校验、本地静态资源；X-Palboo-Folder 选择已授权文件夹，凭证逐个匹配，索引逐个缓存；GET catalog/search/note/resolve/image/workbook；POST save要求同源、独立凭证与文件版本，冲突返回409。folder-open 在同一授权锁内校验来源并返回目标文件夹入口；settings-open仅请求宿主打开网站设置，不暴露设置凭证。后台退出停止监听，同目录授权下尽量复用地址与凭证。
- `tests.rs`：合成笔记/表格检索、反链、增量更新、只读哈希、保存冲突、路径/链接/权限/HTTP边界、旧配置无写入读取、多文件夹同名文件隔离/选择性撤销及重启凭据回归。

[PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
