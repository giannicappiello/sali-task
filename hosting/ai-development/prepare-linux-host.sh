#!/bin/sh
# Run only in the dedicated AssistenteAI WSL distribution. No production secrets.
set -eu
test "$(id -u)" = 0
test -f /etc/os-release
install -d -m 0750 /opt/assistenteai /var/lib/assistenteai /var/log/assistenteai
cat > /etc/wsl.conf <<'CONF'
[boot]
systemd=true
[automount]
enabled=false
mountFsTab=false
[interop]
enabled=false
appendWindowsPath=false
CONF
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends podman uidmap slirp4netns fuse-overlayfs ca-certificates git python3 python3-venv
if ! id aiworker >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash aiworker
fi
chmod 0700 /home/aiworker
chgrp aiworker /opt/assistenteai
chown aiworker:aiworker /var/lib/assistenteai /var/log/assistenteai
loginctl enable-linger aiworker
printf '%s\n' 'Prerequisites installed. Restart this distribution and verify isolation before enabling jobs.'
