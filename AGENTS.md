# AGENTS.md

## Browser Debugging Memory

- 调试浏览器扩展时，如果用户已经打开了登录过的 Chrome，而且问题就在当前页面复现，先用这个正在运行的 Chrome。不要默认再启动一个新的 Chrome 实例。
- 新启动的 Chrome 往往没有登录态、没有当前页面、没有现成的扩展状态，容易把问题“测没了”。
- 如果当前运行中的 Chrome 不是带 `--remote-debugging-port` 启动的，就不要指望 `mcp__chrome_devtools__` 直接接管它。这个时候应当改用 `mcp__computer_use__` 操作现成窗口，并直接使用这个窗口里已经打开的 DevTools 面板看 Elements、Console、Performance。
- 处理顺序优先这样做：
  1. 连接正在运行的 `Google Chrome` 窗口。
  2. 保留用户当前的复现页面，不要换成新标签页新环境。
  3. 如果刚刚重新打包了扩展，用同一个窗口里的 `chrome://extensions/` 点“重新加载”。
  4. 回到原来的复现页面，直接做真实点击、滚动、切换页面。
  5. 用页面里的真实表现和 Chrome 自带 DevTools 的实时数据判断问题有没有复现、有没有修好。
- 当用户明确说“不要启动新的 Chrome”时，把这当成硬限制，不要绕开。
- 详细步骤看 `.agents/skills/extension-real-browser-testing/references/workflow.md`。
