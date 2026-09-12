"""Application-side encryption for CFDI documents, and password hashing.

The key lives in the API process and is never sent to the database. That scopes what this
protects precisely:

  covered      — a leaked backup, a misconfigured replica, anyone with direct database
                 access, a dump handed to the wrong person
  NOT covered  — a compromise of the API, which holds the key

Stating the second half is what separates a control from security theatre. Encrypting a
column while sending the key to the same database would protect against nothing.

Only the raw XML is encrypted. The parsed fields stay in plain columns because those are
what we filter and join on, and encrypting them would buy nothing while breaking every
query.
"""

from __future__ import annotations

import binascii
import os
import secrets
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

NONCE_BYTES = 12          # AES-GCM standard nonce length
KEY_BYTES = 32            # AES-256

_hasher = PasswordHasher()


def _env(name: str) -> str | None:
    if name in os.environ:
        return os.environ[name]
    env = Path(__file__).parent.parent / ".env"
    if env.is_file():
        for line in env.read_text().splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() == name:
                return value.strip().strip('"').strip("'")
    return None


def generate_key_b64() -> str:
    """Print this once and put it in .env as CFDI_ENC_KEY."""
    import base64
    return base64.b64encode(secrets.token_bytes(KEY_BYTES)).decode()


def _key() -> bytes:
    import base64
    raw = _env("CFDI_ENC_KEY")
    if not raw:
        raise RuntimeError(
            "CFDI_ENC_KEY not set. Generate one with:\n"
            "  python3 -c 'import backend.crypto as c; print(c.generate_key_b64())'")
    # A 32-byte key is commonly copied without Base64's trailing "=". Accept that
    # harmless representation and restore the padding locally; malformed characters
    # still fail with a useful configuration error.
    padded = raw + "=" * (-len(raw) % 4)
    try:
        key = base64.b64decode(padded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise RuntimeError("CFDI_ENC_KEY must be valid Base64") from exc
    if len(key) != KEY_BYTES:
        raise RuntimeError(f"CFDI_ENC_KEY must decode to {KEY_BYTES} bytes, got {len(key)}")
    return key


def encrypt_xml(xml: str, aad: str) -> bytes:
    """Encrypt one CFDI document. Layout: nonce || ciphertext || tag.

    `aad` binds the ciphertext to its row — pass the invoice UUID. A blob moved to a
    different invoice then fails to decrypt instead of quietly succeeding, so the
    database cannot be reshuffled without detection.
    """
    nonce = secrets.token_bytes(NONCE_BYTES)
    sealed = AESGCM(_key()).encrypt(nonce, xml.encode("utf-8"), aad.encode("utf-8"))
    return nonce + sealed


def decrypt_xml(blob: bytes | memoryview, aad: str) -> str:
    blob = bytes(blob)
    if len(blob) <= NONCE_BYTES:
        raise ValueError("ciphertext too short to contain a nonce")
    nonce, sealed = blob[:NONCE_BYTES], blob[NONCE_BYTES:]
    try:
        return AESGCM(_key()).decrypt(nonce, sealed, aad.encode("utf-8")).decode("utf-8")
    except InvalidTag as exc:
        # Wrong key, tampered ciphertext, or a blob attached to the wrong invoice.
        raise ValueError("CFDI decryption failed: key mismatch or tampering") from exc


def hash_password(password: str) -> str:
    """Argon2id. The `password_hash` column name does not enforce hashing — this does."""
    return _hasher.hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    try:
        _hasher.verify(stored_hash, password)
        return True
    except (VerifyMismatchError, VerificationError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    return _hasher.check_needs_rehash(stored_hash)


def demo() -> None:
    """Self-check. Uses an ephemeral key so it never touches the real one."""
    import base64
    os.environ["CFDI_ENC_KEY"] = base64.b64encode(b"\x02" * KEY_BYTES).decode()

    xml = '<?xml version="1.0"?><cfdi:Comprobante Total="61000.00"/>'
    uuid = "AAAA-BBBB-CCCC"

    blob = encrypt_xml(xml, uuid)
    assert decrypt_xml(blob, uuid) == xml
    assert xml.encode() not in blob, "plaintext must not survive in the ciphertext"

    # Same input twice must not produce the same bytes, or equal documents would be
    # linkable by ciphertext alone.
    assert encrypt_xml(xml, uuid) != encrypt_xml(xml, uuid)

    # Bound to its row: reattaching the blob to another invoice fails loudly.
    try:
        decrypt_xml(blob, "DDDD-EEEE-FFFF")
        raise AssertionError("decrypt accepted the wrong invoice uuid")
    except ValueError:
        pass

    # Tampering is detected rather than returning garbage.
    tampered = bytearray(blob)
    tampered[-1] ^= 0x01
    try:
        decrypt_xml(bytes(tampered), uuid)
        raise AssertionError("decrypt accepted tampered ciphertext")
    except ValueError:
        pass

    # A truncated blob is rejected, not indexed out of range.
    try:
        decrypt_xml(b"\x00" * 4, uuid)
        raise AssertionError("decrypt accepted a truncated blob")
    except ValueError:
        pass

    h = hash_password("correct horse battery staple")
    assert h.startswith("$argon2"), h
    assert verify_password(h, "correct horse battery staple")
    assert not verify_password(h, "wrong")
    assert hash_password("x") != hash_password("x"), "argon2 must salt per call"

    print("crypto: all checks passed")


if __name__ == "__main__":
    demo()
