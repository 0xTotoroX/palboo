// [INPUT]: 已验证的本机 CDP 连接、宿主原生进程身份和 Palboo 管理的兼容层归属。
// [OUTPUT]: 正式/开发后台跟随宿主真实退出，清理已捕获的自有共享 Host。
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
    missing: u8,
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
                            state.missing = 0;
                            attempts = 1;
                        }
                        Err(error) => tracing::debug!(%error, "宿主退出跟随等待有效进程身份"),
                    }
                }
                if state.owner.is_some() && state.compatibility.is_none() && attempts % 5 == 1 {
                    if let Ok(Some(running)) = crate::codex_host::running().await
                        && running.managed_by(&app.paths)
                        && let Some(home) = dirs::home_dir()
                    {
                        state.compatibility = crate::codex_host::shared_host::Lease::capture(
                            &running.executable,
                            home.join(".codexhost"),
                        )
                        .ok();
                    }
                }
                if let Some(owner) = &state.owner {
                    let live = owner.alive();
                    if let Err(error) = &live {
                        tracing::warn!(%error, "无法确认宿主退出，保留后台");
                    }
                    if state.observe(live) {
                        tracing::info!("宿主进程已退出，正在清理 Palboo");
                        app.shutdown.notify_one();
                        break;
                    }
                }
            }
        })
    }

    pub(crate) async fn finish(&self) {
        let mut state = self.0.lock().await;
        let Some(owner) = state.owner.clone() else {
            return;
        };
        // 热更/模式交接只重建 Palboo，宿主仍在时不退出兼容层。
        let exited = owner.alive().is_ok_and(|alive| !alive);
        let replacement = crate::host::desktop_process(&owner.executable);
        if !exited || !matches!(replacement, Ok(None)) {
            return;
        }
        if let Some(lease) = state.compatibility.take()
            && let Err(error) = lease
                .stop(|| {
                    Ok(!owner.alive()?
                        && crate::host::desktop_process(&owner.executable)?.is_none())
                })
                .await
        {
            tracing::warn!(%error, "关联 CodexHost 未完成退出；未停止其他实例");
        }
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
