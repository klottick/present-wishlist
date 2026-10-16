from dataclasses import dataclass
from pathlib import Path
import re

import yaml


class ConfigError(ValueError):
    """Raised when the authoritative family YAML is missing or invalid."""


@dataclass(frozen=True)
class FamilyConfig:
    members: dict[str, str]
    events: dict[str, str]


_KEY_PATTERN = re.compile(r"[a-z][a-z0-9_-]{0,79}\Z")


class _UniqueKeySafeLoader(yaml.SafeLoader):
    def construct_mapping(self, node, deep=False):
        if not isinstance(node, yaml.MappingNode):
            raise ConfigError("expected a YAML mapping")
        seen = set()
        for key_node, _ in node.value:
            if key_node.tag == "tag:yaml.org,2002:merge":
                raise ConfigError("YAML merge keys are not supported")
            key = self.construct_object(key_node, deep=deep)
            try:
                duplicate = key in seen
                seen.add(key)
            except TypeError as error:
                raise ConfigError("mapping keys must be scalar values") from error
            if duplicate:
                raise ConfigError(f"duplicate YAML mapping key: {key!r}")
        return super().construct_mapping(node, deep=deep)


def load_family_config(path: Path) -> FamilyConfig:
    path = Path(path)
    try:
        with path.open(encoding="utf-8") as config_file:
            parsed = yaml.load(config_file, Loader=_UniqueKeySafeLoader)
    except (OSError, UnicodeError, yaml.YAMLError, ValueError) as error:
        raise ConfigError(f"Unable to load family configuration '{path}': {error}") from error

    if not isinstance(parsed, dict):
        raise ConfigError("configuration must be a mapping with members and events")
    if set(parsed) != {"members", "events"}:
        raise ConfigError("configuration must contain exactly 'members' and 'events'")
    members = _validate_mapping("members", parsed["members"])
    events = _validate_mapping("events", parsed["events"])
    for key, label in events.items():
        if key == "anything" or label.casefold() == "anything":
            raise ConfigError("'anything' is reserved and cannot be configured as an event")
    return FamilyConfig(members=members, events=events)


def _validate_mapping(name: str, value) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ConfigError(f"'{name}' must be a mapping")
    result = {}
    labels = set()
    for key, raw_label in value.items():
        if not isinstance(key, str) or not _KEY_PATTERN.fullmatch(key):
            raise ConfigError(f"'{name}' keys must start with a lowercase letter and contain only lowercase letters, numbers, hyphens, and underscores (maximum 80 characters)")
        if not isinstance(raw_label, str):
            raise ConfigError(f"label for '{key}' in '{name}' must be a string")
        label = raw_label.strip()
        if not label:
            raise ConfigError(f"label for '{key}' in '{name}' must not be blank")
        if len(label) > 80:
            raise ConfigError(f"label for '{key}' in '{name}' exceeds 80 characters")
        folded = label.casefold()
        if folded in labels:
            raise ConfigError(f"labels in '{name}' must be unique (case-insensitive)")
        labels.add(folded)
        result[key] = label
    return result
