"""
AES-CBC encryption/decryption wrapper using pycryptodome.
Uses PKCS7 padding.
"""

from ._crypto_compat import AES as _AES, pad, unpad


class AES:
    """
    AES-CBC wrapper with PKCS7 padding.
    """

    def __init__(self, key: bytes, iv: bytes):
        """
        Args:
            key: AES key (16, 24, or 32 bytes)
            iv:  Initialization vector (16 bytes)
        """
        self._bs = _AES.block_size
        self._key = key
        self._iv = iv

    def encrypt(self, raw: bytes) -> bytes:
        """
        Encrypt data with AES-CBC and PKCS7 padding.

        Args:
            raw: Plaintext data

        Returns:
            Ciphertext bytes
        """
        padded = pad(raw, self._bs)
        cipher = _AES.new(self._key, _AES.MODE_CBC, self._iv)
        return cipher.encrypt(padded)

    def encrypt_ofb(self, raw: bytes) -> bytes:
        """
        Encrypt data with AES-OFB mode.

        Args:
            raw: Plaintext data

        Returns:
            Ciphertext bytes
        """
        padded = pad(raw, self._bs)
        cipher = _AES.new(self._key, _AES.MODE_OFB, self._iv)
        return cipher.encrypt(padded)

    def decrypt(self, enc: bytes) -> bytes:
        """
        Decrypt data with AES-CBC, removing PKCS7 padding.

        Args:
            enc: Ciphertext bytes

        Returns:
            Plaintext bytes (unpadded)
        """
        cipher = _AES.new(self._key, _AES.MODE_CBC, self._iv)
        decrypted = cipher.decrypt(enc)
        return unpad(decrypted, self._bs)

    def decrypt_ofb(self, enc: bytes) -> bytes:
        """
        Decrypt data with AES-OFB mode.

        Args:
            enc: Ciphertext bytes

        Returns:
            Plaintext bytes
        """
        cipher = _AES.new(self._key, _AES.MODE_OFB, self._iv)
        return cipher.decrypt(enc)
