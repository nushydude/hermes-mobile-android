import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('notify_config', Path(__file__).parents[1] / 'config.py')
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)

class ConfigTests(unittest.TestCase):
    def test_origin(self):
        with patch.dict(os.environ, {'TEST_URL': 'https://example.test:9121/'}):
            self.assertEqual(config.https_origin('TEST_URL'), 'https://example.test:9121')
        for value in ('', 'http://example.test', 'https://user:secret@example.test', 'https://@example.test', 'https://example.test/a/..', 'https://example.test?secret', 'https://example.test#secret', 'https://example.test:99999'):
            with self.subTest(value=value), patch.dict(os.environ, {'TEST_URL': value}):
                with self.assertRaisesRegex(ValueError, '^TEST_URL must be an HTTPS origin$'):
                    config.https_origin('TEST_URL')
