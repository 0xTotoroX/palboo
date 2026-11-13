// [INPUT]: 隔离测试的进程级环境与原生启动参数。
// [OUTPUT]: 合成 App、Shim 与共享服务监督进程；不读取用户数据。
// [POS]: direct_session_tests.rs 的原生进程树夹具，不作为产品入口。
// [PROTOCOL]: 变更时同步 tests/AGENTS.md。
import Foundation
import Darwin

let env = ProcessInfo.processInfo.environment
let name = URL(fileURLWithPath: CommandLine.arguments[0]).lastPathComponent
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
    let child = try start(node, [runtime, "service"])
    child.waitUntilExit()
    exit(child.terminationStatus)
}
if name == "Fixture" {
    let port = CommandLine.arguments.first { $0.hasPrefix("--remote-debugging-port=") }!.split(separator: "=").last!
    children.append(try start(node, [runtime, "cdp", String(port)]))
    children.append(try start(env["CODEX_CLI_PATH"]!, ["app-server", "--analytics-default-enabled"]))
    // Shared service survives Desktop until the coordinator requests authenticated shutdown.
    _ = try start(env["CODEXHOST_LAUNCHER_EXECUTABLE"]!, [])
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
