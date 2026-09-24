import io
import tarfile
import unittest
from sandbox import validate_source


def source(name, kind=tarfile.REGTYPE):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w') as archive:
        entry = tarfile.TarInfo(name)
        entry.type = kind
        archive.addfile(entry)
    return out.getvalue()


class SourceBoundaryTests(unittest.TestCase):
    def test_rejects_paths_links_and_credentials(self):
        for path in ['/etc/passwd', '../escape', 'src/../../escape', '.env', '.env.production', '.git/config', 'src/.npmrc']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                validate_source(source(path))
        for kind in [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.FIFOTYPE]:
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                validate_source(source('link', kind))

    def test_accepts_plain_source(self):
        validate_source(source('src/component.jsx'))


if __name__ == '__main__':
    unittest.main()
