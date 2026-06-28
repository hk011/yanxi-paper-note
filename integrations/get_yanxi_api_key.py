#!/usr/bin/env python3
"""生成研析 Skill / CLI 用的 yanxi_api_key。"""

import secrets


def generate_yanxi_api_key() -> str:
    return secrets.token_hex(32)


if __name__ == "__main__":
    print(f"yanxi_api_key:\n\n{generate_yanxi_api_key()}\n")
