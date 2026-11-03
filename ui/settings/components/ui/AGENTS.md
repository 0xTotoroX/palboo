# components/ui/ — Web 基础控件

> L2 | 父级：[设置页地图](../../AGENTS.md)

基于 shadcn/ui 的 new-york-v4 registry 与 Radix 定制；只提供结构、交互和样式，不调用业务 API。页面通过 props 传入状态；utils.cn 合并类名，styles.css 映射共享颜色，settings-controls.css 统一控件几何。添加上游组件时通过根目录 components.json 路由到这里；其中 iconLibrary 是上游生成选项，生成的图标引用须改用 shared/icons，不据此安装另一套图标库。

- [button.tsx](button.tsx)：Button 提供按钮变体与内边距，Slot 支持复用子元素；IconButton 复用同一个 Button，宽度采用固定32px避免随根字号挤出固定操作列（提示词行用28px），要求 aria-label，默认普通按钮/ghost，可显式保留 submit、其他变体、ref 和全部原事件，不添加 DOM 包装或 Tooltip。
- [action-feedback.tsx](action-feedback.tsx)：接收真实请求状态，固定18px的操作/等待/成功图标和等宽文字；成功勾号默认短暂保留，retainSuccess可保留真实结果；标签原位160ms切换，不发请求。键盘保留等待指示，减少动态效果使用静态状态。
- [input.tsx](input.tsx)：输入框及输入控件的公共样式。
- [suggestion-input.tsx](suggestion-input.tsx)：可自由输入的候选框；键盘/指针选择只更新原草稿，Esc 取消、输入法确认不选取，普通失焦沿用调用方保存流程；列表沿用共用菜单样式并在底部空间不足时向上显示。可选 dropdown 属性提供展开箭头、读取回调及忙碌/成功/空/错误状态，主动展开显示全部候选、输入时过滤；外部点击和 Esc 关闭，组件不发网络请求。箭头使用共享图标；列表常驻并冻结退出选项，收起立即inert/aria-hidden，普通候选即时开合，模型dropdown入场为300ms/bounce0.1弹簧与scale .8/opacity0/blur8px；关闭即时，向上列表从输入框所在的底边展开。
- [native-select.tsx](native-select.tsx)：保留原生选择语义与事件的下拉框，复用输入样式；controlWidth 保留 compact/short/medium/full（默认full）兼容；设置页独立选择框统一等宽，compact 与并排组合保留紧凑尺寸。宽度随字号适配、不随当前选项变化、不超出容器，统一右对齐。native-select.css 在设置与官网共用的支持 base-select 浏览器中统一同色系菜单底色、控件等宽弹出菜单、选中态与键盘焦点，大字号长值可换行增高，不支持时保留原生菜单；settings-motion.css跟随本机普通设置菜单即时开合，不改变 onChange、禁用选项或保存流程。可选action槽将附属星星放在文字与箭头之间，预留文字空间，附属按钮保持独立键盘焦点与点击。
- [card.tsx](card.tsx)：语义设置分组，沿用共享留白，不重复叠加卡片边框。
- [switch.tsx](switch.tsx)：Radix 开关负责键盘与受控状态，保留独立挂载时的基础尺寸；settings-controls.css 统一设置页内的轨道、滑块与位移动画。
- [LICENSE](LICENSE)：shadcn/ui 原始 MIT 许可，分发时并入第三方声明。

[PROTOCOL]: 变更时更新本文，然后检查父级 AGENTS.md。

设置页的控件高度、微圆角、柔和灰底、灰阶选中底和细焦点线统一由 settings-controls.css 管理；Button 暴露 data-variant 以区分描边按钮与主操作；基础组件保留独立挂载需要的默认样式、语义及原生/Radix 行为，样式不进入宿主工作台。

设置页中的输入、选择和按钮文字读取共享表单字号变量，与标签一同缩放；基础组件的独立挂载默认字号保留。

由 settings-host.css 消费宿主尺寸变量覆盖控件几何；settings-controls.css提供共享基础样式。开关轨道/圆形滑块及端点沿用宿主读数，透明命中区域保留可操作高度；输入箭头和图标空间不被统一内边距覆盖。Button 的 data-size 明确标识图标按钮，包含状态层的图标也不受文字按钮内边距影响。

- `native-select.css`：NativeSelect结构、箭头定位和原生菜单的共享皮肤；箭头只在此处用独立 translate 进行一次垂直居中，不在组件叠加 Tailwind 位移；居中与展开 rotate 分开合成，验收收起、向下展开、向上弹出及再次关闭的实际图形中心；设置与网站入口直接导入，不带Tailwind Preflight或宿主采样，设置页继续覆盖宿主控件几何。
- `segmented-group.css`：设置与网站共用的分段选中表面，颜色由所属文档语义变量提供。
- `segmented-group.tsx`：保持原按钮和回调的单一选中底块，280ms/bounce0弹簧采样；按真实按钮几何测量，快速选择从当前合成位置接续，尺寸变化/键盘/减少动态效果立即定位，不给业务列表或侧边导航加额外动画。官网位置、排列和材质选项同源，键盘即时切换。
