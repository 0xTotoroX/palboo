// [INPUT]: 隔离测试的进程级环境与原生启动参数。
// [OUTPUT]: 合成 App、Shim 与共享服务监督进程；不读取用户数据。
// [POS]: direct_session_tests.rs 的原生进程树夹具，不作为产品入口。
// [PROTOCOL]: 变更时同步 tests/AGENTS.md。
import Foundation
import Darwin

let env = ProcessInfo.processInfo.environment
let name = URL(fileURLWithPath: CommandLine.arguments[0]).lastPathComponent
if name == "stock" {
    if env["CODEX_CLI_PATH"] != nil || env.keys.contains(where: { $0.hasPrefix("CODEXHOST_") }) { exit(77) }
    while true { sleep(1) }
}
let node = env["CODEXHOST_HOST_NODE_PATH"]!
let runtime = env["CODEXHOST_HOST_RUNTIME_PATH"]!
var children: [Process] = []
func start(_ path: String, _ args: [String]) throws -> Process {
    let child = Process()
    child.executableURL = URL(fileURLWithPath: path)
    child.arguments = args
    child.standardInput = FileHandle.nullDevice
    child.standardOutput = FileHandle.nullDevice
    child.standardError = FileHandle.nullDevice
    try child.run()
    return child
}
if name == "codexhost" {
    if FileManager.default.fileExists(atPath: env["CODEXHOST_DATA_DIR"]! + "/fail-host") { exit(23) }
    let child = try start(node, [runtime, "service"])
    if let index = CommandLine.arguments.firstIndex(of: "--ready-file") {
        let ready = CommandLine.arguments[index + 1]
        FileManager.default.createFile(atPath: ready, contents: Data("ready\n".utf8), attributes: [.posixPermissions: 0o600])
    }
    child.waitUntilExit()
    exit(child.terminationStatus)
}
if name == "Fixture" {
    let port = CommandLine.arguments.first { $0.hasPrefix("--remote-debugging-port=") }!.split(separator: "=").last!
    children.append(try start(node, [runtime, "cdp", String(port)]))
    children.append(try start(env["CODEX_CLI_PATH"]!, ["app-server", "--analytics-default-enabled"]))
    // 私有 CLI 在 exec Shim 前启动前台 Host；后台保留真实桌面祖先。
}
signal(SIGTERM, SIG_IGN)
let terminate = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
terminate.setEventHandler {
    for child in children where child.isRunning { child.terminate() }
    exit(0)
}
terminate.resume()
DispatchQueue.main.asyncAfter(deadline: .now() + 90) {
    for child in children where child.isRunning { child.terminate() }
    exit(99)
}
dispatchMain()
