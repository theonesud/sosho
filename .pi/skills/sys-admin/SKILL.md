---
name: sys-admin
description: Inspect, optimize, and debug host Linux system health (thermals, RAM, GPU, systemd services, kernel errors).
---

# Sys-Admin: Host Linux Optimization & Debugging

Rapid diagnostics and troubleshooting for the host Linux operating system.

## Usage

```bash
# 1. Quick system health snapshot (<25 lines)
.pi/skills/sys-admin/scripts/host-status.sh

# 2. Inspect specific logs surgically without token blowup
journalctl -u docker -n 30 --no-pager
bin/chunk-read.sh /var/log/syslog 1 50
```

## Protocol
1. Run `host-status.sh` to get an immediate multi-factor baseline.
2. Troubleshoot root cause directly on the command line.
3. Verify fixes before completing the task.
