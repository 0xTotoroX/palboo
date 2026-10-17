// [INPUT]: 已保存的共享连接与各功能开关/生成配置变化。
// [OUTPUT]: 独立请求租约；关闭、重新开启或连接变化后旧请求不能继续发送或返回结果。
// [POS]: 内存中的模型请求生命周期，不持久化配置、不读取聊天。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use anyhow::{Result, bail, ensure};
use std::future::Future;
use tokio::sync::watch;

#[derive(Clone, Copy)]
pub(crate) enum Scope {
    Shared,
    Stepwise,
    Prompt,
    Terminology,
    Expansion,
}

pub(crate) struct Requests(watch::Sender<[u64; 5]>);
impl Default for Requests {
    fn default() -> Self {
        Self(watch::channel([0; 5]).0)
    }
}
impl Requests {
    pub fn lease(&self, scope: Scope) -> Lease {
        let receiver = self.0.subscribe();
        let version = *receiver.borrow();
        Lease {
            receiver,
            version,
            scope,
        }
    }
    pub fn invalidate(&self, scope: Scope) {
        self.0.send_modify(|version| version[scope as usize] += 1);
    }
}
#[derive(Clone)]
pub(crate) struct Lease {
    receiver: watch::Receiver<[u64; 5]>,
    version: [u64; 5],
    scope: Scope,
}
impl Lease {
    fn valid(&self, now: &[u64; 5]) -> bool {
        now[0] == self.version[0]
            && now[self.scope as usize] == self.version[self.scope as usize]
            && (!matches!(self.scope, Scope::Expansion)
                || now[Scope::Terminology as usize] == self.version[Scope::Terminology as usize])
    }
    pub fn check(&self) -> Result<()> {
        ensure!(
            self.valid(&self.receiver.borrow()),
            "功能或模型配置已变化，请求已取消"
        );
        Ok(())
    }
    pub fn with_current<T>(&self, start: impl FnOnce() -> Result<T>) -> Result<T> {
        // watch 读锁将实际启动和 invalidate 串行化；只覆盖启动，不覆盖网络等待。
        let version = self.receiver.borrow();
        ensure!(self.valid(&version), "功能或模型配置已变化，请求已取消");
        start()
    }
    pub async fn start<T>(&self, request: impl Future<Output = Result<T>>) -> Result<T> {
        let mut request = std::pin::pin!(request);
        let mut started = false;
        self.run(std::future::poll_fn(|cx| {
            if started {
                return request.as_mut().poll(cx);
            }
            match self.with_current(|| {
                started = true;
                Ok(request.as_mut().poll(cx))
            }) {
                Ok(poll) => poll,
                Err(error) => std::task::Poll::Ready(Err(error)),
            }
        }))
        .await
    }
    pub async fn run<T>(&self, request: impl Future<Output = Result<T>>) -> Result<T> {
        self.check()?;
        let mut receiver = self.receiver.clone();
        tokio::select! {
            biased;
            _ = receiver.wait_for(|version| !self.valid(version)) => bail!("功能或模型配置已变化，请求已取消"),
            result = request => { self.check()?; result }
        }
    }
}
pub(crate) async fn send(
    lease: Option<&Lease>,
    request: reqwest::RequestBuilder,
) -> Result<reqwest::Response> {
    let send = async {
        request.send().await.map_err(|error| {
            if error.is_timeout() {
                anyhow::anyhow!("模型请求超时，请稍后重试")
            } else {
                anyhow::anyhow!("模型 API 无法连接")
            }
        })
    };
    if let Some(lease) = lease {
        lease.start(send).await
    } else {
        send.await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn scopes_cancel_in_flight_without_affecting_other_features_or_reviving_old_work() {
        let requests = Requests::default();
        let step = requests.lease(Scope::Stepwise);
        let prompt = requests.lease(Scope::Prompt);
        let terms = requests.lease(Scope::Terminology);
        let expand = requests.lease(Scope::Expansion);
        let pending = tokio::spawn({
            let step = step.clone();
            async move { step.run(std::future::pending::<Result<()>>()).await }
        });
        requests.invalidate(Scope::Stepwise);
        assert!(pending.await.unwrap().is_err());
        assert!(step.check().is_err());
        assert!(prompt.check().is_ok());
        assert!(terms.check().is_ok());
        requests.invalidate(Scope::Expansion);
        assert!(expand.check().is_err());
        assert!(terms.check().is_ok());
        requests.invalidate(Scope::Terminology);
        requests.invalidate(Scope::Terminology);
        assert!(terms.check().is_err());
        assert!(requests.lease(Scope::Terminology).check().is_ok());
        requests.invalidate(Scope::Shared);
        assert!(prompt.check().is_err());
    }
}
