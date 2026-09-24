"""Trusted runner. Generated commands run only in a rootless, offline container.

Source archives are copied, never mounted. Dependencies belong in a reviewed,
digest-pinned image, prepared separately from untrusted build/test execution.
"""
import hashlib
import io
import json
import os
import re
import selectors
import subprocess
import tarfile
import time
import uuid
from pathlib import PurePosixPath

MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_OUTPUT_BYTES = 1024 * 1024
MAX_FILES = 10000
IMAGE = re.compile(r"^(?:[a-z0-9./:_-]+@)?sha256:[a-f0-9]{64}$")
PROTECTED = {'.git', '.env', '.ssh', '.aws', '.azure', '.npmrc', '.pypirc', 'node_modules'}


def validate_source(data):
    if len(data) > MAX_SOURCE_BYTES:
        raise ValueError('Source archive exceeds the limit')
    total = 0
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:') as archive:
        for count, member in enumerate(archive, start=1):
            path = PurePosixPath(member.name)
            if (count > MAX_FILES or path.is_absolute() or '..' in path.parts
                    or any(part in PROTECTED or part.startswith('.env.') for part in path.parts)
                    or not (member.isfile() or member.isdir())):
                raise ValueError('Unsafe source archive entry: ' + member.name)
            total += member.size
            if total > MAX_SOURCE_BYTES:
                raise ValueError('Expanded source exceeds the limit')


def command(args, **kwargs):
    return subprocess.run(['podman', *args], check=True, capture_output=True,
                          timeout=30, **kwargs).stdout


def run_job(source, image, argv, timeout=600):
    if not IMAGE.fullmatch(image):
        raise ValueError('Use an explicitly approved image digest')
    if not isinstance(argv, list) or not argv or len(argv) > 32 or any(not isinstance(v, str) or '\x00' in v or len(v) > 4000 for v in argv):
        raise ValueError('Invalid command')
    if not isinstance(timeout, int) or not 1 <= timeout <= 1800:
        raise ValueError('Invalid timeout')
    validate_source(source)
    info = json.loads(command(['info', '--format', 'json']))
    if not info['host']['security']['rootless'] or info['host']['cgroupVersion'] != 'v2':
        raise RuntimeError('Verified rootless cgroup-v2 runtime required')
    name = 'assistenteai-' + uuid.uuid4().hex
    started = time.monotonic()
    result = {'sourceSha256': hashlib.sha256(source).hexdigest(), 'image': image,
              'command': argv, 'exitCode': None, 'timedOut': False, 'outputTruncated': False}
    try:
        # No host volume or runtime socket. tmpfs bounds all writable storage.
        command(['create', '--name', name, '--pull=never', '--network=none',
                 '--read-only', '--read-only-tmpfs=false', '--cap-drop=ALL',
                 '--security-opt=no-new-privileges', '--pids-limit=256', '--cpus=2',
                 '--memory=3g', '--memory-swap=3g', '--ulimit=nofile=1024:1024',
                 '--tmpfs=/work:rw,nosuid,nodev,size=1g,mode=1777',
                 '--tmpfs=/tmp:rw,nosuid,nodev,size=128m,mode=1777',
                 '--workdir=/work', '--env=HOME=/tmp', '--env=CI=true',
                 '--entrypoint=/bin/sh', image, '-c', 'sleep 1800'])
        command(['start', name])
        # tar is the image's tool. Host never extracts an untrusted archive.
        command(['exec', '-i', name, 'tar', '-xf', '-', '-C', '/work'], input=source)
        process = subprocess.Popen(['podman', 'exec', name, *argv], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        output = bytearray()
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while selector.get_map():
                if time.monotonic() - started > timeout:
                    result['timedOut'] = True
                    command(['kill', name])
                    process.kill()
                    break
                for key, _ in selector.select(timeout=0.25):
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    remaining = MAX_OUTPUT_BYTES - len(output)
                    output.extend(chunk[:max(0, remaining)])
                    if len(chunk) > remaining:
                        result['outputTruncated'] = True
            try:
                result['exitCode'] = process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        result['output'] = output.decode('utf-8', errors='replace')
        result['succeeded'] = result['exitCode'] == 0 and not result['timedOut']
        result['durationSeconds'] = round(time.monotonic() - started, 2)
        return result
    finally:
        # Only the random container created by this call is removed.
        command(['rm', '--force', '--ignore', name])
