"""Trusted stdin bridge. Never invokes generated code outside sandbox.run_job."""
import base64
import io
import json
import sys
import tarfile
from sandbox import run_job


def main():
    payload = json.load(sys.stdin)
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode='w') as target:
        for path, encoded in payload['files'].items():
            content = base64.b64decode(encoded, validate=True)
            entry = tarfile.TarInfo(path)
            entry.size = len(content)
            entry.mode = 0o644
            target.addfile(entry, io.BytesIO(content))
    result = run_job(archive.getvalue(), payload['image'], payload['command'], payload.get('timeout', 600))
    print(json.dumps(result))


if __name__ == '__main__':
    main()
