// [INPUT]: 已验证的本机 CDP 连接、宿主原生进程身份和 Palboo 管理的兼容层归属。
// [OUTPUT]: 正式/开发后台跟随宿主真实退出；等待直启协调清理，或清理旧链已捕获的自有共享 Host。
// [POS]: server 生命周期协调；断连、暂停、热更与来源切换不等于宿主退出。
// [PROTOCOL]: 变更时同步 src/AGENTS.md。
use crate::{host::ProcessIdentity, state::App};
use anyhow::Result;
use std::{sync::Arc, time::Duration};
use tokio::sync::Mutex;

#[derive(Default)]
struct Bound {
    endpoint: Option<String>,
    owner: Option<ProcessIdentity>,
    compatibility: Option<crate::codex_host::shared_host::Lease>,
    coordinator: Option<ProcessIdentity>,
    missing: u8,
    exiting: bool,
}

#[derive(Default)]
pub(crate) struct Tracker(Mutex<Bound>);

impl Bound {
    fn observe(&mut self, live: Result<bool>) -> bool {
        match live {
            Ok(false) => self.missing += 1,
            Ok(true) | Err(_) => self.missing = 0,
        }
        self.missing >= 2
    }
}

impl Tracker {
    pub(crate) fn watch(self: &Arc<Self>, app: Arc<App>) -> tokio::task::JoinHandle<()> {
        let tracker = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut attempts = 0u64;
            loop {
                interval.tick().await;
                attempts += 1;
                let connection = app.view().connection;
                let mut state = tracker.0.lock().await;
                if (connection.status == "connected" || state.owner.is_none())
                    && (connection.endpoint != state.endpoint
                        || state
                            .owner
                            .as_ref()
                            .is_some_and(|owner| matches!(owner.alive(), Ok(false))))
                    && let Some(endpoint) = connection.endpoint
                {
                    match crate::host::process_for_endpoint(&endpoint).await {
                        Ok(owner) => {
                            state.owner = Some(owner);
                            state.endpoint = Some(endpoint);
                            state.compatibility = None;
                            state.coordinator = None;
                            state.missing = 0;
                            attempts = 1;
                        }
                        Err(error) => tracing::debug!(%error, "宿主退出跟随等待有效进程身份"),
                    }
                }
                if state.owner.is_some()
                    && state.compatibility.is_none()
                    && attempts % 5 == 1
                    && let Ok(Some(running)) = crate::codex_host::running().await
                    && running.managed_by(&app.paths)
                {
                    match crate::codex_host::direct::manager(&running) {
                        Ok(Some(manager)) => state.coordinator = Some(manager),
                        Ok(None) => {
                            if let Some(home) = dirs::home_dir() {
                                state.compatibility =
                                    crate::codex_host::shared_host::Lease::capture(
                                        &running.executable,
                                        home.join(".codexhost"),
                                    )
                                    .ok();
                            }
                        }
                        Err(error) => tracing::warn!(%error, "无法核验启动归属，保留兼容后台"),
                    }
                }
                if let Some(owner) = &state.owner {
                    let live = owner.alive();
                    if let Err(error) = &live {
                        tracing::warn!(%error, "无法确认宿主退出，保留后台");
                    }
                    if state.observe(live) {
                        tracing::info!("宿主进程已退出，正在清理 Palboo");
                        state.exiting = true;
                        crate::startup::phase("exit-start");
                        app.shutdown.notify_one();
                        break;
                    }
                }
            }
        })
    }

    pub(crate) async fn begin_exit(&self) -> bool {
        let mut state = self.0.lock().await;
        if state.exiting {
            return true;
        }
        if let Some(owner) = &state.owner
            && owner.alive().is_ok_and(|alive| !alive)
            && matches!(crate::host::desktop_process(&owner.executable), Ok(None))
        {
            state.exiting = true;
            crate::startup::phase("exit-start");
        }
        state.exiting
    }

    pub(crate) async fn finish(&self) -> Option<bool> {
        let mut state = self.0.lock().await;
        let owner = state.owner.clone()?;
        // 热更/模式交接只重建 Palboo，宿主仍在时不退出兼容层。
        let exited = owner.alive().is_ok_and(|alive| !alive);
        let replacement = crate::host::desktop_process(&owner.executable);
        if !exited || !matches!(replacement, Ok(None)) {
            return None;
        }
        let mut complete = true;
        if let Some(manager) = state.coordinator.take() {
            let deadline = tokio::time::Instant::now() + Duration::from_secs(22);
            loop {
                match manager.alive() {
                    Ok(false) => {
                        if !crate::codex_host::direct::cleanup_finished().is_ok_and(|done| done) {
                            complete = false;
                            tracing::warn!("启动协调已退出，但关联清理尚未确认完成");
                        }
                        break;
                    }
                    Ok(true) if tokio::time::Instant::now() < deadline => {
                        tokio::time::sleep(Duration::from_millis(100)).await
                    }
                    _ => {
                        complete = false;
                        tracing::warn!("Palboo 启动协调尚未完成退出，未强制结束");
                        break;
                    }
                }
            }
        }
        if let Some(lease) = state.compatibility.take()
            && let Err(error) = lease
                .stop(|| {
                    Ok(!owner.alive()?
                        && crate::host::desktop_process(&owner.executable)?.is_none())
                })
                .await
        {
            complete = false;
            tracing::warn!(%error, "关联 CodexHost 未完成退出；未停止其他实例");
        }
        if !owner.alive().is_ok_and(|alive| !alive)
            || !matches!(crate::host::desktop_process(&owner.executable), Ok(None))
        {
            return None;
        }
        Some(complete)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exits_only_after_confirmed_process_loss_and_retains_unknown_state() {
        let mut bound = Bound::default();
        assert!(!bound.observe(Ok(true)));
        assert!(!bound.observe(Ok(false)));
        assert!(!bound.observe(Err(anyhow::anyhow!("probe failed"))));
        assert!(!bound.observe(Ok(false)));
        assert!(!bound.observe(Ok(true)));
        assert!(!bound.observe(Ok(false)));
        assert!(bound.observe(Ok(false)));
    }

    #[test]
    fn native_identity_detects_pid_reuse_and_process_exit() {
        let identity = ProcessIdentity::read(std::process::id()).unwrap().unwrap();
        assert!(identity.alive().unwrap());
        let mut reused = identity.clone();
        reused.started_at_micros += 1;
        assert!(!reused.alive().unwrap());
        let mut child = std::process::Command::new("/bin/sleep")
            .arg("20")
            .spawn()
            .unwrap();
        let identity = ProcessIdentity::read(child.id()).unwrap().unwrap();
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(!identity.alive().unwrap());
    }
}
