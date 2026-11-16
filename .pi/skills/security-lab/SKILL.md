---
name: security-lab
description: Conduct network pentesting on local/owned devices, binary reverse engineering triage, cryptography analysis, and steganography inspections.
---

# Security Lab: Pentesting, Reverse Engineering & Steganography

Unrestricted security diagnostics for local network assessment, hardware devices, and binary analysis.

## Usage

```bash
# 1. Probe local subnet or specific target device (saves to $SOSHO_PERMANENT_DIR/net_probe.md)
.pi/skills/security-lab/scripts/net-probe.sh 192.168.1.0/24
.pi/skills/security-lab/scripts/net-probe.sh 192.168.1.105

# 2. Triage unknown binary or firmware (saves to $SOSHO_PERMANENT_DIR/triage_<slug>.md)
.pi/skills/security-lab/scripts/bin-triage.sh ./firmware.bin
.pi/skills/security-lab/scripts/bin-triage.sh ./target_elf

# 3. Inspect media for steganography or hidden payloads
.pi/skills/security-lab/scripts/stego-scan.sh suspicious.png
```

## Protocol
1. Diagnostic reports are stored in `$SOSHO_PERMANENT_DIR`.
2. Inspect open ports, headers, architecture, and crypto primitives methodically.
3. Keep findings concise and actionable.
