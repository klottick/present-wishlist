from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.management import call_command, CommandError
from django.test import SimpleTestCase, TestCase, override_settings

from wishlist.configuration.loader import ConfigError, load_family_config
from wishlist.models import Event, FamilyProfile


class ConfigurationTests(SimpleTestCase):
    def test_loads_stable_keys_and_trims_labels(self):
        with TemporaryDirectory() as directory:
            config_path = Path(directory) / "family.yaml"
            config_path.write_text(
                "members:\n  alex: ' Alex '\nevents:\n  birthday: Birthday\n",
                encoding="utf-8",
            )

            config = load_family_config(config_path)

        self.assertEqual(config.members, {"alex": "Alex"})
        self.assertEqual(config.events, {"birthday": "Birthday"})

    def test_rejects_duplicate_yaml_keys(self):
        self.assert_invalid(
            "members:\n  alex: Alex\n  alex: Alexander\nevents: {}\n"
        )

    def test_rejects_malformed_shape_and_unknown_top_level_keys(self):
        for contents in (
            "members: {}\n",
            "members: {}\nevents: {}\nextra: true\n",
            "members: [\nevents: {}\n",
        ):
            with self.subTest(contents=contents):
                self.assert_invalid(contents)

    def test_rejects_boolean_date_number_and_object_labels(self):
        for label in ("true", "2026-10-15", "42", "{}"):
            with self.subTest(label=label):
                self.assert_invalid(f"members:\n  alex: {label}\nevents: {{}}\n")

    def test_rejects_scalar_construction_errors_as_config_errors(self):
        for label in (
            "2026-99-99",
            "!!float not-a-number",
            "!!int not-an-integer",
        ):
            with self.subTest(label=label):
                with self.assertRaisesRegex(ConfigError, "family.yaml"):
                    self.load_contents(
                        f"members:\n  alex: {label}\nevents: {{}}\n"
                    )

    def test_rejects_unsafe_tags_and_merge_keys(self):
        for contents in (
            "members: !!python/object/apply:os.system ['echo unsafe']\nevents: {}\n",
            "members:\n  <<: &defaults\n    alex: Alex\nevents: {}\n",
        ):
            with self.subTest(contents=contents):
                self.assert_invalid(contents)

    def test_checks_key_and_label_limits_and_reserved_anything(self):
        invalid = (
            "members:\n  1alex: Alex\nevents: {}\n",
            "members:\n  Alex: Alex\nevents: {}\n",
            "members:\n  'alex!': Alex\nevents: {}\n",
            "members:\n  '?': Alex\nevents: {}\n",
            f"members:\n  {'a' * 81}: Alex\nevents: {{}}\n",
            "members:\n  alex: '   '\nevents: {}\n",
            "members:\n  alex: Alex\n  sam: alex\nevents: {}\n",
            f"members:\n  alex: {'A' * 81}\nevents: {{}}\n",
            "members: {}\nevents:\n  anything: Whatever\n",
            "members: {}\nevents:\n  gift: ' Anything '\n",
            "members: {}\nevents:\n  birthday: Birthday\n  holiday: birthday\n",
        )
        for contents in invalid:
            with self.subTest(contents=contents):
                self.assert_invalid(contents)

    def test_empty_mappings_are_valid(self):
        with TemporaryDirectory() as directory:
            config_path = Path(directory) / "family.yaml"
            config_path.write_text("members: {}\nevents: {}\n", encoding="utf-8")
            config = load_family_config(config_path)

        self.assertEqual(config.members, {})
        self.assertEqual(config.events, {})

    def test_missing_or_unreadable_file_is_actionable(self):
        with TemporaryDirectory() as directory:
            missing = Path(directory) / "missing.yaml"
            with self.assertRaisesRegex(ConfigError, "missing.yaml"):
                load_family_config(missing)

            config_path = Path(directory) / "invalid-encoding.yaml"
            config_path.write_bytes(b"members: \xff\nevents: {}\n")
            with self.assertRaisesRegex(ConfigError, "invalid-encoding.yaml"):
                load_family_config(config_path)

    def assert_invalid(self, contents):
        with TemporaryDirectory() as directory:
            config_path = Path(directory) / "family.yaml"
            config_path.write_text(contents, encoding="utf-8")
            with self.assertRaises(ConfigError):
                load_family_config(config_path)

    def load_contents(self, contents):
        with TemporaryDirectory() as directory:
            config_path = Path(directory) / "family.yaml"
            config_path.write_text(contents, encoding="utf-8")
            return load_family_config(config_path)


class ConfigurationCommandTests(TestCase):
    def test_uses_settings_path_when_config_option_is_omitted(self):
        with TemporaryDirectory() as directory:
            config_path = Path(directory) / "fixture.yaml"
            config_path.write_text(
                "members: {}\nevents:\n  birthday: Birthday\n", encoding="utf-8"
            )
            with override_settings(FAMILY_CONFIG_PATH=config_path):
                call_command("sync_family_config")

        self.assertEqual(
            set(Event.objects.values_list("config_key", flat=True)),
            {"birthday"},
        )
        self.assertFalse(FamilyProfile.objects.exists())

    def test_scalar_construction_errors_are_command_errors(self):
        for label in (
            "2026-99-99",
            "!!float not-a-number",
            "!!int not-an-integer",
        ):
            with self.subTest(label=label), TemporaryDirectory() as directory:
                config_path = Path(directory) / "family.yaml"
                config_path.write_text(
                    f"members:\n  alex: {label}\nevents: {{}}\n",
                    encoding="utf-8",
                )
                with self.assertRaisesRegex(CommandError, "family.yaml"):
                    call_command("sync_family_config", config=str(config_path))

    def test_missing_or_invalid_config_is_a_command_error(self):
        with TemporaryDirectory() as directory:
            config_path = Path(directory) / "family.yaml"
            with self.assertRaisesRegex(CommandError, "family.yaml"):
                call_command("sync_family_config", config=str(config_path))

            config_path.write_text("members: []\nevents: {}\n", encoding="utf-8")
            with self.assertRaisesRegex(CommandError, "members"):
                call_command("sync_family_config", config=str(config_path))
