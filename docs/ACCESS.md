# Access & Recovery

## The three ways in (in order of preference)

| # | Command | User | Port | Auth | Notes |
|---|---------|------|------|------|-------|
| 1 | `ssh lgtv` | root | 22 | ed25519 key `~/.ssh/lgtv_root` (RSA `lgtv_webos_plain` also authorized) | Homebrew Channel dropbear. **Primary.** |
| 2 | `ssh lgtv-dev` | prisoner | 9922 | RSA key `~/.ssh/lgtv_webos_plain` | webOS Developer Mode dropbear. Unprivileged sandbox. Used by `ares-*` SDK. Independent of root SSH. |
| 3 | telnet | root | 23 | **NONE** | Homebrew Channel telnetd. Unauthenticated root shell. **Failsafe of last resort.** |

### Telnet failsafe (when SSH is unavailable)
macOS `nc` needs Telnet option negotiation or the shell won't echo:
```bash
(printf '\377\374\037\377\374\040\377\374\043\377\374\047\377\374\030'; sleep 2; \
 printf 'YOUR_COMMAND_HERE\n'; sleep 3; printf 'exit\n'; sleep 1) \
 | nc -w 12 192.168.50.143 23 | LC_ALL=C tr -cd '\11\12\15\40-\176'
```
Telnet is enabled by Homebrew's `startup.sh` on every boot **unless** `/var/luna/preferences/webosbrew_telnet_disabled` exists (we have NOT created it — telnet stays available as failsafe).

## `~/.ssh/config`
```
Host lgtv        # root, port 22  → IdentityFile ~/.ssh/lgtv_root
Host lgtv-dev    # prisoner, port 9922 → IdentityFile ~/.ssh/lgtv_webos_plain
```
Backup of the pre-change config: `~/.ssh/config.bak.*`

## Recovery ladder (mildest → nuclear)
1. **Reboot the TV.** Reverts ALL our runtime changes (they're bind-mounts / tmpfs). Back to clean stock-rooted. Fixes ~everything we could plausibly break.
2. **Telnet :23** (unauth root) if SSH is down but the TV booted. Fix or remove whatever broke.
3. **Dev-mode :9922** (`prisoner`) as an alternate login if root SSH key/daemon is the problem.
4. **Re-run root SSH enable** (see CHANGES.md "Enable root SSH") from any working channel.
5. **Homebrew re-root** if HBC itself is gone: the faultmanager-autoroot exploit still works while on this firmware.
6. **LG USB `.epk` reflash** — true nuclear. Restores stock firmware, UNBRICKS, but **WIPES root** (Homebrew gone, re-root needed). Never required for anything software-level we do.

## Why bricking is off the table
- Rootfs/firmware is **read-only squashfs** — we cannot write it (verified: `touch /usr/sbin/x` → RO).
- We do **not** touch: kernel, bootloader, micom/OTP, `erase_lgudid`, `setFactoryOpt`, partition table, or flash any image.
- Signed boot is ON — even a hypothetical bad flash won't run; USB `.epk` recovers.

## Backups
- Full eMMC raw image: `dump/mmcblk0.img` + `dump/mmcblk0.img.sha256`.
