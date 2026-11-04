// [INPUT]: 本机进程资源计数、Mach 时间基准、已连接 CDP 与配置中的独立性能偏好。
// [OUTPUT]: 按需采样后台 CPU/物理内存和宿主页指标；不启动常驻分析器，不保存正文。
// [POS]: 设置诊断服务；CPU 100% 表示一个核心，宿主页内存和长任务不能归因于 Palboo。
// [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
use crate::state::App;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub integration_enabled: bool,
    pub monitoring_enabled: bool,
    pub revision: u64,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            integration_enabled: true,
            monitoring_enabled: false,
            revision: 0,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Update {
    pub expected_revision: u64,
    pub integration_enabled: Option<bool>,
    pub monitoring_enabled: Option<bool>,
}

#[derive(Default)]
pub(crate) struct Monitor {
    sampled_at: Option<Instant>,
    previous: Option<(Instant, Usage)>,
    cached: Value,
}
#[derive(Clone, Copy)]
struct Usage {
    cpu_ns: u64,
    memory_bytes: u64,
}

#[cfg(any(target_os = "macos", test))]
fn mach_ticks_to_ns(ticks: u64, numer: u32, denom: u32) -> Option<u64> {
    if numer == 0 || denom == 0 {
        return None;
    }
    u64::try_from(u128::from(ticks) * u128::from(numer) / u128::from(denom)).ok()
}

#[cfg(target_os = "macos")]
fn usage() -> Option<Usage> {
    // 对应 macOS SDK sys/resource.h 的 rusage_info_v2，无需启动外部 ps 进程。
    #[repr(C)]
    #[derive(Default)]
    struct RUsage {
        uuid: [u8; 16],
        fields: [u64; 18],
    }
    #[repr(C)]
    #[derive(Default)]
    struct Timebase {
        numer: u32,
        denom: u32,
    }
    unsafe extern "C" {
        fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut RUsage) -> i32;
        fn mach_timebase_info(info: *mut Timebase) -> i32;
    }
    static TIMEBASE: std::sync::OnceLock<Option<Timebase>> = std::sync::OnceLock::new();
    let timebase = TIMEBASE
        .get_or_init(|| {
            let mut value = Timebase::default();
            (unsafe { mach_timebase_info(&mut value) } == 0 && value.numer > 0 && value.denom > 0)
                .then_some(value)
        })
        .as_ref()?;
    let mut info = RUsage::default();
    if unsafe { proc_pid_rusage(std::process::id() as i32, 2, &mut info) } != 0 {
        return None;
    }
    Some(Usage {
        // rusage 的 CPU 计数是 Mach ticks；Apple Silicon 上不能直接视为纳秒。
        cpu_ns: mach_ticks_to_ns(
            info.fields[0].saturating_add(info.fields[1]),
            timebase.numer,
            timebase.denom,
        )?,
        memory_bytes: info.fields[7],
    })
}
#[cfg(not(target_os = "macos"))]
fn usage() -> Option<Usage> {
    None
}

fn cpu_percent(previous: Usage, current: Usage, seconds: f64) -> Option<f64> {
    (seconds > 0. && current.cpu_ns >= previous.cpu_ns)
        .then(|| (current.cpu_ns - previous.cpu_ns) as f64 / 1_000_000_000. / seconds * 100.)
}

impl App {
    pub(crate) async fn performance_state(&self, sample: bool) -> Value {
        let preferences = self.config.lock().await.performance.clone();
        let mut monitor = self.performance.lock().await;
        if !preferences.monitoring_enabled {
            *monitor = Monitor::default();
        } else if sample
            && monitor
                .sampled_at
                .as_ref()
                .is_none_or(|at| at.elapsed() >= Duration::from_secs(4))
        {
            let now = Instant::now();
            let current = usage();
            let cpu = current.and_then(|value| {
                monitor.previous.as_ref().and_then(|(at, previous)| {
                    (at.elapsed() <= Duration::from_secs(15))
                        .then(|| {
                            cpu_percent(*previous, value, now.duration_since(*at).as_secs_f64())
                        })
                        .flatten()
                })
            });
            let host = if let Some(client) = self.desktop_client().await {
                client
                    .evaluate_with_timeout(
                        "window.__companionFloatingPanel?.samplePerformance?.() ?? null".into(),
                        Duration::from_secs(1),
                    )
                    .await
                    .unwrap_or(Value::Null)
            } else {
                Value::Null
            };
            monitor.cached = json!({
                "backend": {"pid":std::process::id(),"cpuPercent":cpu,"memoryBytes":current.map(|v|v.memory_bytes)},
                "host":host,
                "sampledAt":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),
            });
            monitor.previous = current.map(|value| (now, value));
            monitor.sampled_at = Some(now);
        }
        json!({"preferences":preferences,"connectionStatus":self.view().connection.status,"sample":monitor.cached})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_configuration_keeps_integration_and_leaves_monitoring_off() {
        let prefs: Preferences = serde_json::from_str("{}").unwrap();
        assert!(prefs.integration_enabled);
        assert!(!prefs.monitoring_enabled);
    }
    #[test]
    fn cpu_counts_one_core_and_handles_first_or_reset_samples() {
        let before = Usage {
            cpu_ns: 2_000_000_000,
            memory_bytes: 0,
        };
        let after = Usage {
            cpu_ns: 3_000_000_000,
            memory_bytes: 0,
        };
        assert_eq!(cpu_percent(before, after, 5.), Some(20.));
        assert_eq!(cpu_percent(after, before, 5.), None);
        assert_eq!(cpu_percent(before, after, 0.), None);
        assert_eq!(cpu_percent(before, after, 0.5), Some(200.));
    }
    #[test]
    fn mach_cpu_time_uses_the_system_ratio_without_overflow() {
        assert_eq!(mach_ticks_to_ns(24_000_000, 125, 3), Some(1_000_000_000));
        assert_eq!(mach_ticks_to_ns(1_000_000_000, 1, 1), Some(1_000_000_000));
        assert_eq!(mach_ticks_to_ns(3, 125, 3), Some(125));
        assert_eq!(mach_ticks_to_ns(u64::MAX, 3, 3), Some(u64::MAX));
        assert_eq!(mach_ticks_to_ns(u64::MAX, 125, 3), None);
        assert_eq!(mach_ticks_to_ns(1, 0, 3), None);
        assert_eq!(mach_ticks_to_ns(1, 125, 0), None);
    }
    #[test]
    #[cfg(target_os = "macos")]
    fn mach_cpu_time_matches_getrusage_microseconds() {
        fn reference_cpu_ns() -> u64 {
            let mut value = std::mem::MaybeUninit::<libc::rusage>::uninit();
            assert_eq!(
                unsafe { libc::getrusage(libc::RUSAGE_SELF, value.as_mut_ptr()) },
                0
            );
            let value = unsafe { value.assume_init() };
            let micros = value.ru_utime.tv_sec * 1_000_000
                + i64::from(value.ru_utime.tv_usec)
                + value.ru_stime.tv_sec * 1_000_000
                + i64::from(value.ru_stime.tv_usec);
            u64::try_from(micros).unwrap() * 1_000
        }
        // 累积足够的进程 CPU 时间，让错误的 1:1 换算不能落入采样容差。
        for i in 0_u64..1_000_000 {
            std::hint::black_box(i.wrapping_mul(i));
        }
        let before = reference_cpu_ns();
        let actual = usage().unwrap().cpu_ns;
        let after = reference_cpu_ns();
        assert!(actual >= before.saturating_sub(1_000_000));
        assert!(actual <= after.saturating_add(1_000_000));
    }
    #[test]
    #[cfg(target_os = "macos")]
    fn reads_real_process_without_spawning_a_sampler() {
        assert!(usage().unwrap().memory_bytes > 0);
    }
}
